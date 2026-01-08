"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// src/routes/adminUsers.ts
const express_1 = require("express");
const db_1 = require("../db");
const router = (0, express_1.Router)();
/**
 * GET /admin/users
 * - 管理画面向けユーザ一覧（デモHTMLでも使う）
 * - 認証: Authorization: Bearer <ADMIN_SECRET or CRON_SECRET>
 */
router.get("/users", async (req, res) => {
    const secret = process.env.ADMIN_SECRET || process.env.CRON_SECRET;
    const auth = req.header("authorization") || "";
    if (!secret || auth !== `Bearer ${secret}`) {
        console.warn("[admin/users] unauthorized");
        return res.status(401).json({ error: "unauthorized" });
    }
    const gender = req.query.gender || undefined;
    const q = req.query.q || undefined;
    const limit = Math.min(Number(req.query.limit || 200), 500);
    const offset = Math.max(Number(req.query.offset || 0), 0);
    try {
        const where = [];
        const params = [];
        let i = 1;
        if (gender === "male" || gender === "female") {
            where.push(`p.gender = $${i++}`);
            params.push(gender);
        }
        if (q && q.trim()) {
            where.push(`(p.nickname ILIKE $${i} OR u.line_user_id ILIKE $${i} OR u.id::text = $${i})`);
            params.push(`%${q.trim()}%`);
            i++;
        }
        const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
        const sql = `
      SELECT
        u.id AS user_id,
        u.line_user_id,
        u.created_at,

        p.nickname,
        p.gender,
        p.age,
        p.verified_age,

        -- ✅ 追加
        p.kyc_verified,
        p.kyc_verified_at
      FROM users u
      JOIN user_profiles p ON p.user_id = u.id
      ${whereSql}
      ORDER BY u.id
      LIMIT $${i++} OFFSET $${i++}
    `;
        params.push(limit, offset);
        const { rows } = await db_1.pool.query(sql, params);
        return res.json({
            ok: true,
            count: rows.length,
            users: rows.map((r) => ({
                user_id: Number(r.user_id),
                line_user_id: r.line_user_id,
                created_at: r.created_at,
                nickname: r.nickname ?? null,
                gender: r.gender === "female" ? "female" : (r.gender === "male" ? "male" : r.gender),
                age: r.age == null ? null : Number(r.age),
                verified_age: Boolean(r.verified_age),
                // ✅ 追加
                kyc_verified: Boolean(r.kyc_verified),
                kyc_verified_at: r.kyc_verified_at ?? null,
            })),
        });
    }
    catch (e) {
        console.error("[admin/users] error", e);
        return res.status(500).json({ error: e?.message || "server_error" });
    }
});
exports.default = router;
