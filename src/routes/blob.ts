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

/**
 * 既存：A設計の名残（確定profileが存在しないとアップロード不可）
 * ※ これは従来互換として残す
 */
async function ensureProfileExists(db: Pool, userId: number): Promise<boolean> {
  const r = await db.query(`SELECT 1 FROM user_profiles WHERE user_id = $1 LIMIT 1`, [userId]);
  return (r.rowCount ?? 0) > 0;
}

/**
 * ✅ 新UX：draft row を（無ければ）作っておく
 */
async function ensureDraftRow(db: Pool, userId: number) {
  await db.query(
    `
    INSERT INTO profile_drafts (user_id, created_at, updated_at)
    VALUES ($1, now(), now())
    ON CONFLICT (user_id) DO UPDATE SET updated_at = now()
    `,
    [userId],
  );
}

/**
 * ✅ 新UX：POST /api/blob/draft-photo
 * - multipart/form-data (field name: "file")
 * - 仮写真をBlobへアップロード → profile_drafts.draft_photo_url / draft_photo_pathname を更新
 */
router.post('/draft-photo', upload.single('file'), async (req, res) => {
  try {
    const userIdRaw = (req as any).userId;
    const userId = Number(userIdRaw);
    if (!userId || !Number.isFinite(userId)) return res.status(401).json({ error: 'unauthorized' });

    const f = req.file;
    if (!f) return res.status(400).json({ error: 'file_required' });

    const ext = extFromMime(f.mimetype);
    if (!ext) return res.status(400).json({ error: 'invalid_file_type' });

    const db = pool;

    // draft 行を確実に用意
    await ensureDraftRow(db, userId);

    const key = `draft-photos/${userId}/${Date.now()}-${rand(12)}.${ext}`;

    const uploaded = await put(key, f.buffer, {
      access: 'public',
      contentType: f.mimetype,
      addRandomSuffix: false,
    });

    await db.query(
      `
      UPDATE profile_drafts
      SET draft_photo_url = $2,
          draft_photo_pathname = $3,
          updated_at = now()
      WHERE user_id = $1
      `,
      [userId, uploaded.url, uploaded.pathname],
    );

    return res.json({ ok: true, url: uploaded.url, pathname: uploaded.pathname });
  } catch (e: any) {
    console.error('[blob/draft-photo]', e);
    return res.status(500).json({ error: e?.message || 'server_error' });
  }
});

/**
 * ✅ 新UX：POST /api/blob/draft-photo/delete
 * body: { pathname?: string }
 * - pathname が無ければ DB の profile_drafts.draft_photo_pathname を見に行って削除
 * - DB の draft_photo_url/pathname も null に戻す（残骸防止）
 */
router.post('/draft-photo/delete', async (req, res) => {
  try {
    const userIdRaw = (req as any).userId;
    const userId = Number(userIdRaw);
    if (!userId || !Number.isFinite(userId)) return res.status(401).json({ error: 'unauthorized' });

    const db = pool;

    let pathname: string | null = null;
    if (typeof req.body?.pathname === 'string' && req.body.pathname.trim()) {
      pathname = req.body.pathname.trim();
    } else {
      const r = await db.query(
        `SELECT draft_photo_pathname FROM profile_drafts WHERE user_id = $1`,
        [userId],
      );
      pathname = r.rows[0]?.draft_photo_pathname ?? null;
    }

    if (!pathname) {
      return res.json({ ok: true, deleted: false, reason: 'no_pathname' });
    }

    // Blob delete
    await del(pathname);

    // DB cleanup
    await db.query(
      `
      UPDATE profile_drafts
      SET draft_photo_url = NULL,
          draft_photo_pathname = NULL,
          updated_at = now()
      WHERE user_id = $1
      `,
      [userId],
    );

    return res.json({ ok: true, deleted: true });
  } catch (e: any) {
    console.error('[blob/draft-photo/delete]', e);
    return res.status(500).json({ error: e?.message || 'server_error' });
  }
});

/**
 * 既存：POST /api/blob/profile-photo（従来互換）
 * - multipart/form-data (field name: "file")
 * - user_profiles.photo_url を更新して返す
 */
router.post('/profile-photo', upload.single('file'), async (req, res) => {
  try {
    const userIdRaw = (req as any).userId;
    const userId = Number(userIdRaw);
    if (!userId || !Number.isFinite(userId)) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    const db = pool;

    const okProfile = await ensureProfileExists(db, userId);
    if (!okProfile) {
      return res.status(412).json({ error: 'profile_required' });
    }

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
      [userId, uploaded.url],
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

export default router;