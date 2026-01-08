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
// POST /api/verify/age  …ダミーで verified_age=true にする
// Body: { method?: "line" | "upload_id" } など（今は無視してOK）
router.post('/age', async (req, res) => {
    try {
        const token = (0, tokenService_1.readBearer)(req);
        if (!token)
            return res.status(401).json({ error: 'unauthenticated' });
        const { payload } = await (0, tokenService_1.verifyAccess)(token);
        const uid = normalizeUid(payload.uid);
        if (uid == null)
            return res.status(401).json({ error: 'unauthenticated' });
        const db = req.app.locals.db;
        await db.query(`UPDATE user_profiles SET verified_age = true, updated_at = NOW()
       WHERE user_id = $1`, [uid]);
        const r = await db.query(`SELECT verified_age FROM user_profiles WHERE user_id = $1`, [uid]);
        return res.json({ ok: true, verified_age: r.rows[0]?.verified_age === true });
    }
    catch (e) {
        console.error('[verify:age]', e?.message || e);
        return res.status(500).json({ error: 'server_error' });
    }
});
exports.default = router;
