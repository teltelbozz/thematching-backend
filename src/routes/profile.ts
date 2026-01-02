// src/routes/profile.ts
import { Router } from "express";
import type { Pool } from "pg";
import { readBearer, verifyAccess } from "../auth/tokenService";

const router = Router();

/** ===== helpers ===== */
function normalizeClaims(v: any): any {
  if (v && typeof v === "object" && "payload" in v) return (v as any).payload;
  return v;
}
function normalizeUidNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

async function resolveUserIdFromClaims(claims: any, db: Pool): Promise<number | null> {
  const raw = claims?.uid;

  const asNum = normalizeUidNumber(raw);
  if (asNum != null) return asNum;

  if (typeof raw === "string" && raw.trim()) {
    const sub = raw.trim();
    const r1 = await db.query<{ id: number }>(
      "SELECT id FROM users WHERE line_user_id = $1 LIMIT 1",
      [sub],
    );
    if (r1.rows[0]) return r1.rows[0].id;

    const r2 = await db.query<{ id: number }>(
      "INSERT INTO users (line_user_id) VALUES ($1) RETURNING id",
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

/** draft保存は緩め（型だけ） */
function validateDraftBody(b: any) {
  if (!b || typeof b !== "object") return { ok: false as const, error: "invalid_body" as const };
  const fields = [
    "nickname",
    "age",
    "gender",
    "occupation",
    "education",
    "university",
    "hometown",
    "residence",
    "personality",
    "income",
    "atmosphere",
  ] as const;

  for (const k of fields) {
    const v = (b as any)[k];
    if (v == null) continue;
    if (k === "age" || k === "income") {
      if (!Number.isFinite(Number(v))) return { ok: false as const, error: `invalid_${k}` as const };
    } else {
      if (typeof v !== "string") return { ok: false as const, error: `invalid_${k}` as const };
    }
  }
  return { ok: true as const };
}

/** confirm用：最終バリデーション（nickname必須 etc） */
type FinalOk = {
  ok: true;
  data: {
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
};
type FinalNg = { ok: false; error: string };
function normalizeFinalPayload(src: any): FinalOk | FinalNg {
  const p = src || {};
  const nicknameRaw = p.nickname;

  const nickname = typeof nicknameRaw === "string" ? nicknameRaw.trim() : "";
  if (!nickname) return { ok: false, error: "nickname_required" };

  const age = p.age === undefined || p.age === null || p.age === "" ? null : Number(p.age);
  if (age != null && !(Number.isInteger(age) && age >= 18 && age <= 120)) return { ok: false, error: "invalid_age" };

  const income = p.income === undefined || p.income === null || p.income === "" ? null : Number(p.income);
  if (income != null && !(Number.isInteger(income) && income >= 0 && income <= 10_000))
    return { ok: false, error: "invalid_income" };

  const strOrNull = (v: any) => (v == null ? null : typeof v === "string" ? v : null);
  const gender = strOrNull(p.gender);
  const occupation = strOrNull(p.occupation);
  const education = strOrNull(p.education);
  const university = strOrNull(p.university);
  const hometown = strOrNull(p.hometown);
  const residence = strOrNull(p.residence);
  const personality = strOrNull(p.personality);
  const atmosphere = strOrNull(p.atmosphere);

  const photo_url = strOrNull(p.photo_url);
  const photo_masked_url = strOrNull(p.photo_masked_url);

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
      photo_url,
      photo_masked_url,
    },
  };
}

/** ===== 既存：GET /api/profile（確定プロフィール） ===== */
router.get("/", async (req, res) => {
  try {
    const token = readBearer(req);
    if (!token) return res.status(401).json({ error: "unauthenticated" });

    const verified = await verifyAccess(token);
    const claims = normalizeClaims(verified);

    const db = req.app.locals.db as Pool | undefined;
    if (!db) return res.status(500).json({ error: "server_error" });

    const uid = await resolveUserIdFromClaims(claims, db);
    if (uid == null) return res.status(401).json({ error: "unauthenticated" });

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
    console.error("[profile:get]", e?.message || e);
    return res.status(500).json({ error: "server_error" });
  }
});

/** ===== 既存：PUT /api/profile（確定プロフィール upsert） ===== */
router.put("/", async (req, res) => {
  try {
    const token = readBearer(req);
    if (!token) return res.status(401).json({ error: "unauthenticated" });

    const verified = await verifyAccess(token);
    const claims = normalizeClaims(verified);

    const db = req.app.locals.db as Pool | undefined;
    if (!db) return res.status(500).json({ error: "server_error" });

    const uid = await resolveUserIdFromClaims(claims, db);
    if (uid == null) return res.status(401).json({ error: "unauthenticated" });

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
      photo_url,
      photo_masked_url,
    } = req.body || {};

    // 既存の緩めバリデーション
    if (nickname != null && typeof nickname !== "string") return res.status(400).json({ error: "invalid_nickname" });
    if (age != null && !(Number.isInteger(age) && age >= 18 && age <= 120)) return res.status(400).json({ error: "invalid_age" });
    if (gender != null && typeof gender !== "string") return res.status(400).json({ error: "invalid_gender" });
    if (occupation != null && typeof occupation !== "string") return res.status(400).json({ error: "invalid_occupation" });

    if (education != null && typeof education !== "string") return res.status(400).json({ error: "invalid_education" });
    if (university != null && typeof university !== "string") return res.status(400).json({ error: "invalid_university" });
    if (hometown != null && typeof hometown !== "string") return res.status(400).json({ error: "invalid_hometown" });
    if (residence != null && typeof residence !== "string") return res.status(400).json({ error: "invalid_residence" });
    if (personality != null && typeof personality !== "string") return res.status(400).json({ error: "invalid_personality" });
    if (income != null && !(Number.isInteger(income) && income >= 0 && income <= 10_000)) return res.status(400).json({ error: "invalid_income" });
    if (atmosphere != null && typeof atmosphere !== "string") return res.status(400).json({ error: "invalid_atmosphere" });

    if (photo_url != null && typeof photo_url !== "string") return res.status(400).json({ error: "invalid_photo_url" });
    if (photo_masked_url != null && typeof photo_masked_url !== "string") return res.status(400).json({ error: "invalid_photo_masked_url" });

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
    console.error("[profile:put]", e?.message || e);
    return res.status(500).json({ error: "server_error" });
  }
});

/* =========================================================
   draftフロー（仮保存→写真→確認→確定 / 途中破棄）
   テーブル: public.profile_drafts（あなたのDDL）
   ========================================================= */

/**
 * GET /api/profile/draft
 */
router.get("/draft", async (req, res) => {
  try {
    const token = readBearer(req);
    if (!token) return res.status(401).json({ error: "unauthenticated" });

    const verified = await verifyAccess(token);
    const claims = normalizeClaims(verified);

    const db = req.app.locals.db as Pool | undefined;
    if (!db) return res.status(500).json({ error: "server_error" });

    const uid = await resolveUserIdFromClaims(claims, db);
    if (uid == null) return res.status(401).json({ error: "unauthenticated" });

    const d = await db.query(
      `
      SELECT
        user_id,
        nickname, age, gender, occupation,
        education, university, hometown, residence,
        personality, income, atmosphere,
        draft_photo_url, draft_photo_pathname,
        created_at, updated_at
      FROM profile_drafts
      WHERE user_id = $1
      `,
      [uid],
    );

    return res.json({
      ok: true,
      draft: d.rows[0]
        ? {
            user_id: d.rows[0].user_id,
            nickname: d.rows[0].nickname,
            age: d.rows[0].age,
            gender: d.rows[0].gender,
            occupation: d.rows[0].occupation,
            education: d.rows[0].education,
            university: d.rows[0].university,
            hometown: d.rows[0].hometown,
            residence: d.rows[0].residence,
            personality: d.rows[0].personality,
            income: d.rows[0].income,
            atmosphere: d.rows[0].atmosphere,
            photo_url: d.rows[0].draft_photo_url,
            photo_pathname: d.rows[0].draft_photo_pathname,
            created_at: d.rows[0].created_at,
            updated_at: d.rows[0].updated_at,
          }
        : null,
    });
  } catch (e: any) {
    console.error("[profile/draft:get]", e?.message || e);
    return res.status(500).json({ error: "server_error" });
  }
});

/**
 * PUT /api/profile/draft
 * - 仮保存（緩め）
 */
router.put("/draft", async (req, res) => {
  try {
    const token = readBearer(req);
    if (!token) return res.status(401).json({ error: "unauthenticated" });

    const verified = await verifyAccess(token);
    const claims = normalizeClaims(verified);

    const db = req.app.locals.db as Pool | undefined;
    if (!db) return res.status(500).json({ error: "server_error" });

    const uid = await resolveUserIdFromClaims(claims, db);
    if (uid == null) return res.status(401).json({ error: "unauthenticated" });

    // terms（draftでも同じ方針）
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

    // 受け取ったものだけ更新（null/undefinedは“未更新”扱い）
    const toNumOrNull = (x: any) =>
      x === undefined || x === null || x === "" ? null : Number(x);

    const nickname = body.nickname ?? undefined;
    const age = body.age !== undefined ? toNumOrNull(body.age) : undefined;
    const gender = body.gender ?? undefined;
    const occupation = body.occupation ?? undefined;
    const education = body.education ?? undefined;
    const university = body.university ?? undefined;
    const hometown = body.hometown ?? undefined;
    const residence = body.residence ?? undefined;
    const personality = body.personality ?? undefined;
    const income = body.income !== undefined ? toNumOrNull(body.income) : undefined;
    const atmosphere = body.atmosphere ?? undefined;

    const r = await db.query(
      `
      INSERT INTO profile_drafts (
        user_id,
        nickname, age, gender, occupation,
        education, university, hometown, residence,
        personality, income, atmosphere,
        created_at, updated_at
      ) VALUES (
        $1,
        $2, $3, $4, $5,
        $6, $7, $8, $9,
        $10, $11, $12,
        now(), now()
      )
      ON CONFLICT (user_id) DO UPDATE SET
        nickname = COALESCE(EXCLUDED.nickname, profile_drafts.nickname),
        age = COALESCE(EXCLUDED.age, profile_drafts.age),
        gender = COALESCE(EXCLUDED.gender, profile_drafts.gender),
        occupation = COALESCE(EXCLUDED.occupation, profile_drafts.occupation),
        education = COALESCE(EXCLUDED.education, profile_drafts.education),
        university = COALESCE(EXCLUDED.university, profile_drafts.university),
        hometown = COALESCE(EXCLUDED.hometown, profile_drafts.hometown),
        residence = COALESCE(EXCLUDED.residence, profile_drafts.residence),
        personality = COALESCE(EXCLUDED.personality, profile_drafts.personality),
        income = COALESCE(EXCLUDED.income, profile_drafts.income),
        atmosphere = COALESCE(EXCLUDED.atmosphere, profile_drafts.atmosphere),
        updated_at = now()
      RETURNING
        user_id,
        nickname, age, gender, occupation,
        education, university, hometown, residence,
        personality, income, atmosphere,
        draft_photo_url, draft_photo_pathname,
        created_at, updated_at
      `,
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
      ],
    );

    const row = r.rows[0];
    return res.json({
      ok: true,
      draft: {
        user_id: row.user_id,
        nickname: row.nickname,
        age: row.age,
        gender: row.gender,
        occupation: row.occupation,
        education: row.education,
        university: row.university,
        hometown: row.hometown,
        residence: row.residence,
        personality: row.personality,
        income: row.income,
        atmosphere: row.atmosphere,
        photo_url: row.draft_photo_url,
        photo_pathname: row.draft_photo_pathname,
        created_at: row.created_at,
        updated_at: row.updated_at,
      },
    });
  } catch (e: any) {
    console.error("[profile/draft:put]", e?.message || e);
    return res.status(500).json({ error: "server_error" });
  }
});

/**
 * POST /api/profile/confirm
 * - profile_drafts の内容を user_profiles に確定反映
 * - draft_photo_url を photo_url として本採用
 * - 成功したら profile_drafts は削除
 */
router.post("/confirm", async (req, res) => {
  const token = readBearer(req);
  if (!token) return res.status(401).json({ error: "unauthenticated" });

  try {
    const verified = await verifyAccess(token);
    const claims = normalizeClaims(verified);

    const db = req.app.locals.db as Pool | undefined;
    if (!db) return res.status(500).json({ error: "server_error" });

    const uid = await resolveUserIdFromClaims(claims, db);
    if (uid == null) return res.status(401).json({ error: "unauthenticated" });

    // terms（確定なので必須）
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

    const client = await db.connect();
    try {
      await client.query("BEGIN");

      const d = await client.query(
        `
        SELECT
          nickname, age, gender, occupation,
          education, university, hometown, residence,
          personality, income, atmosphere,
          draft_photo_url
        FROM profile_drafts
        WHERE user_id = $1
        FOR UPDATE
        `,
        [uid],
      );

      if (!d.rows[0]) {
        await client.query("ROLLBACK");
        return res.status(412).json({ error: "draft_required" });
      }

      const row = d.rows[0];

      const nf = normalizeFinalPayload({
        nickname: row.nickname,
        age: row.age,
        gender: row.gender,
        occupation: row.occupation,
        education: row.education,
        university: row.university,
        hometown: row.hometown,
        residence: row.residence,
        personality: row.personality,
        income: row.income,
        atmosphere: row.atmosphere,
        photo_url: row.draft_photo_url ?? null, // ★draft写真を本採用
        photo_masked_url: null,
      });

      if (!nf.ok) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: nf.error });
      }

      // ここで TypeScript 的にも data は確実に存在
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
          photo_url = EXCLUDED.photo_url,
          photo_masked_url = EXCLUDED.photo_masked_url,
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
          data.photo_url, // ← draft_photo_url を本採用
          data.photo_masked_url,
        ],
      );

      // draftは削除（途中離脱は「破棄」の前提）
      await client.query(`DELETE FROM profile_drafts WHERE user_id = $1`, [uid]);

      await client.query("COMMIT");

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
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      (client as any).release?.();
    }
  } catch (e: any) {
    console.error("[profile/confirm]", e?.message || e);
    return res.status(500).json({ error: "server_error" });
  }
});

/**
 * POST /api/profile/cancel
 * - draftを破棄（必要ならフロントが blob delete を呼べるよう pathname も返す）
 */
router.post("/cancel", async (req, res) => {
  try {
    const token = readBearer(req);
    if (!token) return res.status(401).json({ error: "unauthenticated" });

    const verified = await verifyAccess(token);
    const claims = normalizeClaims(verified);

    const db = req.app.locals.db as Pool | undefined;
    if (!db) return res.status(500).json({ error: "server_error" });

    const uid = await resolveUserIdFromClaims(claims, db);
    if (uid == null) return res.status(401).json({ error: "unauthenticated" });

    const r = await db.query<{ draft_photo_pathname: string | null }>(
      `SELECT draft_photo_pathname FROM profile_drafts WHERE user_id = $1`,
      [uid],
    );
    const pathname = r.rows[0]?.draft_photo_pathname ?? null;

    await db.query(`DELETE FROM profile_drafts WHERE user_id = $1`, [uid]);

    return res.json({ ok: true, cancelled: true, draft_photo_pathname: pathname });
  } catch (e: any) {
    console.error("[profile/cancel]", e?.message || e);
    return res.status(500).json({ error: "server_error" });
  }
});

export default router;