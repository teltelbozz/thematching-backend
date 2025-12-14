"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// src/routes/adminUserDetail.ts
const express_1 = require("express");
const router = (0, express_1.Router)();
function requireAdmin(req, res) {
    const secret = process.env.ADMIN_SECRET || process.env.CRON_SECRET; // 一覧と同じ仕様
    const auth = req.header("authorization") || "";
    if (!secret || auth !== `Bearer ${secret}`) {
        console.warn("[admin/user-detail] unauthorized");
        res.status(401).json({ error: "unauthorized" });
        return false;
    }
    return true;
}
function getDb(req) {
    const db = req.app?.locals?.db;
    if (!db)
        throw new Error("db_not_initialized");
    return db;
}
/**
 * GET /admin/users/:userId
 * - ユーザ基本 + プロフィール（一覧より詳細）
 */
router.get("/users/:userId", async (req, res) => {
    if (!requireAdmin(req, res))
        return;
    const db = getDb(req);
    const userId = Number(req.params.userId);
    if (!Number.isFinite(userId)) {
        return res.status(400).json({ error: "invalid userId" });
    }
    try {
        const sql = `
      SELECT
        u.id          AS user_id,
        u.line_user_id,
        u.created_at,
        p.nickname,
        p.gender,
        p.age,
        p.verified_age
      FROM users u
      LEFT JOIN user_profiles p ON p.user_id = u.id
      WHERE u.id = $1
      LIMIT 1
    `;
        const { rows } = await db.query(sql, [userId]);
        if (rows.length === 0) {
            return res.status(404).json({ error: "not_found" });
        }
        const r = rows[0];
        return res.json({
            ok: true,
            user: {
                user_id: Number(r.user_id),
                line_user_id: r.line_user_id,
                created_at: r.created_at,
                nickname: r.nickname,
                gender: r.gender,
                age: r.age == null ? null : Number(r.age),
                verified_age: Boolean(r.verified_age),
            },
        });
    }
    catch (e) {
        console.error("[admin/users/:userId] error", e);
        return res.status(500).json({ error: e?.message || "server_error" });
    }
});
/**
 * GET /admin/users/:userId/slots?limit=200
 * - user_setup に紐づく slot 一覧（status も含む）
 * - slot_dt は timestamptz のまま返しつつ、slot_jst も返す
 */
router.get("/users/:userId/slots", async (req, res) => {
    if (!requireAdmin(req, res))
        return;
    const db = getDb(req);
    const userId = Number(req.params.userId);
    if (!Number.isFinite(userId)) {
        return res.status(400).json({ error: "invalid userId" });
    }
    const limit = Math.min(Number(req.query.limit || 200), 500);
    try {
        const sql = `
      SELECT
        s.id            AS setup_id,
        s.week_key,
        s.type_mode,
        s.location,
        s.cost_pref,
        s.venue_pref,
        s.status,
        s.submitted_at,
        sl.id           AS slot_id,
        sl.slot_dt,
        (sl.slot_dt AT TIME ZONE 'Asia/Tokyo') AS slot_jst
      FROM user_setup s
      JOIN user_setup_slots sl ON sl.user_setup_id = s.id
      WHERE s.user_id = $1
      ORDER BY sl.slot_dt DESC, sl.id DESC
      LIMIT $2
    `;
        const { rows } = await db.query(sql, [userId, limit]);
        return res.json({
            ok: true,
            userId,
            count: rows.length,
            slots: rows.map((r) => ({
                setup_id: Number(r.setup_id),
                week_key: r.week_key,
                type_mode: r.type_mode,
                location: r.location,
                cost_pref: r.cost_pref,
                venue_pref: r.venue_pref,
                status: r.status,
                submitted_at: r.submitted_at,
                slot_id: Number(r.slot_id),
                slot_dt: r.slot_dt, // ISO で返る（timestamptz）
                slot_jst: r.slot_jst, // "YYYY-MM-DD HH:MM:SS" (JST)
            })),
        });
    }
    catch (e) {
        console.error("[admin/users/:userId/slots] error", e);
        return res.status(500).json({ error: e?.message || "server_error" });
    }
});
exports.default = router;
