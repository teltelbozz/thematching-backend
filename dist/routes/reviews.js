"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const router = (0, express_1.Router)();
// POST /reviews
router.post('/', async (req, res) => {
    const db = req.app.locals.db;
    const userId = req.userId || 1; // devAuth
    const { match_id, rating, comment } = req.body;
    const r = await db.query(`INSERT INTO reviews (match_id, user_id, rating, comment)
     VALUES ($1, $2, $3, $4)
     RETURNING *`, [match_id, userId, rating, comment]);
    return res.json(r.rows[0]);
});
exports.default = router;
