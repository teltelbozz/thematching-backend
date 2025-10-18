"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// src/routes/profile.ts
const express_1 = require("express");
const tokenService_1 = require("../auth/tokenService");
const router = (0, express_1.Router)();
/** JWTのuidから、内部ユーザーID（数値）を解決する */
async function resolveUserIdFromToken(db, uidClaim) {
    // 1) すでに数値ならそのまま
    if (typeof uidClaim === 'number' && Number.isFinite(uidClaim))
        return uidClaim;
    // 2) 数値文字列なら数値化
    if (typeof uidClaim === 'string' && uidClaim.trim() !== '' && Number.isFinite(Number(uidClaim))) {
        return Number(uidClaim);
    }
    // 3) 文字列なら LINE の sub / line_user_id とみなして users を解決（無ければ作成）
    if (typeof uidClaim === 'string' && uidClaim.trim() !== '') {
        const lineUserId = uidClaim.trim();
        // 既存検索
        const r1 = await db.query(`SELECT id FROM users WHERE line_user_id = $1 LIMIT 1`, [lineUserId]);
        if (r1.rows[0]?.id)
            return r1.rows[0].id;
        // 無ければ作成（最低限）
        const r2 = await db.query(`INSERT INTO users (line_user_id)
       VALUES ($1)
       ON CONFLICT (line_user_id) DO UPDATE SET line_user_id = EXCLUDED.line_user_id
       RETURNING id`, [lineUserId]);
        return r2.rows[0]?.id ?? null;
    }
    // 4) それ以外は解決不能
    return null;
}
// GET /api/profile  …自分のプロフィール取得
router.get('/', async (req, res) => {
    try {
        const token = (0, tokenService_1.readBearer)(req);
        if (!token)
            return res.status(401).json({ error: 'unauthenticated' });
        const { payload } = await (0, tokenService_1.verifyAccess)(token);
        const db = req.app.locals.db;
        const userId = await resolveUserIdFromToken(db, payload.uid);
        if (userId == null)
            return res.status(401).json({ error: 'unauthenticated' });
        const r = await db.query(`SELECT u.id, u.line_user_id, u.payment_method_set,
              p.nickname, p.age, p.gender, p.occupation,
              p.photo_url, p.photo_masked_url, p.verified_age
         FROM users u
    LEFT JOIN user_profiles p ON p.user_id = u.id
        WHERE u.id = $1`, [userId]);
        if (!r.rows[0])
            return res.json({ profile: { id: userId } }); // 未登録でも200で空を返す
        return res.json({ profile: r.rows[0] });
    }
    catch (e) {
        console.error('[profile:get]', e?.stack || e);
        return res.status(500).json({ error: 'server_error' });
    }
});
// PUT /api/profile  …自分のプロフィール作成/更新（upsert）
router.put('/', async (req, res) => {
    try {
        const token = (0, tokenService_1.readBearer)(req);
        if (!token)
            return res.status(401).json({ error: 'unauthenticated' });
        const { payload } = await (0, tokenService_1.verifyAccess)(token);
        const db = req.app.locals.db;
        const userId = await resolveUserIdFromToken(db, payload.uid);
        if (userId == null)
            return res.status(401).json({ error: 'unauthenticated' });
        const { nickname, age, gender, occupation, photo_url, photo_masked_url } = req.body || {};
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
        // user_profiles を upsert
        await db.query(`INSERT INTO user_profiles (user_id, nickname, age, gender, occupation, photo_url, photo_masked_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id) DO UPDATE SET
         nickname = COALESCE(EXCLUDED.nickname, user_profiles.nickname),
         age = COALESCE(EXCLUDED.age, user_profiles.age),
         gender = COALESCE(EXCLUDED.gender, user_profiles.gender),
         occupation = COALESCE(EXCLUDED.occupation, user_profiles.occupation),
         photo_url = COALESCE(EXCLUDED.photo_url, user_profiles.photo_url),
         photo_masked_url = COALESCE(EXCLUDED.photo_masked_url, user_profiles.photo_masked_url),
         updated_at = NOW()`, [
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
        console.error('[profile:put]', e?.stack || e);
        return res.status(500).json({ error: 'server_error' });
    }
});
exports.default = router;
