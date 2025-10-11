"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const router = (0, express_1.Router)();
// GET /api/calendar/popular?from=2025-09-20&to=2025-10-20
router.get('/popular', async (req, res) => {
    try {
        const db = req.app.locals.db;
        // 単純に popular_days ビューを返す。必要なら from/to で絞り込み。
        const r = await db.query(`SELECT day, slot_count FROM popular_days ORDER BY day ASC`);
        res.json({ days: r.rows });
    }
    catch (e) {
        console.error('[calendar:popular]', e?.message || e);
        res.status(500).json({ error: 'server_error' });
    }
});
exports.default = router;
