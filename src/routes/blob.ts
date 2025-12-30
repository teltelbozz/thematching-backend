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
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  return null;
}

async function ensureProfileExists(db: Pool, userId: number): Promise<boolean> {
  // user_profiles は nickname NOT NULL なので、行が存在する＝最低限プロフィール保存済み、という扱いにできます
  const r = await db.query(
    `SELECT 1 FROM user_profiles WHERE user_id = $1 LIMIT 1`,
    [userId]
  );
  return (r.rowCount ?? 0) > 0;
}

/**
 * POST /api/blob/profile-photo
 * - multipart/form-data (field name: "file")
 * - 認証: requireAuth により req.userId が入っている前提
 * - プロフィール未作成なら 412 profile_required（Blobゴミ発生を防ぐ）
 * - 成功すると user_profiles.photo_url を更新して返す
 */
router.post('/profile-photo', upload.single('file'), async (req, res) => {
  try {
    const userId = (req as any).userId;
    if (!userId) return res.status(401).json({ error: 'unauthorized' });

    const db = pool;

    // ✅ 設計方針：プロフィール未保存の段階ではアップロード不可（Blobに孤児が残らない）
    const okProfile = await ensureProfileExists(db, Number(userId));
    if (!okProfile) {
      return res.status(412).json({ error: 'profile_required' });
    }

    const f = req.file;
    if (!f) return res.status(400).json({ error: 'file_required' });

    const mime = f.mimetype || '';
    const ext = extFromMime(mime);
    if (!ext) return res.status(400).json({ error: 'invalid_file_type' });

    // Blob へアップロード（public URL を取得）
    const key = `profile-photos/${userId}/${Date.now()}-${rand(12)}.${ext}`;

    const uploaded = await put(key, f.buffer, {
      access: 'public',
      contentType: mime,
      addRandomSuffix: false,
    });

    // DB に反映（masked は後続工程がある前提なら null のまま）
    await db.query(
      `
      UPDATE user_profiles
      SET photo_url = $2,
          photo_masked_url = COALESCE(photo_masked_url, NULL),
          updated_at = NOW()
      WHERE user_id = $1
      `,
      [Number(userId), uploaded.url]
    );

    return res.json({
      ok: true,
      url: uploaded.url,
    });
  } catch (e: any) {
    console.error('[blob/profile-photo]', e);
    return res.status(500).json({ error: e?.message || 'server_error' });
  }
});

export default router;