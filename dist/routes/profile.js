"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const tokenService_1 = require("../auth/tokenService");
const router = (0, express_1.Router)();
function normalizeUid(v) {
    if (typeof v === 'number' && Number.isFinite(v))
        return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)))
        return Number(v);
    return null;
}
// GET /api/profile  …自分のプロフィール取得
router.get('/', async (req, res) => {
    try {
        const token = (0, tokenService_1.readBearer)(req);
        if (!token)
            return res.status(401).json({ error: 'unauthenticated' });
        const { payload } = await (0, tokenService_1.verifyAccess)(token);
        const uid = normalizeUid(payload.uid);
        if (uid == null)
            return res.status(401).json({ error: 'unauthenticated' });
        const db = req.app.locals.db;
        const r = await db.query(`SELECT u.id, u.line_user_id, u.payment_method_set,
              p.nickname, p.age, p.gender, p.occupation,
              p.photo_url, p.photo_masked_url, p.verified_age
       FROM users u
       LEFT JOIN user_profiles p ON p.user_id = u.id
       WHERE u.id = $1`, [uid]);
        if (!r.rows[0])
            return res.json({ profile: { id: uid } }); // まだ未登録でも 200
        return res.json({ profile: r.rows[0] });
    }
    catch (e) {
        console.error('[profile:get]', e?.message || e);
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
        const uid = normalizeUid(payload.uid);
        if (uid == null)
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
        const db = req.app.locals.db;
        await db.query(`INSERT INTO user_profiles (user_id, nickname, age, gender, occupation, photo_url, photo_masked_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id) DO UPDATE SET
         nickname = COALESCE(EXCLUDED.nickname, user_profiles.nickname),
         age = COALESCE(EXCLUDED.age, user_profiles.age),
         gender = COALESCE(EXCLUDED.gender, user_profiles.gender),
         occupation = COALESCE(EXCLUDED.occupation, user_profiles.occupation),
         photo_url = COALESCE(EXCLUDED.photo_url, user_profiles.photo_url),
         photo_masked_url = COALESCE(EXCLUDED.photo_masked_url, user_profiles.photo_masked_url),
         updated_at = NOW()`, [uid, nickname ?? null, age ?? null, gender ?? null, occupation ?? null, photo_url ?? null, photo_masked_url ?? null]);
        const r = await db.query(`SELECT u.id, u.line_user_id, u.payment_method_set,
              p.nickname, p.age, p.gender, p.occupation,
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
exports.default = router;
