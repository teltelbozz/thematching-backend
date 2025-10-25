// src/routes/profile.ts
import { Router } from 'express';
import type { Pool } from 'pg';
import { readBearer, verifyAccess } from '../auth/tokenService';

const router = Router();

function getDb(req: any): Pool {
  const db = req.app?.locals?.db as Pool | undefined;
  if (!db) throw new Error('db_not_initialized');
  return db;
}

function toUid(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) {
    return Number(v);
  }
  return null;
}

/**
 * GET /api/profile
 * アクセストークン中の内部ユーザーID(uid) を使って joined profile を返す
 */
router.get('/', async (req, res) => {
  try {
    const token = readBearer(req);
    if (!token) return res.status(401).json({ error: 'unauthenticated' });

    const { payload } = await verifyAccess(token);
    const uid = toUid((payload as any)?.uid);
    if (uid == null) return res.status(401).json({ error: 'unauthenticated' });

    const db = getDb(req);
    const r = await db.query(
      `SELECT u.id,
              u.line_user_id,
              u.payment_method_set,
              p.nickname,
              p.age,
              p.gender,
              p.occupation,
              p.photo_url,
              p.photo_masked_url,
              COALESCE(p.verified_age, false) AS verified_age
         FROM users u
    LEFT JOIN user_profiles p
           ON p.user_id = u.id
        WHERE u.id = $1`,
      [uid]
    );

    // まだ user_profiles が未作成でも 200 を返す（id は分かる）
    if (!r.rows[0]) return res.json({ profile: { id: uid } });
    return res.json({ profile: r.rows[0] });
  } catch (e: any) {
    console.error('[profile:get]', e?.message || e);
    return res.status(500).json({ error: 'server_error' });
  }
});

/**
 * PUT /api/profile
 * body の項目を upsert（null を渡さない限り既存値を温存）
 */
router.put('/', async (req, res) => {
  try {
    const token = readBearer(req);
    if (!token) return res.status(401).json({ error: 'unauthenticated' });

    const { payload } = await verifyAccess(token);
    const uid = toUid((payload as any)?.uid);
    if (uid == null) return res.status(401).json({ error: 'unauthenticated' });

    const {
      nickname,
      age,
      gender,
      occupation,
      photo_url,
      photo_masked_url,
      verified_age,
    } = req.body ?? {};

    // 簡易バリデーション
    if (nickname != null && typeof nickname !== 'string')
      return res.status(400).json({ error: 'invalid_nickname' });
    if (age != null && !(Number.isInteger(age) && age >= 18 && age <= 120))
      return res.status(400).json({ error: 'invalid_age' });
    if (gender != null && typeof gender !== 'string')
      return res.status(400).json({ error: 'invalid_gender' });
    if (occupation != null && typeof occupation !== 'string')
      return res.status(400).json({ error: 'invalid_occupation' });
    if (photo_url != null && typeof photo_url !== 'string')
      return res.status(400).json({ error: 'invalid_photo_url' });
    if (photo_masked_url != null && typeof photo_masked_url !== 'string')
      return res.status(400).json({ error: 'invalid_photo_masked_url' });
    if (verified_age != null && typeof verified_age !== 'boolean')
      return res.status(400).json({ error: 'invalid_verified_age' });

    const db = getDb(req);

    // upsert（指定が無い項目は既存値を温存）
    await db.query(
      `INSERT INTO user_profiles
         (user_id, nickname, age, gender, occupation, photo_url, photo_masked_url, verified_age)
       VALUES
         ($1,      $2,       $3,  $4,    $5,        $6,        $7,              $8)
       ON CONFLICT (user_id) DO UPDATE SET
         nickname         = COALESCE(EXCLUDED.nickname,         user_profiles.nickname),
         age              = COALESCE(EXCLUDED.age,              user_profiles.age),
         gender           = COALESCE(EXCLUDED.gender,           user_profiles.gender),
         occupation       = COALESCE(EXCLUDED.occupation,       user_profiles.occupation),
         photo_url        = COALESCE(EXCLUDED.photo_url,        user_profiles.photo_url),
         photo_masked_url = COALESCE(EXCLUDED.photo_masked_url, user_profiles.photo_masked_url),
         verified_age     = COALESCE(EXCLUDED.verified_age,     user_profiles.verified_age),
         updated_at       = NOW()`,
      [
        uid,
        nickname ?? null,
        age ?? null,
        gender ?? null,
        occupation ?? null,
        photo_url ?? null,
        photo_masked_url ?? null,
        verified_age ?? null,
      ]
    );

    // 反映後の値を返す
    const r = await db.query(
      `SELECT u.id,
              u.line_user_id,
              u.payment_method_set,
              p.nickname,
              p.age,
              p.gender,
              p.occupation,
              p.photo_url,
              p.photo_masked_url,
              COALESCE(p.verified_age, false) AS verified_age
         FROM users u
    LEFT JOIN user_profiles p
           ON p.user_id = u.id
        WHERE u.id = $1`,
      [uid]
    );

    return res.json({ profile: r.rows[0] });
  } catch (e: any) {
    console.error('[profile:put]', e?.message || e);
    return res.status(500).json({ error: 'server_error' });
  }
});

export default router;