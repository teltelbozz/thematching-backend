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

async function getCurrentTerms(db: Pool) {
  const r = await db.query(
    `
    SELECT id, version, published_at
    FROM terms_versions
    WHERE is_active = true
    ORDER BY published_at DESC, id DESC
    LIMIT 1
    `
  );
  return r.rows[0] ?? null;
}
async function getLatestAcceptance(db: Pool, userId: number) {
  const r = await db.query(
    `
    SELECT
      tv.id AS terms_version_id,
      tv.version,
      uta.accepted_at
    FROM user_terms_acceptances uta
    JOIN terms_versions tv ON tv.id = uta.terms_version_id
    WHERE uta.user_id = $1
    ORDER BY uta.accepted_at DESC
    LIMIT 1
    `,
    [userId]
  );
  return r.rows[0] ?? null;
}

// ========== GET /api/profile ==========
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
      `SELECT
         u.id, u.line_user_id, u.payment_method_set,
         p.nickname, p.age, p.gender, p.occupation,
         p.education, p.university, p.hometown, p.residence,
         p.personality, p.income, p.atmosphere,
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

// ========== PUT /api/profile ==========
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

    // terms check
    try {
      const cur = await getCurrentTerms(db);
      if (cur) {
        const acc = await getLatestAcceptance(db, uid);
        const needs = !acc || Number(acc.terms_version_id) !== Number(cur.id);
        if (needs) {
          return res.status(412).json({
            error: "terms_not_accepted",
            currentTerms: { id: Number(cur.id), version: cur.version, published_at: cur.published_at },
          });
        }
      }
    } catch (e) {
      console.warn("[profile:put] terms check failed; allowing update", e);
    }

    const {
      nickname, age, gender, occupation,
      education, university, hometown, residence,
      personality, income, atmosphere,
      photo_url, photo_masked_url,
    } = req.body || {};

    if (nickname != null && typeof nickname !== 'string') return res.status(400).json({ error: 'invalid_nickname' });
    if (age != null && !(Number.isInteger(age) && age >= 18 && age <= 120)) return res.status(400).json({ error: 'invalid_age' });
    if (gender != null && typeof gender !== 'string') return res.status(400).json({ error: 'invalid_gender' });
    if (occupation != null && typeof occupation !== 'string') return res.status(400).json({ error: 'invalid_occupation' });

    if (education != null && typeof education !== 'string') return res.status(400).json({ error: 'invalid_education' });
    if (university != null && typeof university !== 'string') return res.status(400).json({ error: 'invalid_university' });
    if (hometown != null && typeof hometown !== 'string') return res.status(400).json({ error: 'invalid_hometown' });
    if (residence != null && typeof residence !== 'string') return res.status(400).json({ error: 'invalid_residence' });
    if (personality != null && typeof personality !== 'string') return res.status(400).json({ error: 'invalid_personality' });
    if (income != null && !(Number.isInteger(income) && income >= 0 && income <= 10_000)) return res.status(400).json({ error: 'invalid_income' });
    if (atmosphere != null && typeof atmosphere !== 'string') return res.status(400).json({ error: 'invalid_atmosphere' });

    if (photo_url != null && typeof photo_url !== 'string') return res.status(400).json({ error: 'invalid_photo_url' });
    if (photo_masked_url != null && typeof photo_masked_url !== 'string') return res.status(400).json({ error: 'invalid_photo_masked_url' });

    await db.query(
      `INSERT INTO user_profiles (
         user_id, nickname, age, gender, occupation,
         education, university, hometown, residence,
         personality, income, atmosphere,
         photo_url, photo_masked_url
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6, $7, $8, $9,
         $10, $11, $12,
         $13, $14
       )
       ON CONFLICT (user_id) DO UPDATE SET
         nickname = COALESCE(EXCLUDED.nickname, user_profiles.nickname),
         age = COALESCE(EXCLUDED.age, user_profiles.age),
         gender = COALESCE(EXCLUDED.gender, user_profiles.gender),
         occupation = COALESCE(EXCLUDED.occupation, user_profiles.occupation),
         education = COALESCE(EXCLUDED.education, user_profiles.education),
         university = COALESCE(EXCLUDED.university, user_profiles.university),
         hometown = COALESCE(EXCLUDED.hometown, user_profiles.hometown),
         residence = COALESCE(EXCLUDED.residence, user_profiles.residence),
         personality = COALESCE(EXCLUDED.personality, user_profiles.personality),
         income = COALESCE(EXCLUDED.income, user_profiles.income),
         atmosphere = COALESCE(EXCLUDED.atmosphere, user_profiles.atmosphere),
         photo_url = COALESCE(EXCLUDED.photo_url, user_profiles.photo_url),
         photo_masked_url = COALESCE(EXCLUDED.photo_masked_url, user_profiles.photo_masked_url),
         updated_at = NOW()`,
      [
        uid,
        nickname ?? null,
        age ?? null,
        gender ?? null,
        occupation ?? null,
        education ?? null,
        university ?? null,
        hometown ?? null,
        residence ?? null,
        personality ?? null,
        income ?? null,
        atmosphere ?? null,
        photo_url ?? null,
        photo_masked_url ?? null,
      ],
    );

    const r = await db.query(
      `SELECT
         u.id, u.line_user_id, u.payment_method_set,
         p.nickname, p.age, p.gender, p.occupation,
         p.education, p.university, p.hometown, p.residence,
         p.personality, p.income, p.atmosphere,
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