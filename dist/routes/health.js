"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const router = (0, express_1.Router)();
router.get('/', (req, res) => {
    return res.json({ ok: true });
});
router.get('/db', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const r = await db.query('SELECT NOW()');
        return res.json({ now: r.rows[0].now });
    }
    catch (e) {
        console.error('[health/db] error:', e?.message);
        return res.status(500).json({ error: 'db_unavailable' });
    }
});
exports.default = router;
