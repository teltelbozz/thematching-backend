// src/routes/profile.ts
import { Router } from 'express';
import type { Pool } from 'pg';
import { readBearer, verifyAccess } from '../auth/tokenService';

const router = Router();

/** ===== helpers ===== */
function normalizeClaims(v: any): any {
  if (v && typeof v === 'object' && 'payload' in v) return (v as any).payload;
  return v;
}
function normalizeUidNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/**
 * claims.uid が:
 *  - 数値 … そのまま users.id
 *  - 文字列（LINE sub = "U..."）… users.line_user_id から解決（なければ作成）
 */
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
    `,
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
    [userId],
  );
  return r.rows[0] ?? null;
}

/** draft の入力バリデーション（仮保存なので緩め：型だけ見る） */
function validateDraftBody(b: any) {
  if (!b || typeof b !== 'object') return { ok: false as const, error: 'invalid_body' as const };

  const fields = [
    'nickname', 'age', 'gender', 'occupation',
    'education', 'university', 'hometown', 'residence',
    'personality', 'income', 'atmosphere',
  ] as const;

  for (const k of fields) {
    const v = (b as any)[k];
    if (v == null) continue;

    if (k === 'age' || k === 'income') {
      if (!Number.isFinite(Number(v))) return { ok: false as const, error: `invalid_${k}` as const };
    } else {
      if (typeof v !== 'string') return { ok: false as const, error: `invalid_${k}` as const };
    }
  }

  return { ok: true as const };
}

/** draft → 確定用 payload（確定時は nickname 必須） */
type FinalPayload = {
  nickname: string;
  age: number | null;
  gender: string | null;
  occupation: string | null;
  education: string | null;
  university: string | null;
  hometown: string | null;
  residence: string | null;
  personality: string | null;
  income: number | null;
  atmosphere: string | null;
  photo_url: string | null;
  photo_masked_url: string | null;
};

type NormalizeOk = { ok: true; data: FinalPayload };
type NormalizeNg = { ok: false; error: string };
function normalizeFinalPayload(draft: any, photoTmpUrl: string | null): NormalizeOk | NormalizeNg {
  const p = draft || {};

  const nicknameRaw = p.nickname;
  const nickname = (typeof nicknameRaw === 'string' ? nicknameRaw.trim() : '');

  const age =
    p.age === undefined || p.age === null || p.age === '' ? null : Number(p.age);
  const income =
    p.income === undefined || p.income === null || p.income === '' ? null : Number(p.income);

  const gender = p.gender ?? null;
  const occupation = p.occupation ?? null;

  const education = p.education ?? null;
  const university = p.university ?? null;
  const hometown = p.hometown ?? null;
  const residence = p.residence ?? null;
  const personality = p.personality ?? null;
  const atmosphere = p.atmosphere ?? null;

  // ✅ 確定は nickname 必須（user_profiles.nickname NOT NULL）
  if (!nickname) return { ok: false, error: 'nickname_required' };

  if (age != null && !(Number.isInteger(age) && age >= 18 && age <= 120)) {
    return { ok: false, error: 'invalid_age' };
  }
  if (income != null && !(Number.isInteger(income) && income >= 0 && income <= 10_000)) {
    return { ok: false, error: 'invalid_income' };
  }
  if (gender != null && typeof gender !== 'string') return { ok: false, error: 'invalid_gender' };

  const strOk = (v: any) => v == null || typeof v === 'string';
  if (![occupation, education, university, hometown, residence, personality, atmosphere].every(strOk)) {
    return { ok: false, error: 'invalid_string_field' };
  }

  return {
    ok: true,
    data: {
      nickname,
      age,
      gender,
      occupation,
      education,
      university,
      hometown,
      residence,
      personality,
      income,
      atmosphere,
      // ✅ draft フローでは tmp 写真をここで確定として入れる
      photo_url: photoTmpUrl ?? null,
      photo_masked_url: null,
    },
  };
}

/** ===== 既存：GET /api/profile（確定プロフィール） ===== */
router.get('/', async (req, res) => {
  try {
    const token = readBearer(req);
    if (!token) return res.status(401).json({ error: 'unauthenticated' });

    const verified = await verifyAccess(token);
    const claims = normalizeClaims(verified);

    const db = req.app.locals.db as Pool | undefined;
    if (!db) return res.status(500).json({ error: 'server_error' });

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

/** ===== 既存：PUT /api/profile（確定プロフィール upsert） ===== */
router.put('/', async (req, res) => {
  try {
    const token = readBearer(req);
    if (!token) return res.status(401).json({ error: 'unauthenticated' });

    const verified = await verifyAccess(token);
    const claims = normalizeClaims(verified);

    const db = req.app.locals.db as Pool | undefined;
    if (!db) return res.status(500).json({ error: 'server_error' });

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
            error: 'terms_not_accepted',
            currentTerms: { id: Number(cur.id), version: cur.version, published_at: cur.published_at },
          });
        }
      }
    } catch (e) {
      console.warn('[profile:put] terms check failed; allowing update', e);
    }

    const {
      nickname, age, gender, occupation,
      education, university, hometown, residence,
      personality, income, atmosphere,
      photo_url, photo_masked_url,
    } = req.body || {};

    // バリデーション（既存どおり）
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

/* =========================================================
   draftフロー（仮保存→写真→確認→確定 / 途中破棄）
   ========================================================= */

/**
 * GET /api/profile/draft
 */
router.get('/draft', async (req, res) => {
  try {
    const token = readBearer(req);
    if (!token) return res.status(401).json({ error: 'unauthenticated' });

    const verified = await verifyAccess(token);
    const claims = normalizeClaims(verified);

    const db = req.app.locals.db as Pool | undefined;
    if (!db) return res.status(500).json({ error: 'server_error' });

    const uid = await resolveUserIdFromClaims(claims, db);
    if (uid == null) return res.status(401).json({ error: 'unauthenticated' });

    const d = await db.query(
      `
      SELECT draft, photo_tmp_url, photo_tmp_pathname, created_at, updated_at
      FROM user_profile_drafts
      WHERE user_id = $1
      `,
      [uid],
    );

    return res.json({
      ok: true,
      draft: d.rows[0] ?? null,
    });
  } catch (e: any) {
    // ✅ ここで "本当の原因" が出ます（Vercel logs でも見える）
    console.error('[profile/draft:get]', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

/**
 * PUT /api/profile/draft
 * - body を jsonb にマージ保存
 */
router.put('/draft', async (req, res) => {
  try {
    const token = readBearer(req);
    if (!token) return res.status(401).json({ error: 'unauthenticated' });

    const verified = await verifyAccess(token);
    const claims = normalizeClaims(verified);

    const db = req.app.locals.db as Pool | undefined;
    if (!db) return res.status(500).json({ error: 'server_error' });

    const uid = await resolveUserIdFromClaims(claims, db);
    if (uid == null) return res.status(401).json({ error: 'unauthenticated' });

    // terms check（draftも同じ方針）
    try {
      const cur = await getCurrentTerms(db);
      if (cur) {
        const acc = await getLatestAcceptance(db, uid);
        const needs = !acc || Number(acc.terms_version_id) !== Number(cur.id);
        if (needs) {
          return res.status(412).json({
            error: 'terms_not_accepted',
            currentTerms: { id: Number(cur.id), version: cur.version, published_at: cur.published_at },
          });
        }
      }
    } catch (e) {
      console.warn('[profile:draft:put] terms check failed; allowing draft save', e);
    }

    const body = req.body || {};
    const v = validateDraftBody(body);
    if (!v.ok) return res.status(400).json({ error: v.error });

    const r = await db.query(
      `
      INSERT INTO user_profile_drafts (user_id, draft, created_at, updated_at)
      VALUES ($1, $2::jsonb, now(), now())
      ON CONFLICT (user_id) DO UPDATE SET
        draft = user_profile_drafts.draft || EXCLUDED.draft,
        updated_at = now()
      RETURNING draft, photo_tmp_url, photo_tmp_pathname, created_at, updated_at
      `,
      [uid, JSON.stringify(body)],
    );

    return res.json({ ok: true, draft: r.rows[0] });
  } catch (e: any) {
    console.error('[profile/draft:put]', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

/**
 * POST /api/profile/confirm
 * - draft + photo_tmp_url を user_profiles に確定反映
 * - 成功したら draft は削除
 */
router.post('/confirm', async (req, res) => {
  const token = readBearer(req);
  if (!token) return res.status(401).json({ error: 'unauthenticated' });

  try {
    const verified = await verifyAccess(token);
    const claims = normalizeClaims(verified);

    const db = req.app.locals.db as Pool | undefined;
    if (!db) return res.status(500).json({ error: 'server_error' });

    const uid = await resolveUserIdFromClaims(claims, db);
    if (uid == null) return res.status(401).json({ error: 'unauthenticated' });

    // terms check（確定なので必須）
    const cur = await getCurrentTerms(db);
    if (cur) {
      const acc = await getLatestAcceptance(db, uid);
      const needs = !acc || Number(acc.terms_version_id) !== Number(cur.id);
      if (needs) {
        return res.status(412).json({
          error: 'terms_not_accepted',
          currentTerms: { id: Number(cur.id), version: cur.version, published_at: cur.published_at },
        });
      }
    }

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      const d = await client.query(
        `
        SELECT draft, photo_tmp_url
        FROM user_profile_drafts
        WHERE user_id = $1
        FOR UPDATE
        `,
        [uid],
      );

      if (!d.rows[0]) {
        await client.query('ROLLBACK');
        return res.status(412).json({ error: 'draft_required' });
      }

      const draft = d.rows[0].draft ?? {};
      const photoTmpUrl: string | null = d.rows[0].photo_tmp_url ?? null;

      const nf = normalizeFinalPayload(draft, photoTmpUrl);
      if (!nf.ok) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: nf.error });
      }

      // ✅ nf.data はここで確実に存在（TSもOK）
      const data = nf.data;

      await client.query(
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
           nickname = EXCLUDED.nickname,
           age = EXCLUDED.age,
           gender = EXCLUDED.gender,
           occupation = EXCLUDED.occupation,
           education = EXCLUDED.education,
           university = EXCLUDED.university,
           hometown = EXCLUDED.hometown,
           residence = EXCLUDED.residence,
           personality = EXCLUDED.personality,
           income = EXCLUDED.income,
           atmosphere = EXCLUDED.atmosphere,
           photo_url = COALESCE(EXCLUDED.photo_url, user_profiles.photo_url),
           photo_masked_url = COALESCE(EXCLUDED.photo_masked_url, user_profiles.photo_masked_url),
           updated_at = now()
        `,
        [
          uid,
          data.nickname,
          data.age,
          data.gender,
          data.occupation,
          data.education,
          data.university,
          data.hometown,
          data.residence,
          data.personality,
          data.income,
          data.atmosphere,
          data.photo_url,
          data.photo_masked_url,
        ],
      );

      // ✅ 確定したら draft 削除（途中離脱の破棄と整合）
      await client.query(`DELETE FROM user_profile_drafts WHERE user_id = $1`, [uid]);

      await client.query('COMMIT');

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

      return res.json({ ok: true, profile: r.rows[0] });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  } catch (e: any) {
    console.error('[profile/confirm]', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

/**
 * DELETE /api/profile/draft
 * - 仮保存(draft)を削除し、削除すべき tmp pathname を返す（Blob削除は blob.ts 側）
 */
router.delete('/draft', async (req, res) => {
  try {
    const token = readBearer(req);
    if (!token) return res.status(401).json({ error: 'unauthenticated' });

    const verified = await verifyAccess(token);
    const claims = normalizeClaims(verified);

    const db = req.app.locals.db as Pool | undefined;
    if (!db) return res.status(500).json({ error: 'server_error' });

    const uid = await resolveUserIdFromClaims(claims, db);
    if (uid == null) return res.status(401).json({ error: 'unauthenticated' });

    const d = await db.query(
      `SELECT photo_tmp_pathname FROM user_profile_drafts WHERE user_id = $1`,
      [uid],
    );
    const pathname = d.rows[0]?.photo_tmp_pathname ?? null;

    await db.query(`DELETE FROM user_profile_drafts WHERE user_id = $1`, [uid]);

    return res.json({ ok: true, deleted: true, photo_tmp_pathname: pathname });
  } catch (e: any) {
    console.error('[profile/draft:delete]', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

export default router;