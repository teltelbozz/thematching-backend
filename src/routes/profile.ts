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
 *  - 数値 … users.id
 *  - 文字列（LINE sub = "U..."）… users.line_user_id から id 解決（なければ発行）
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

/** draft の入力バリデーション（仮保存なので“緩め”：型だけ） */
function validateDraftBody(b: any) {
  if (!b || typeof b !== 'object') return { ok: false, error: 'invalid_body' as const };

  const fields = [
    'nickname','age','gender','occupation',
    'education','university','hometown','residence',
    'personality','income','atmosphere',
  ] as const;

  for (const k of fields) {
    const v = (b as any)[k];
    if (v == null) continue;

    if (k === 'age' || k === 'income') {
      if (!(Number.isFinite(Number(v)))) return { ok: false, error: `invalid_${k}` as const };
    } else {
      if (typeof v !== 'string') return { ok: false, error: `invalid_${k}` as const };
    }
  }
  return { ok: true } as const;
}

/** draft → 確定 payload に整形（確定時は厳しめ） */
type FinalProfileData = {
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
};

type NormalizeFinalResult =
  | { ok: true; data: FinalProfileData }
  | { ok: false; error: string };

function normalizeFinalPayload(draft: any): NormalizeFinalResult {
  const p = draft || {};
  const nickname = p.nickname ?? null;

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

  // nickname 必須（user_profiles.nickname NOT NULL 前提）
  if (typeof nickname !== 'string' || nickname.trim() === '') {
    return { ok: false, error: 'nickname_required' };
  }

  if (age != null && !(Number.isInteger(age) && age >= 18 && age <= 120)) {
    return { ok: false, error: 'invalid_age' };
  }
  if (income != null && !(Number.isInteger(income) && income >= 0 && income <= 10_000)) {
    return { ok: false, error: 'invalid_income' };
  }

  const strOk = (v: any) => v == null || typeof v === 'string';
  if (![gender, occupation, education, university, hometown, residence, personality, atmosphere].every(strOk)) {
    return { ok: false, error: 'invalid_string_field' };
  }

  return {
    ok: true,
    data: {
      nickname: nickname.trim(),
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
    },
  };
}

/* =========================================================
   既存：GET /api/profile（確定プロフィール）
   ========================================================= */
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

/* =========================================================
   既存：PUT /api/profile（確定プロフィール upsert）
   ※ 既存互換として残す（draftフローでも最終は confirm 推奨）
   ========================================================= */
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

    // terms check（既存どおり）
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
   追加：draftフロー（仮保存→写真→確認→確定 / 途中破棄）
   ========================================================= */

/**
 * GET /api/profile/draft
 * - 仮保存があれば返す。なければ null
 * - 確定プロフィールも一緒に返す（確認画面で使いやすい）
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

    const p = await db.query(
      `SELECT
         p.nickname, p.age, p.gender, p.occupation,
         p.education, p.university, p.hometown, p.residence,
         p.personality, p.income, p.atmosphere,
         p.photo_url, p.photo_masked_url, p.verified_age
       FROM user_profiles p
       WHERE p.user_id = $1`,
      [uid],
    );

    return res.json({
      ok: true,
      draft: d.rows[0]
        ? {
            draft: d.rows[0].draft,
            photo_tmp_url: d.rows[0].photo_tmp_url,
            photo_tmp_pathname: d.rows[0].photo_tmp_pathname,
            created_at: d.rows[0].created_at,
            updated_at: d.rows[0].updated_at,
          }
        : null,
      profile: p.rows[0] ?? null,
    });
  } catch (e: any) {
    console.error('[profile/draft:get]', e?.message || e);
    return res.status(500).json({ error: 'server_error' });
  }
});

/**
 * PUT /api/profile/draft
 * body: { nickname?, age?, ... }（仮保存なので緩め）
 * - user_profile_drafts.draft に upsert して保持
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

    // terms check（draftでも同じ方針）
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
      console.warn("[profile:draft] terms check failed; allowing draft save", e);
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
    console.error('[profile/draft:put]', e?.message || e);
    return res.status(500).json({ error: 'server_error' });
  }
});

/**
 * POST /api/profile/confirm
 * - draft + photo_tmp_url を user_profiles に確定反映
 * - 成功したら user_profile_drafts は削除
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

    // terms check（確定なので必須扱い）
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

    const client = await (db as any).connect();
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

      const draft = d.rows[0].draft || {};
      const photoTmpUrl: string | null = d.rows[0].photo_tmp_url ?? null;

      const nf = normalizeFinalPayload(draft);
      if (nf.ok !== true) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: nf.error });
      }

      // ✅ ここで data は確実に存在（TSもOK）
      const data = nf.data;

      await client.query(
        `
        INSERT INTO user_profiles (
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
          photoTmpUrl,   // ✅ 仮写真を確定写真にする
          null,          // photo_masked_url は将来用
        ],
      );

      // draft削除（確定したら破棄）
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
      client.release?.();
    }
  } catch (e: any) {
    console.error('[profile/confirm]', e?.message || e);
    return res.status(500).json({ error: 'server_error' });
  }
});

/**
 * DELETE /api/profile/draft
 * - 仮保存と仮写真参照を破棄（draftレコード削除）
 * - Blob削除は /api/blob/draft-photo/delete 側で行う想定
 *   → ここでは「削除すべき pathname」を返す
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
    console.error('[profile/draft:delete]', e?.message || e);
    return res.status(500).json({ error: 'server_error' });
  }
});

export default router;