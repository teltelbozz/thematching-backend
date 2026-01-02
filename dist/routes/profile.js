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
function normalizeFinalPayload(p) {
    const nickname = p?.nickname;
    const age = p?.age === undefined || p?.age === null || p?.age === '' ? null : Number(p.age);
    const income = p?.income === undefined || p?.income === null || p?.income === '' ? null : Number(p.income);
    const gender = p?.gender ?? null;
    const occupation = p?.occupation ?? null;
    const education = p?.education ?? null;
    const university = p?.university ?? null;
    const hometown = p?.hometown ?? null;
    const residence = p?.residence ?? null;
    const personality = p?.personality ?? null;
    const atmosphere = p?.atmosphere ?? null;
    if (typeof nickname !== 'string' || nickname.trim() === '')
        return { ok: false, error: 'nickname_required' };
    if (age != null && !(Number.isInteger(age) && age >= 18 && age <= 120))
        return { ok: false, error: 'invalid_age' };
    if (income != null && !(Number.isInteger(income) && income >= 0 && income <= 10000))
        return { ok: false, error: 'invalid_income' };
    const strOk = (v) => v == null || typeof v === 'string';
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
/** ===== 新：GET /api/profile/draft ===== */
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
      FROM profile_drafts
      WHERE user_id = $1
      `, [uid]);
        if (!d.rows[0])
            return res.json({ ok: true, draft: null });
        const row = d.rows[0];
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
    }
    catch (e) {
        console.error('[profile/draft:get]', e?.message || e);
        return res.status(500).json({ error: 'server_error' });
    }
});
/** ===== 新：PUT /api/profile/draft（仮保存） ===== */
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
        // terms check（方針維持：draftでも弾く）
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
        const b = req.body || {};
        await db.query(`
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
        updated_at = now()
      `, [
            uid,
            b.nickname ?? null,
            b.age ?? null,
            b.gender ?? null,
            b.occupation ?? null,
            b.education ?? null,
            b.university ?? null,
            b.hometown ?? null,
            b.residence ?? null,
            b.personality ?? null,
            b.income ?? null,
            b.atmosphere ?? null,
        ]);
        const d = await db.query(`
      SELECT
        user_id,
        nickname, age, gender, occupation,
        education, university, hometown, residence,
        personality, income, atmosphere,
        draft_photo_url, draft_photo_pathname,
        created_at, updated_at
      FROM profile_drafts
      WHERE user_id = $1
      `, [uid]);
        const row = d.rows[0];
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
    }
    catch (e) {
        console.error('[profile/draft:put]', e?.message || e);
        return res.status(500).json({ error: 'server_error' });
    }
});
/**
 * POST /api/profile/confirm
 * - draft入力 + draft_photo_url を user_profiles に反映して確定
 * - 成功後、profile_drafts を削除（途中離脱は cancel で削除）
 */
router.post('/confirm', async (req, res) => {
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
            // draft をロック
            const d = await client.query(`
        SELECT
          nickname, age, gender, occupation,
          education, university, hometown, residence,
          personality, income, atmosphere,
          draft_photo_url, draft_photo_pathname
        FROM profile_drafts
        WHERE user_id = $1
        FOR UPDATE
        `, [uid]);
            if (!d.rows[0]) {
                await client.query('ROLLBACK');
                return res.status(412).json({ error: 'draft_required' });
            }
            const row = d.rows[0];
            const nf = normalizeFinalPayload(row);
            if (!nf.ok) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: nf.error });
            }
            const data = nf.data;
            const draftPhotoUrl = row.draft_photo_url ?? null;
            // user_profiles に確定反映（photo_url は draft_photo_url を採用）
            await client.query(`
        INSERT INTO user_profiles (
          user_id,
          nickname, age, gender, occupation,
          education, university, hometown, residence,
          personality, income, atmosphere,
          photo_url, photo_masked_url,
          created_at, updated_at
        ) VALUES (
          $1,
          $2, $3, $4, $5,
          $6, $7, $8, $9,
          $10, $11, $12,
          $13, COALESCE((SELECT photo_masked_url FROM user_profiles WHERE user_id = $1), NULL),
          now(), now()
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
                draftPhotoUrl,
            ]);
            // draft 削除（確定後は不要）
            await client.query(`DELETE FROM profile_drafts WHERE user_id = $1`, [uid]);
            await client.query('COMMIT');
            // 返却
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
            client.release?.();
        }
    }
    catch (e) {
        console.error('[profile/confirm]', e?.message || e);
        return res.status(500).json({ error: 'server_error' });
    }
});
/**
 * POST /api/profile/cancel
 * - draft を破棄
 * - draft_photo_pathname があれば Blob も削除
 */
router.post('/cancel', async (req, res) => {
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
        const d = await db.query(`SELECT draft_photo_pathname FROM profile_drafts WHERE user_id = $1`, [uid]);
        const pathname = d.rows[0]?.draft_photo_pathname ?? null;
        await db.query(`DELETE FROM profile_drafts WHERE user_id = $1`, [uid]);
        // Blob 削除（失敗しても cancel は成立させる）
        if (pathname) {
            try {
                await (0, blob_1.del)(pathname);
            }
            catch (e) {
                console.warn('[profile/cancel] blob del failed (ignored):', e);
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
