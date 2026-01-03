"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// src/routes/profile.ts
const express_1 = require("express");
const tokenService_1 = require("../auth/tokenService");
const blob_1 = require("@vercel/blob");
const router = (0, express_1.Router)();
/** ===== helpers ===== */
function normalizeClaims(v) {
    if (v && typeof v === 'object' && 'payload' in v)
        return v.payload;
    return v;
}
function normalizeUidNumber(v) {
    if (typeof v === 'number' && Number.isFinite(v))
        return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)))
        return Number(v);
    return null;
}
async function resolveUserIdFromClaims(claims, db) {
    const raw = claims?.uid;
    const asNum = normalizeUidNumber(raw);
    if (asNum != null)
        return asNum;
    if (typeof raw === 'string' && raw.trim()) {
        const sub = raw.trim();
        const r1 = await db.query('SELECT id FROM users WHERE line_user_id = $1 LIMIT 1', [sub]);
        if (r1.rows[0])
            return r1.rows[0].id;
        const r2 = await db.query('INSERT INTO users (line_user_id) VALUES ($1) RETURNING id', [sub]);
        return r2.rows[0]?.id ?? null;
    }
    return null;
}
async function getCurrentTerms(db) {
    const r = await db.query(`
    SELECT id, version, published_at
    FROM terms_versions
    WHERE is_active = true
    ORDER BY published_at DESC, id DESC
    LIMIT 1
    `);
    return r.rows[0] ?? null;
}
async function getLatestAcceptance(db, userId) {
    const r = await db.query(`
    SELECT
      tv.id AS terms_version_id,
      tv.version,
      uta.accepted_at
    FROM user_terms_acceptances uta
    JOIN terms_versions tv ON tv.id = uta.terms_version_id
    WHERE uta.user_id = $1
    ORDER BY uta.accepted_at DESC
    LIMIT 1
    `, [userId]);
    return r.rows[0] ?? null;
}
/** draft: ゆるいバリデーション（型だけ） */
function validateDraftBody(b) {
    if (!b || typeof b !== 'object')
        return { ok: false, error: 'invalid_body' };
    const numFields = ['age', 'income'];
    for (const k of numFields) {
        const v = b[k];
        if (v == null || v === '')
            continue;
        if (!Number.isFinite(Number(v)))
            return { ok: false, error: `invalid_${k}` };
    }
    const strFields = [
        'nickname',
        'gender',
        'occupation',
        'education',
        'university',
        'hometown',
        'residence',
        'personality',
        'atmosphere',
    ];
    for (const k of strFields) {
        const v = b[k];
        if (v == null)
            continue;
        if (typeof v !== 'string')
            return { ok: false, error: `invalid_${k}` };
    }
    // draft側で写真が来る場合もある（blob側が基本だが保険）
    if (b.draft_photo_url != null && typeof b.draft_photo_url !== 'string') {
        return { ok: false, error: 'invalid_draft_photo_url' };
    }
    if (b.draft_photo_pathname != null && typeof b.draft_photo_pathname !== 'string') {
        return { ok: false, error: 'invalid_draft_photo_pathname' };
    }
    return { ok: true };
}
/** confirm用に正規化（確定時は nickname 必須） */
function normalizeFinalPayload(d) {
    const nickname = typeof d?.nickname === 'string' ? d.nickname.trim() : '';
    if (!nickname)
        return { ok: false, error: 'nickname_required' };
    const ageRaw = d?.age;
    const age = ageRaw == null || ageRaw === '' ? null : Number(ageRaw);
    if (age != null && !(Number.isInteger(age) && age >= 18 && age <= 120)) {
        return { ok: false, error: 'invalid_age' };
    }
    const incomeRaw = d?.income;
    const income = incomeRaw == null || incomeRaw === '' ? null : Number(incomeRaw);
    if (income != null && !(Number.isInteger(income) && income >= 0 && income <= 10000)) {
        return { ok: false, error: 'invalid_income' };
    }
    const gender = d?.gender ?? null;
    const occupation = d?.occupation ?? null;
    const education = d?.education ?? null;
    const university = d?.university ?? null;
    const hometown = d?.hometown ?? null;
    const residence = d?.residence ?? null;
    const personality = d?.personality ?? null;
    const atmosphere = d?.atmosphere ?? null;
    const strOk = (v) => v == null || typeof v === 'string';
    if (![gender, occupation, education, university, hometown, residence, personality, atmosphere].every(strOk)) {
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
        },
    };
}
/** ===== 既存：GET /api/profile（確定プロフィール） ===== */
router.get('/', async (req, res) => {
    try {
        const token = (0, tokenService_1.readBearer)(req);
        if (!token)
            return res.status(401).json({ error: 'unauthenticated' });
        const verified = await (0, tokenService_1.verifyAccess)(token);
        const claims = normalizeClaims(verified);
        const db = req.app.locals.db;
        if (!db)
            return res.status(500).json({ error: 'server_error' });
        const uid = await resolveUserIdFromClaims(claims, db);
        if (uid == null)
            return res.status(401).json({ error: 'unauthenticated' });
        const r = await db.query(`SELECT
         u.id, u.line_user_id, u.payment_method_set,
         p.nickname, p.age, p.gender, p.occupation,
         p.education, p.university, p.hometown, p.residence,
         p.personality, p.income, p.atmosphere,
         p.photo_url, p.photo_masked_url, p.verified_age
       FROM users u
       LEFT JOIN user_profiles p ON p.user_id = u.id
       WHERE u.id = $1`, [uid]);
        if (!r.rows[0])
            return res.json({ profile: { id: uid } });
        return res.json({ profile: r.rows[0] });
    }
    catch (e) {
        console.error('[profile:get]', e?.message || e);
        return res.status(500).json({ error: 'server_error' });
    }
});
/** ===== 既存：PUT /api/profile（確定プロフィール upsert） ===== */
router.put('/', async (req, res) => {
    try {
        const token = (0, tokenService_1.readBearer)(req);
        if (!token)
            return res.status(401).json({ error: 'unauthenticated' });
        const verified = await (0, tokenService_1.verifyAccess)(token);
        const claims = normalizeClaims(verified);
        const db = req.app.locals.db;
        if (!db)
            return res.status(500).json({ error: 'server_error' });
        const uid = await resolveUserIdFromClaims(claims, db);
        if (uid == null)
            return res.status(401).json({ error: 'unauthenticated' });
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
        }
        catch (e) {
            console.warn('[profile:put] terms check failed; allowing update', e);
        }
        const { nickname, age, gender, occupation, education, university, hometown, residence, personality, income, atmosphere, photo_url, photo_masked_url, } = req.body || {};
        if (nickname != null && typeof nickname !== 'string')
            return res.status(400).json({ error: 'invalid_nickname' });
        if (age != null && !(Number.isInteger(age) && age >= 18 && age <= 120))
            return res.status(400).json({ error: 'invalid_age' });
        if (gender != null && typeof gender !== 'string')
            return res.status(400).json({ error: 'invalid_gender' });
        if (occupation != null && typeof occupation !== 'string')
            return res.status(400).json({ error: 'invalid_occupation' });
        if (education != null && typeof education !== 'string')
            return res.status(400).json({ error: 'invalid_education' });
        if (university != null && typeof university !== 'string')
            return res.status(400).json({ error: 'invalid_university' });
        if (hometown != null && typeof hometown !== 'string')
            return res.status(400).json({ error: 'invalid_hometown' });
        if (residence != null && typeof residence !== 'string')
            return res.status(400).json({ error: 'invalid_residence' });
        if (personality != null && typeof personality !== 'string')
            return res.status(400).json({ error: 'invalid_personality' });
        if (income != null && !(Number.isInteger(income) && income >= 0 && income <= 10000))
            return res.status(400).json({ error: 'invalid_income' });
        if (atmosphere != null && typeof atmosphere !== 'string')
            return res.status(400).json({ error: 'invalid_atmosphere' });
        if (photo_url != null && typeof photo_url !== 'string')
            return res.status(400).json({ error: 'invalid_photo_url' });
        if (photo_masked_url != null && typeof photo_masked_url !== 'string')
            return res.status(400).json({ error: 'invalid_photo_masked_url' });
        await db.query(`INSERT INTO user_profiles (
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
         updated_at = NOW()`, [
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
        ]);
        const r = await db.query(`SELECT
         u.id, u.line_user_id, u.payment_method_set,
         p.nickname, p.age, p.gender, p.occupation,
         p.education, p.university, p.hometown, p.residence,
         p.personality, p.income, p.atmosphere,
         p.photo_url, p.photo_masked_url, p.verified_age
       FROM users u
       LEFT JOIN user_profiles p ON p.user_id = u.id
       WHERE u.id = $1`, [uid]);
        return res.json({ profile: r.rows[0] });
    }
    catch (e) {
        console.error('[profile:put]', e?.message || e);
        return res.status(500).json({ error: 'server_error' });
    }
});
/* =========================================================
   Draftフロー（profile_drafts テーブル版）
   ========================================================= */
/**
 * GET /api/profile/draft
 */
router.get('/draft', async (req, res) => {
    try {
        const token = (0, tokenService_1.readBearer)(req);
        if (!token)
            return res.status(401).json({ error: 'unauthenticated' });
        const verified = await (0, tokenService_1.verifyAccess)(token);
        const claims = normalizeClaims(verified);
        const db = req.app.locals.db;
        if (!db)
            return res.status(500).json({ error: 'server_error' });
        const uid = await resolveUserIdFromClaims(claims, db);
        if (uid == null)
            return res.status(401).json({ error: 'unauthenticated' });
        const d = await db.query(`
      SELECT
        user_id,
        nickname, age, gender, occupation,
        education, university, hometown, residence,
        personality, income, atmosphere,
        draft_photo_url, draft_photo_pathname,
        created_at, updated_at
      FROM public.profile_drafts
      WHERE user_id = $1
      `, [uid]);
        return res.json({ ok: true, draft: d.rows[0] ?? null });
    }
    catch (e) {
        console.error('[profile/draft:get]', e?.message || e);
        return res.status(500).json({ error: 'server_error' });
    }
});
/**
 * PUT /api/profile/draft
 * - 部分更新（null/undefinedは “更新しない” 仕様に寄せる）
 */
router.put('/draft', async (req, res) => {
    try {
        const token = (0, tokenService_1.readBearer)(req);
        if (!token)
            return res.status(401).json({ error: 'unauthenticated' });
        const verified = await (0, tokenService_1.verifyAccess)(token);
        const claims = normalizeClaims(verified);
        const db = req.app.locals.db;
        if (!db)
            return res.status(500).json({ error: 'server_error' });
        const uid = await resolveUserIdFromClaims(claims, db);
        if (uid == null)
            return res.status(401).json({ error: 'unauthenticated' });
        // terms check（方針：draftでもブロックする）
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
        }
        catch (e) {
            console.warn('[profile:draft:put] terms check failed; allowing draft save', e);
        }
        const body = req.body || {};
        const v = validateDraftBody(body);
        if (!v.ok)
            return res.status(400).json({ error: v.error });
        const patch = {
            nickname: body.nickname ?? null,
            age: body.age ?? null,
            gender: body.gender ?? null,
            occupation: body.occupation ?? null,
            education: body.education ?? null,
            university: body.university ?? null,
            hometown: body.hometown ?? null,
            residence: body.residence ?? null,
            personality: body.personality ?? null,
            income: body.income ?? null,
            atmosphere: body.atmosphere ?? null,
            draft_photo_url: body.draft_photo_url ?? null,
            draft_photo_pathname: body.draft_photo_pathname ?? null,
        };
        const r = await db.query(`
      INSERT INTO public.profile_drafts (
        user_id,
        nickname, age, gender, occupation,
        education, university, hometown, residence,
        personality, income, atmosphere,
        draft_photo_url, draft_photo_pathname,
        created_at, updated_at
      )
      VALUES (
        $1,
        $2, $3, $4, $5,
        $6, $7, $8, $9,
        $10, $11, $12,
        $13, $14,
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
        draft_photo_url = COALESCE(EXCLUDED.draft_photo_url, profile_drafts.draft_photo_url),
        draft_photo_pathname = COALESCE(EXCLUDED.draft_photo_pathname, profile_drafts.draft_photo_pathname),
        updated_at = now()
      RETURNING
        user_id,
        nickname, age, gender, occupation,
        education, university, hometown, residence,
        personality, income, atmosphere,
        draft_photo_url, draft_photo_pathname,
        created_at, updated_at
      `, [
            uid,
            patch.nickname,
            patch.age,
            patch.gender,
            patch.occupation,
            patch.education,
            patch.university,
            patch.hometown,
            patch.residence,
            patch.personality,
            patch.income,
            patch.atmosphere,
            patch.draft_photo_url,
            patch.draft_photo_pathname,
        ]);
        return res.json({ ok: true, draft: r.rows[0] });
    }
    catch (e) {
        console.error('[profile/draft:put]', e?.message || e);
        return res.status(500).json({ error: 'server_error' });
    }
});
/**
 * POST /api/profile/confirm
 * - profile_drafts を user_profiles に反映
 * - 写真は draft_photo_url をそのまま photo_url に採用（Blob移動なし）
 * - 確定後、profile_drafts は削除
 */
router.post('/confirm', async (req, res) => {
    const token = (0, tokenService_1.readBearer)(req);
    if (!token)
        return res.status(401).json({ error: 'unauthenticated' });
    try {
        const verified = await (0, tokenService_1.verifyAccess)(token);
        const claims = normalizeClaims(verified);
        const db = req.app.locals.db;
        if (!db)
            return res.status(500).json({ error: 'server_error' });
        const uid = await resolveUserIdFromClaims(claims, db);
        if (uid == null)
            return res.status(401).json({ error: 'unauthenticated' });
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
            const d = await client.query(`
        SELECT
          nickname, age, gender, occupation,
          education, university, hometown, residence,
          personality, income, atmosphere,
          draft_photo_url
        FROM public.profile_drafts
        WHERE user_id = $1
        FOR UPDATE
        `, [uid]);
            const row = d.rows[0];
            if (!row) {
                await client.query('ROLLBACK');
                return res.status(412).json({ error: 'draft_required' });
            }
            const nf = normalizeFinalPayload(row);
            if (!nf.ok) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: nf.error });
            }
            const data = nf.data; // <- ここで確定的に存在
            const photoUrl = row.draft_photo_url ?? null;
            // user_profiles upsert（nickname NOT NULL 対応）
            await client.query(`
        INSERT INTO public.user_profiles (
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
        `, [
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
                photoUrl,
                null, // photo_masked_url は未実装想定
            ]);
            // draft削除
            await client.query(`DELETE FROM public.profile_drafts WHERE user_id = $1`, [uid]);
            await client.query('COMMIT');
            const r = await db.query(`SELECT
           u.id, u.line_user_id, u.payment_method_set,
           p.nickname, p.age, p.gender, p.occupation,
           p.education, p.university, p.hometown, p.residence,
           p.personality, p.income, p.atmosphere,
           p.photo_url, p.photo_masked_url, p.verified_age
         FROM users u
         LEFT JOIN user_profiles p ON p.user_id = u.id
         WHERE u.id = $1`, [uid]);
            return res.json({ ok: true, profile: r.rows[0] });
        }
        catch (e) {
            await client.query('ROLLBACK').catch(() => { });
            throw e;
        }
        finally {
            client.release();
        }
    }
    catch (e) {
        console.error('[profile/confirm]', e?.message || e);
        return res.status(500).json({ error: 'server_error' });
    }
});
/**
 * POST /api/profile/cancel
 * - draft破棄 + draft写真Blobも削除（pathnameがあれば）
 */
router.post('/cancel', async (req, res) => {
    const token = (0, tokenService_1.readBearer)(req);
    if (!token)
        return res.status(401).json({ error: 'unauthenticated' });
    try {
        const verified = await (0, tokenService_1.verifyAccess)(token);
        const claims = normalizeClaims(verified);
        const db = req.app.locals.db;
        if (!db)
            return res.status(500).json({ error: 'server_error' });
        const uid = await resolveUserIdFromClaims(claims, db);
        if (uid == null)
            return res.status(401).json({ error: 'unauthenticated' });
        // draftのpathnameを取って削除
        const d = await db.query(`SELECT draft_photo_pathname FROM public.profile_drafts WHERE user_id = $1`, [uid]);
        const pathname = d.rows[0]?.draft_photo_pathname ?? null;
        await db.query(`DELETE FROM public.profile_drafts WHERE user_id = $1`, [uid]);
        // blob削除（失敗してもキャンセル自体は成功にする）
        if (pathname) {
            try {
                await (0, blob_1.del)(pathname);
            }
            catch (e) {
                console.warn('[profile/cancel] blob delete failed (ignored):', e);
            }
        }
        return res.json({ ok: true, cancelled: true });
    }
    catch (e) {
        console.error('[profile/cancel]', e?.message || e);
        return res.status(500).json({ error: 'server_error' });
    }
});
exports.default = router;
