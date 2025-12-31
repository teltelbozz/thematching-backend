// src/routes/blob.ts
import { Router } from 'express';
import multer from 'multer';
import { put } from '@vercel/blob';
import type { Pool } from 'pg';
import { pool } from '../db';

const router = Router();

// ===== multer (memory) =====
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
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
  // A設計：profileが存在しない状態ではアップロードさせない（孤児Blob防止）
  const r = await db.query(`SELECT 1 FROM user_profiles WHERE user_id = $1 LIMIT 1`, [userId]);
  return (r.rowCount ?? 0) > 0;
}

/**
 * POST /api/blob/profile-photo
 * - multipart/form-data (field name: "file")
 * - 認証: app.ts で requireAuth を噛ませて req.userId が入っている前提
 * - プロフィール未作成なら 412 profile_required（Blobゴミ発生を防ぐ）
 * - 成功すると user_profiles.photo_url を更新して返す
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

export default router;