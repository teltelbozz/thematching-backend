"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const tokenService_js_1 = require("../auth/tokenService.js");
const router = (0, express_1.Router)();
function normalizeUid(v) {
    if (typeof v === 'number' && Number.isFinite(v))
        return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)))
        return Number(v);
    return null;
}
// POST /api/payments/setup  …ダミー登録（フラグ立て）
/**
 * Body (任意):
 *   { brand?: string; last4?: string }
 * 今はDBに実カード情報は保存しません（将来のStripe等に置換しやすく）
 */
router.post('/setup', async (req, res) => {
    try {
        const token = (0, tokenService_js_1.readBearer)(req);
        if (!token)
            return res.status(401).json({ error: 'unauthenticated' });
        const { payload } = await (0, tokenService_js_1.verifyAccess)(token);
        const uid = normalizeUid(payload.uid);
        if (uid == null)
            return res.status(401).json({ error: 'unauthenticated' });
        const db = req.app.locals.db;
        await db.query(`UPDATE users SET payment_method_set = true WHERE id = $1`, [uid]);
        return res.json({
            ok: true,
            payment_method_set: true,
            // echo back (dummy)
            sample: { brand: req.body?.brand ?? 'visa', last4: req.body?.last4 ?? '4242' },
        });
    }
    catch (e) {
        console.error('[payments:setup]', e?.message || e);
        return res.status(500).json({ error: 'server_error' });
    }
});
exports.default = router;
