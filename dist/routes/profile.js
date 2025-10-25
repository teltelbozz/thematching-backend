"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// src/routes/profile.ts
const express_1 = require("express");
const tokenService_1 = require("../auth/tokenService");
const router = (0, express_1.Router)();
function isNumericLike(v) {
    return typeof v === 'number' && Number.isFinite(v);
}
function isNonEmptyString(v) {
    return typeof v === 'string' && v.trim() !== '';
}
/**
 * トークンから uid を取り出し、必要なら DB で users.id を解決して返す。
 * - uid が number → そのまま内部ユーザーIDとして使用
 * - uid が string   → LINE の sub とみなし users(line_user_id) から id を解決
 */
async function resolveUserIdFromToken(req) {
    const token = (0, tokenService_1.readBearer)(req);
    if (!token)
        throw new Error('unauthenticated:no_bearer');
    const { payload } = await (0, tokenService_1.verifyAccess)(token);
    const rawUid = payload?.uid;
    const db = req.app?.locals?.db;
    if (!db)
        throw new Error('db_not_initialized');
    // 数値ならそのまま users.id として扱う
    if (isNumericLike(rawUid))
        return rawUid;
    // 文字列（LINE sub）なら users から内部IDに解決
    if (isNonEmptyString(rawUid)) {
        const r = await db.query('SELECT id FROM users WHERE line_user_id = $1 LIMIT 1', [rawUid.trim()]);
        if (r.rows[0]?.id)
            return r.rows[0].id;
        throw new Error('unauthenticated:uid_not_found');
    }
    throw new Error('unauthenticated:invalid_uid_type');
}
// ------------------------------------------------------------------
// GET /api/profile  …自分のプロフィール取得
// ------------------------------------------------------------------
router.get('/', async (req, res) => {
    try {
        const db = req.app?.locals?.db;
        if (!db)
            throw new Error('db_not_initialized');
        const userId = await resolveUserIdFromToken(req);
        const r = await db.query(`SELECT u.id, u.line_user_id, u.payment_method_set,
              p.nickname, p.age, p.gender, p.occupation,
              p.photo_url, p.photo_masked_url, p.verified_age
         FROM users u
    LEFT JOIN user_profiles p ON p.user_id = u.id
        WHERE u.id = $1`, [userId]);
        if (!r.rows[0]) {
            // ユーザーは居るがプロフィール未作成の初回ログイン状態
            return res.json({ profile: { id: userId } });
        }
        return res.json({ profile: r.rows[0] });
    }
    catch (e) {
        const msg = e?.message || String(e);
        if (msg.startsWith('unauthenticated')) {
            return res.status(401).json({ error: 'unauthenticated' });
        }
        console.error('[profile:get]', msg);
        return res.status(500).json({ error: 'server_error' });
    }
});
// ------------------------------------------------------------------
// PUT /api/profile  …自分のプロフィール作成/更新（upsert）
// ------------------------------------------------------------------
router.put('/', async (req, res) => {
    try {
        const db = req.app?.locals?.db;
        if (!db)
            throw new Error('db_not_initialized');
        const userId = await resolveUserIdFromToken(req);
        const { nickname, age, gender, occupation, photo_url, photo_masked_url } = (req.body ?? {});
        // 簡易バリデーション（既存仕様を踏襲）
        if (nickname != null && typeof nickname !== 'string')
            return res.status(400).json({ error: 'invalid_nickname' });
        if (age != null &&
            !(typeof age === 'number' &&
                Number.isInteger(age) &&
                age >= 18 &&
                age <= 120))
            return res.status(400).json({ error: 'invalid_age' });
        if (gender != null && typeof gender !== 'string')
            return res.status(400).json({ error: 'invalid_gender' });
        if (occupation != null && typeof occupation !== 'string')
            return res.status(400).json({ error: 'invalid_occupation' });
        if (photo_url != null && typeof photo_url !== 'string')
            return res.status(400).json({ error: 'invalid_photo_url' });
        if (photo_masked_url != null && typeof photo_masked_url !== 'string')
            return res.status(400).json({ error: 'invalid_photo_masked_url' });
        // upsert
        await db.query(`INSERT INTO user_profiles (user_id, nickname, age, gender, occupation, photo_url, photo_masked_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
  ON CONFLICT (user_id) DO UPDATE SET
         nickname        = COALESCE(EXCLUDED.nickname,        user_profiles.nickname),
         age             = COALESCE(EXCLUDED.age,             user_profiles.age),
         gender          = COALESCE(EXCLUDED.gender,          user_profiles.gender),
         occupation      = COALESCE(EXCLUDED.occupation,      user_profiles.occupation),
         photo_url       = COALESCE(EXCLUDED.photo_url,       user_profiles.photo_url),
         photo_masked_url= COALESCE(EXCLUDED.photo_masked_url,user_profiles.photo_masked_url),
         updated_at      = NOW()`, [
            userId,
            nickname ?? null,
            age ?? null,
            gender ?? null,
            occupation ?? null,
            photo_url ?? null,
            photo_masked_url ?? null,
        ]);
        const r = await db.query(`SELECT u.id, u.line_user_id, u.payment_method_set,
              p.nickname, p.age, p.gender, p.occupation,
              p.photo_url, p.photo_masked_url, p.verified_age
         FROM users u
    LEFT JOIN user_profiles p ON p.user_id = u.id
        WHERE u.id = $1`, [userId]);
        return res.json({ profile: r.rows[0] });
    }
    catch (e) {
        const msg = e?.message || String(e);
        if (msg.startsWith('unauthenticated')) {
            return res.status(401).json({ error: 'unauthenticated' });
        }
        console.error('[profile:put]', msg);
        return res.status(500).json({ error: 'server_error' });
    }
});
exports.default = router;
