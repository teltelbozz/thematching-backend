"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// src/routes/matchingResult.ts
const express_1 = require("express");
const router = (0, express_1.Router)();
function requireAdmin(req, res) {
    const secret = process.env.ADMIN_SECRET || process.env.CRON_SECRET; // 他admin系と同じ
    const auth = req.header("authorization") || "";
    if (!secret || auth !== `Bearer ${secret}`) {
        console.warn("[admin/matching-results] unauthorized");
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
 * GET /admin/matching-results?slotDt=...
 *
 * 指定 slotDt のマッチング結果（groups） + unmatchedUsers を返す
 * - groups: matched_groups + members
 * - unmatchedUsers: その slotDt に応募（user_setup_slots）していたが、group member になっていないユーザ
 */
router.get("/matching-results", async (req, res) => {
    if (!requireAdmin(req, res))
        return;
    try {
        const db = getDb(req);
        const slotDt = req.query.slotDt;
        if (!slotDt) {
            return res.status(400).json({ error: "slotDt is required" });
        }
        // ==========================================================
        // 1) matched_groups を取得（0件でも続行）
        // ==========================================================
        const groupsSql = `
      SELECT
        id,
        slot_dt,
        location,
        type_mode,
        status,
        token
      FROM matched_groups
      WHERE slot_dt = $1
      ORDER BY id
    `;
        const groupsRes = await db.query(groupsSql, [slotDt]);
        const groups = groupsRes.rows;
        const groupIds = groups.map((g) => Number(g.id)).filter(Number.isFinite);
        // ==========================================================
        // 2) members（グループの参加者）をまとめて取得
        //    ※ group が 0 件でも unmatched 計算用に "matchedUserIds" は別SQLで取る
        // ==========================================================
        const memberMap = {};
        if (groupIds.length > 0) {
            const membersSql = `
        SELECT
          mgm.group_id,
          mgm.user_id,
          mgm.gender,
          u.line_user_id,
          p.nickname,
          p.age
        FROM matched_group_members mgm
          JOIN users u ON u.id = mgm.user_id
          JOIN user_profiles p ON p.user_id = u.id
        WHERE mgm.group_id = ANY($1::bigint[])
        ORDER BY mgm.group_id, mgm.gender, mgm.user_id
      `;
            const membersRes = await db.query(membersSql, [groupIds]);
            for (const m of membersRes.rows) {
                const gid = Number(m.group_id);
                if (!memberMap[gid])
                    memberMap[gid] = [];
                memberMap[gid].push({
                    user_id: Number(m.user_id),
                    gender: m.gender,
                    nickname: m.nickname,
                    age: m.age == null ? null : Number(m.age),
                    line_user_id: m.line_user_id,
                });
            }
        }
        // ==========================================================
        // 3) groups 組み立て
        // ==========================================================
        const resultGroups = groups.map((g) => {
            const gid = Number(g.id);
            const mem = memberMap[gid] || [];
            return {
                groupId: String(gid),
                slotDt: g.slot_dt,
                location: g.location,
                typeMode: g.type_mode,
                status: g.status,
                token: g.token,
                female: mem.filter((m) => m.gender === "female"),
                male: mem.filter((m) => m.gender === "male"),
            };
        });
        // ==========================================================
        // 4) unmatchedUsers（候補者 - マッチ済）
        //
        // 候補者: user_setup_slots(slot_dt一致) -> user_setup -> users -> profiles
        // マッチ済: matched_groups(slot_dt一致) -> matched_group_members
        // ==========================================================
        const unmatchedSql = `
      WITH candidates AS (
        SELECT DISTINCT
          u.id AS user_id,
          u.line_user_id,
          p.nickname,
          p.gender,
          p.age,
          p.verified_age
        FROM user_setup_slots sl
        JOIN user_setup s ON s.id = sl.user_setup_id
        JOIN users u ON u.id = s.user_id
        JOIN user_profiles p ON p.user_id = u.id
        WHERE sl.slot_dt = $1
      ),
      matched AS (
        SELECT DISTINCT mgm.user_id
        FROM matched_groups mg
        JOIN matched_group_members mgm ON mgm.group_id = mg.id
        WHERE mg.slot_dt = $1
      )
      SELECT
        c.user_id,
        c.line_user_id,
        c.nickname,
        c.gender,
        c.age,
        c.verified_age
      FROM candidates c
      WHERE NOT EXISTS (
        SELECT 1 FROM matched m WHERE m.user_id = c.user_id
      )
      ORDER BY c.user_id
    `;
        const unmatchedRes = await db.query(unmatchedSql, [slotDt]);
        const unmatchedUsers = unmatchedRes.rows.map((r) => ({
            user_id: Number(r.user_id),
            line_user_id: r.line_user_id,
            nickname: r.nickname,
            gender: r.gender,
            age: r.age == null ? null : Number(r.age),
            verified_age: Boolean(r.verified_age),
        }));
        // ==========================================================
        // 5) 応答
        // ==========================================================
        return res.json({
            ok: true,
            slotDt,
            count: resultGroups.length,
            groups: resultGroups,
            unmatchedCount: unmatchedUsers.length,
            unmatchedUsers,
        });
    }
    catch (e) {
        console.error("[GET /admin/matching-results] error", e);
        return res.status(500).json({
            error: e?.message ?? "server_error",
        });
    }
});
exports.default = router;
