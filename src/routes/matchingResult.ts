// src/routes/matchingResult.ts
import { Router } from "express";
import { pool } from "../db";

const router = Router();

/**
 * GET /admin/matching-results
 *
 * 指定 slotDt のマッチング結果を一覧表示する API
 *   - matched_groups
 *   - matched_group_members（男女別に展開）
 *   - user_profiles と users を JOIN してユーザ情報を付与
 *
 * 例:
 *   /admin/matching-results?slotDt=2025-12-05T19:00:00+09:00
 */
router.get("/matching-results", async (req, res) => {
  try {
    const slotDt = req.query.slotDt as string;
    if (!slotDt) {
      return res.status(400).json({ error: "slotDt is required" });
    }

    // ==========================================================
    // 1. matched_groups を取得
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
    const groupsRes = await pool.query(groupsSql, [slotDt]);
    const groups = groupsRes.rows;

    if (groups.length === 0) {
      return res.json({
        ok: true,
        slotDt,
        groups: [],
        message: "No matched groups for this slotDt",
      });
    }

    const groupIds = groups.map((g) => g.id);

    // ==========================================================
    // 2. グループごとのメンバーをまとめて取得
    // ==========================================================
    const membersSql = `
      SELECT
        mgm.group_id,
        mgm.user_id,
        mgm.gender,
        u.line_user_id,
        p.nickname,
        p.age,
        p.gender AS profile_gender
      FROM matched_group_members mgm
        JOIN users u ON u.id = mgm.user_id
        JOIN user_profiles p ON p.user_id = u.id
      WHERE mgm.group_id = ANY($1::bigint[])
      ORDER BY mgm.group_id, mgm.gender, mgm.user_id
    `;
    const membersRes = await pool.query(membersSql, [groupIds]);

    // group_id → [{user info}, ...]
    const memberMap: Record<number, any[]> = {};
    for (const m of membersRes.rows) {
      if (!memberMap[m.group_id]) memberMap[m.group_id] = [];
      memberMap[m.group_id].push({
        user_id: m.user_id,
        gender: m.gender,
        nickname: m.nickname,
        age: m.age,
        line_user_id: m.line_user_id,
      });
    }

    // ==========================================================
    // 3. グループ + メンバーを組み立てる
    // ==========================================================
    const result = groups.map((g) => {
      const mem = memberMap[g.id] || [];
      return {
        groupId: g.id,
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
    // 4. 応答
    // ==========================================================
    return res.json({
      ok: true,
      slotDt,
      count: result.length,
      groups: result,
    });
  } catch (e: any) {
    console.error("[GET /admin/matching-results] error", e);
    return res.status(500).json({
      error: e?.message ?? "server_error",
    });
  }
});

export default router;