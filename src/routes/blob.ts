// src/routes/blob.ts
import { Router } from 'express';
import multer from 'multer';
import { put, del as delBlob } from '@vercel/blob';
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
  const r = await db.query(`SELECT 1 FROM user_profiles WHERE user_id = $1 LIMIT 1`, [userId]);
  return (r.rowCount ?? 0) > 0;
}

/**
 * A(旧)設計：POST /api/blob/profile-photo
 * - 確定プロフィールが存在する場合のみ許可（孤児Blob防止）
 * - user_profiles.photo_url を更新
 */
router.post('/profile-photo', upload.single('file'), async (req, res) => {
  try {
    const userIdRaw = (req as any).userId;
    const userId = Number(userIdRaw);
    if (!userId || !Number.isFinite(userId)) return res.status(401).json({ error: 'unauthorized' });

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
      [userId, uploaded.url],
    );

    return res.json({ ok: true, url: uploaded.url, pathname: uploaded.pathname });
  } catch (e: any) {
    console.error('[blob/profile-photo]', e);
    return res.status(500).json({ error: e?.message || 'server_error' });
  }
});

/**
 * 新フロー：POST /api/blob/profile-photo-draft
 * - 確定プロフィール不要（draftフローのため）
 * - profile_drafts.draft_photo_url / draft_photo_pathname を更新
 * - 以前のdraft写真があれば削除して孤児Blobを出さない
 */
router.post('/profile-photo-draft', upload.single('file'), async (req, res) => {
  try {
    const userIdRaw = (req as any).userId;
    const userId = Number(userIdRaw);
    if (!userId || !Number.isFinite(userId)) return res.status(401).json({ error: 'unauthorized' });

    const db = pool;

    const f = req.file;
    if (!f) return res.status(400).json({ error: 'file_required' });

    const ext = extFromMime(f.mimetype);
    if (!ext) return res.status(400).json({ error: 'invalid_file_type' });

    // 既存のdraft写真を取る（あれば消す）
    const prev = await db.query(
      `SELECT draft_photo_pathname FROM public.profile_drafts WHERE user_id = $1`,
      [userId],
    );
    const prevPathname: string | null = prev.rows[0]?.draft_photo_pathname ?? null;

    const key = `draft-profile-photos/${userId}/${Date.now()}-${rand(12)}.${ext}`;
    const uploaded = await put(key, f.buffer, {
      access: 'public',
      contentType: f.mimetype,
      addRandomSuffix: false,
    });

    // draft行が無くても作れるように upsert（nickname等は保持）
    await db.query(
      `
      INSERT INTO public.profile_drafts (
        user_id,
        draft_photo_url,
        draft_photo_pathname,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, now(), now())
      ON CONFLICT (user_id) DO UPDATE SET
        draft_photo_url = EXCLUDED.draft_photo_url,
        draft_photo_pathname = EXCLUDED.draft_photo_pathname,
        updated_at = now()
      `,
      [userId, uploaded.url, uploaded.pathname],
    );

    // 旧draft写真を削除（失敗してもアップロード自体は成功扱い）
    if (prevPathname && prevPathname !== uploaded.pathname) {
      try {
        await delBlob(prevPathname);
      } catch (e) {
        console.warn('[blob/profile-photo-draft] old blob delete failed (ignored):', e);
      }
    }

    return res.json({ ok: true, url: uploaded.url, pathname: uploaded.pathname });
  } catch (e: any) {
    console.error('[blob/profile-photo-draft]', e);
    return res.status(500).json({ error: e?.message || 'server_error' });
  }
});

export default router;