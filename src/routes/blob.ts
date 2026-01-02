
// src/routes/blob.ts
import { Router } from 'express';
import multer from 'multer';
import { put, del } from '@vercel/blob';
import type { Pool } from 'pg';
import { pool } from '../db';

const router = Router();

/** ===== multer (memory) ===== */
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

async function ensureDraftExists(db: Pool, userId: number) {
  // draft が無ければ空で作る（写真画面でアップロードできるように）
  await db.query(
    `
    INSERT INTO user_profile_drafts (user_id, draft, created_at, updated_at)
    VALUES ($1, '{}'::jsonb, now(), now())
    ON CONFLICT (user_id) DO UPDATE SET
      updated_at = now()
    `,
    [userId],
  );
}

/**
 * POST /api/blob/draft-photo
 * - multipart/form-data (field name: "file")
 * - 認証: app.ts で requireAuth により req.userId が入っている前提
 * - user_profile_drafts に photo_tmp_url / photo_tmp_pathname を保存
 */
router.post('/draft-photo', upload.single('file'), async (req, res) => {
  try {
    const userIdRaw = (req as any).userId;
    const userId = Number(userIdRaw);
    if (!userId || !Number.isFinite(userId)) return res.status(401).json({ error: 'unauthorized' });

    const db = pool;

    const f = req.file;
    if (!f) return res.status(400).json({ error: 'file_required' });

    const ext = extFromMime(f.mimetype);
    if (!ext) return res.status(400).json({ error: 'invalid_file_type' });

    // draft 行を確実に用意
    await ensureDraftExists(db, userId);

    // 既存tmpがあれば pathname を返しても良いが、ここでは「上書き」運用にする
    // （不要なBlobが増えるのを防ぐため、アップロード前に既存tmpを消す）
    const prev = await db.query(
      `SELECT photo_tmp_pathname FROM user_profile_drafts WHERE user_id = $1`,
      [userId],
    );
    const prevPathname: string | null = prev.rows[0]?.photo_tmp_pathname ?? null;

    // Blob アップロード
    const key = `profile-drafts/${userId}/${Date.now()}-${rand(12)}.${ext}`;
    const uploaded = await put(key, f.buffer, {
      access: 'public',
      contentType: f.mimetype,
      addRandomSuffix: false,
    });

    // DB更新
    await db.query(
      `
      UPDATE user_profile_drafts
      SET photo_tmp_url = $2,
          photo_tmp_pathname = $3,
          updated_at = now()
      WHERE user_id = $1
      `,
      [userId, uploaded.url, uploaded.pathname],
    );

    // 既存tmpがあれば削除（失敗してもUXは止めない）
    if (prevPathname && prevPathname.startsWith(`profile-drafts/${userId}/`)) {
      del(prevPathname).catch(() => {});
    }

    return res.json({ ok: true, url: uploaded.url, pathname: uploaded.pathname });
  } catch (e: any) {
    console.error('[blob/draft-photo]', e);
    return res.status(500).json({ error: e?.message || 'server_error' });
  }
});

/**
 * DELETE /api/blob/draft-photo
 * body: { pathname: string }
 * - draftのtmp写真を削除（本人のprefixチェック）
 */
router.delete('/draft-photo', async (req, res) => {
  try {
    const userIdRaw = (req as any).userId;
    const userId = Number(userIdRaw);
    if (!userId || !Number.isFinite(userId)) return res.status(401).json({ error: 'unauthorized' });

    const pathname = req.body?.pathname;
    if (!pathname || typeof pathname !== 'string') return res.status(400).json({ error: 'pathname_required' });

    // ✅ 本人の領域だけ削除可能
    const prefix = `profile-drafts/${userId}/`;
    if (!pathname.startsWith(prefix)) return res.status(403).json({ error: 'forbidden' });

    await del(pathname);

    // DB側もクリア（あれば）
    const db = pool;
    await db.query(
      `
      UPDATE user_profile_drafts
      SET photo_tmp_url = NULL,
          photo_tmp_pathname = NULL,
          updated_at = now()
      WHERE user_id = $1 AND photo_tmp_pathname = $2
      `,
      [userId, pathname],
    );

    return res.json({ ok: true, deleted: true });
  } catch (e: any) {
    console.error('[blob/draft-photo:delete]', e);
    return res.status(500).json({ error: e?.message || 'server_error' });
  }
});

export default router;