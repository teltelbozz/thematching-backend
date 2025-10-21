// src/routes/profile.ts
import { Router } from 'express';
import type { Pool } from 'pg';
import { pool as defaultPool } from '../db';              // ★ 追加
import { readBearer, verifyAccess } from '../auth/tokenService';

const router = Router();

function normalizeUid(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

// GET /api/profile
router.get('/', async (req, res) => {
  try {
    const token = readBearer(req);
    if (!token) return res.status(401).json({ error: 'unauthenticated' });
    const { payload } = await verifyAccess(token);

    const uid = normalizeUid((payload as any).uid);
    if (uid == null) return res.status(401).json({ error: 'unauthenticated' });

    // ★ フォールバック（app.locals.db が無い場合でも動かす）
    const db: Pool = (req.app?.locals?.db as Pool) ?? defaultPool;
    if (!db) {
      console.error('[profile:get] db_not_initialized');
      return res.status(500).json({ error: 'server_error' });
    }

    const r = await db.query(
      `SELECT u.id, u.line_user_id, u.payment_method_set,
              p.nickname, p.age, p.gender, p.occupation,
              p.photo_url, p.photo_masked_url, p.verified_age
         FROM users u
    LEFT JOIN user_profiles p ON p.user_id = u.id
        WHERE u.id = $1`,
      [uid],
    );

    if (!r.rows[0]) return res.json({ profile: { id: uid } }); // 未登録でも 200
    return res.json({ profile: r.rows[0] });
  } catch (e: any) {
    console.error('[profile:get]', e?.message || e);
    return res.status(500).json({ error: 'server_error' });
  }
});

// PUT /api/profile
router.put('/', async (req, res) => {
  try {
    const token = readBearer(req);
    if (!token) return res.status(401).json({ error: 'unauthenticated' });
    const { payload } = await verifyAccess(token);

    const uid = normalizeUid((payload as any).uid);
    if (uid == null) return res.status(401).json({ error: 'unauthenticated' });

    // ★ フォールバック
    const db: Pool = (req.app?.locals?.db as Pool) ?? defaultPool;
    if (!db) {
      console.error('[profile:put] db_not_initialized');
      return res.status(500).json({ error: 'server_error' });
    }

    const { nickname, age, gender, occupation, photo_url, photo_masked_url } = req.body || {};

    // 略：バリデーションは現状維持

    await db.query(
      `INSERT INTO user_profiles (user_id, nickname, age, gender, occupation, photo_url, photo_masked_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id) DO UPDATE SET
         nickname = COALESCE(EXCLUDED.nickname, user_profiles.nickname),
         age = COALESCE(EXCLUDED.age, user_profiles.age),
         gender = COALESCE(EXCLUDED.gender, user_profiles.gender),
         occupation = COALESCE(EXCLUDED.occupation, user_profiles.occupation),
         photo_url = COALESCE(EXCLUDED.photo_url, user_profiles.photo_url),
         photo_masked_url = COALESCE(EXCLUDED.photo_masked_url, user_profiles.photo_masked_url),
         updated_at = NOW()`,
      [uid, nickname ?? null, age ?? null, gender ?? null, occupation ?? null, photo_url ?? null, photo_masked_url ?? null],
    );

    const r = await db.query(
      `SELECT u.id, u.line_user_id, u.payment_method_set,
              p.nickname, p.age, p.gender, p.occupation,
              p.photo_url, p.photo_masked_url, p.verified_age
         FROM users u
    LEFT JOIN user_profiles p ON p.user_id = u.id
        WHERE u.id = $1`,
      [uid],
    );
    return res.json({ profile: r.rows[0] });
  } catch (e: any) {
    console.error('[profile:put]', e?.message || e);
    return res.status(500).json({ error: 'server_error' });
  }
});

export default router;