// src/routes/profile.ts
import { Router } from 'express';
import type { Pool } from 'pg';
import { readBearer, verifyAccess } from '../auth/tokenService';

const router = Router();

function normalizeClaims(v: any): any {
  if (v && typeof v === 'object' && 'payload' in v) return (v as any).payload;
  return v;
}

function normalizeUidNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

async function resolveUserIdFromClaims(claims: any, db: Pool): Promise<number | null> {
  const raw = claims?.uid;
  const asNum = normalizeUidNumber(raw);
  if (asNum != null) return asNum;

  if (typeof raw === 'string' && raw.trim()) {
    const sub = raw.trim();
    const r1 = await db.query<{ id: number }>(
      'SELECT id FROM users WHERE line_user_id = $1 LIMIT 1',
      [sub],
    );
    if (r1.rows[0]) return r1.rows[0].id;

    const r2 = await db.query<{ id: number }>(
      'INSERT INTO users (line_user_id) VALUES ($1) RETURNING id',
      [sub],
    );
    return r2.rows[0]?.id ?? null;
  }

  return null;
}

// GET /api/profile
router.get('/', async (req, res) => {
  try {
    const token = readBearer(req);
    if (!token) return res.status(401).json({ error: 'unauthenticated' });

    const verified = await verifyAccess(token);
    const claims = normalizeClaims(verified);

    const db = req.app.locals.db as Pool | undefined;
    if (!db) {
      console.error('[profile:get] db_not_initialized');
      return res.status(500).json({ error: 'server_error' });
    }

    const uid = await resolveUserIdFromClaims(claims, db);
    if (uid == null) return res.status(401).json({ error: 'unauthenticated' });

    const r = await db.query(
      `SELECT u.id, u.line_user_id, u.payment_method_set,
              p.nickname, p.age, p.gender, p.occupation,
              p.photo_url, p.photo_masked_url, p.verified_age
         FROM users u
    LEFT JOIN user_profiles p ON p.user_id = u.id
        WHERE u.id = $1`,
      [uid],
    );

    if (!r.rows[0]) return res.json({ profile: { id: uid } });
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

    const verified = await verifyAccess(token);
    const claims = normalizeClaims(verified);

    const db = req.app.locals.db as Pool | undefined;
    if (!db) {
      console.error('[profile:put] db_not_initialized');
      return res.status(500).json({ error: 'server_error' });
    }

    const uid = await resolveUserIdFromClaims(claims, db);
    if (uid == null) return res.status(401).json({ error: 'unauthenticated' });

    const {
      nickname,
      age,
      gender,
      occupation,
      photo_url,
      photo_masked_url,
    } = req.body ?? {};

    // 既存仕様と互換の簡易バリデーション
    const numAge =
      typeof age === 'string' ? Number(age) : typeof age === 'number' ? age : null;
    if (numAge != null && !(Number.isInteger(numAge) && numAge >= 18 && numAge <= 120))
      return res.status(400).json({ error: 'invalid_age' });

    if (nickname != null && typeof nickname !== 'string')
      return res.status(400).json({ error: 'invalid_nickname' });
    if (gender != null && typeof gender !== 'string')
      return res.status(400).json({ error: 'invalid_gender' });
    if (occupation != null && typeof occupation !== 'string')
      return res.status(400).json({ error: 'invalid_occupation' });
    if (photo_url != null && typeof photo_url !== 'string')
      return res.status(400).json({ error: 'invalid_photo_url' });
    if (photo_masked_url != null && typeof photo_masked_url !== 'string')
      return res.status(400).json({ error: 'invalid_photo_masked_url' });

    // プロフィールを upsert
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
      [
        uid,
        nickname ?? null,
        numAge ?? null,
        gender ?? null,
        occupation ?? null,
        photo_url ?? null,
        photo_masked_url ?? null,
      ],
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