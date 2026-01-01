// src/routes/blob.ts
import { Router } from 'express';
import multer from 'multer';
import { put, del } from '@vercel/blob';
import type { Pool } from 'pg';
import { pool } from '../db';

const router = Router();

// ===== multer (memory) =====
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

function rand(n = 10) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < n; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function extFromMime(mime: string) {
  const m = (mime || '').toLowerCase();
  if (m === 'image/jpeg' || m === 'image/jpg') return 'jpg';
  if (m === 'image/png') return 'png';
  if (m === 'image/webp') return 'webp';
  return null;
}

async function ensureProfileExists(db: Pool, userId: number): Promise<boolean> {
  // 既存(A設計)用：profileが存在しない状態ではアップロードさせない（孤児Blob防止）
  const r = await db.query(`SELECT 1 FROM user_profiles WHERE user_id = $1 LIMIT 1`, [userId]);
  return (r.rowCount ?? 0) > 0;
}

function mustUserId(req: any): number | null {
  const raw = req.userId;
  const n = Number(raw);
  if (!n || !Number.isFinite(n)) return null;
  return n;
}

/**
 * 既存：POST /api/blob/profile-photo（A設計）
 * - multipart/form-data (field name: "file")
 * - 認証: app.ts で requireAuth を噛ませて req.userId が入っている前提
 * - プロフィール未作成なら 412 profile_required（Blobゴミ発生を防ぐ）
 * - 成功すると user_profiles.photo_url を更新して返す
 */
router.post('/profile-photo', upload.single('file'), async (req, res) => {
  try {
    const userId = mustUserId(req);
    if (!userId) return res.status(401).json({ error: 'unauthorized' });

    const db = pool;

    const okProfile = await ensureProfileExists(db, userId);
    if (!okProfile) return res.status(412).json({ error: 'profile_required' });

    const f = req.file;
    if (!f) return res.status(400).json({ error: 'file_required' });

    const ext = extFromMime(f.mimetype);
    if (!ext) return res.status(400).json({ error: 'invalid_file_type' });

    const key = `profile-photos/${userId}/${Date.now()}-${rand(12)}.${ext}`;

    const uploaded = await put(key, f.buffer, {
      access: 'public',
      contentType: f.mimetype,
      addRandomSuffix: false,
    });

    await db.query(
      `
      UPDATE user_profiles
      SET photo_url = $2,
          updated_at = NOW()
      WHERE user_id = $1
      `,
      [userId, uploaded.url]
    );

    return res.json({
      ok: true,
      url: uploaded.url,
      pathname: uploaded.pathname,
    });
  } catch (e: any) {
    console.error('[blob/profile-photo]', e);
    return res.status(500).json({ error: e?.message || 'server_error' });
  }
});

/* =========================================================
   追加：draftフロー用 “仮写真アップロード”
   ========================================================= */

/**
 * POST /api/blob/draft-photo
 * - multipart/form-data (field name: "file")
 * - 認証: requireAuth
 * - user_profile_drafts に photo_tmp_url / photo_tmp_pathname を保存
 * - すでに仮写真がある場合は “古い仮写真Blobを削除” して入れ替える（孤児防止）
 */
router.post('/draft-photo', upload.single('file'), async (req, res) => {
  try {
    const userId = mustUserId(req);
    if (!userId) return res.status(401).json({ error: 'unauthorized' });

    const db = pool;
    const f = req.file;
    if (!f) return res.status(400).json({ error: 'file_required' });

    const ext = extFromMime(f.mimetype);
    if (!ext) return res.status(400).json({ error: 'invalid_file_type' });

    // 既存の draft の仮写真があれば先に消す（pathnameベース）
    const prev = await db.query(
      `SELECT photo_tmp_pathname FROM user_profile_drafts WHERE user_id = $1`,
      [userId],
    );
    const prevPath: string | null = prev.rows[0]?.photo_tmp_pathname ?? null;

    // アップロード
    const key = `profile-drafts/${userId}/${Date.now()}-${rand(12)}.${ext}`;
    const uploaded = await put(key, f.buffer, {
      access: 'public',
      contentType: f.mimetype,
      addRandomSuffix: false,
    });

    // DBに仮写真を記録（draft行がなければ作る）
    await db.query(
      `
      INSERT INTO user_profile_drafts (user_id, draft, photo_tmp_url, photo_tmp_pathname, created_at, updated_at)
      VALUES ($1, '{}'::jsonb, $2, $3, now(), now())
      ON CONFLICT (user_id) DO UPDATE SET
        photo_tmp_url = EXCLUDED.photo_tmp_url,
        photo_tmp_pathname = EXCLUDED.photo_tmp_pathname,
        updated_at = now()
      `,
      [userId, uploaded.url, uploaded.pathname],
    );

    // 旧仮写真Blobを削除（失敗しても致命ではない）
    if (prevPath && typeof prevPath === 'string' && prevPath.startsWith(`profile-drafts/${userId}/`)) {
      try {
        await del(prevPath);
      } catch (e) {
        console.warn('[blob/draft-photo] failed to delete previous draft blob:', prevPath, e);
      }
    }

    return res.json({
      ok: true,
      url: uploaded.url,
      pathname: uploaded.pathname,
    });
  } catch (e: any) {
    console.error('[blob/draft-photo]', e);
    return res.status(500).json({ error: e?.message || 'server_error' });
  }
});

/**
 * POST /api/blob/draft-photo/delete
 * body: { pathname: string }
 * - 認証: requireAuth
 * - 自分の `profile-drafts/${userId}/` 配下のみ削除可（安全）
 * - DB の photo_tmp_* もクリア
 */
router.post('/draft-photo/delete', async (req, res) => {
  try {
    const userId = mustUserId(req);
    if (!userId) return res.status(401).json({ error: 'unauthorized' });

    const pathname = req.body?.pathname;
    if (typeof pathname !== 'string' || !pathname) {
      return res.status(400).json({ error: 'pathname_required' });
    }

    // 自分の領域以外は削除させない
    const prefix = `profile-drafts/${userId}/`;
    if (!pathname.startsWith(prefix)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    try {
      await del(pathname);
    } catch (e) {
      // 既に消えててもOK扱いにする（冪等）
      console.warn('[blob/draft-photo/delete] del failed (ignore):', e);
    }

    // DB の仮写真をクリア（一致する場合のみ）
    await pool.query(
      `
      UPDATE user_profile_drafts
      SET photo_tmp_url = NULL,
          photo_tmp_pathname = NULL,
          updated_at = now()
      WHERE user_id = $1
        AND photo_tmp_pathname = $2
      `,
      [userId, pathname],
    );

    return res.json({ ok: true, deleted: true });
  } catch (e: any) {
    console.error('[blob/draft-photo/delete]', e);
    return res.status(500).json({ error: e?.message || 'server_error' });
  }
});

export default router;