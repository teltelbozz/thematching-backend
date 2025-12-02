// src/routes/groups.ts
import { Router } from "express";
import type { Pool } from "pg";

const router = Router();

/**
 * GET /groups/:token
 * - グループのメンバー情報を返す
 * - token → matched_groups.id を検索
 * - matched_group_members からメンバー一覧取得
 * - users / user_profiles からプロフィール取得
 */
router.get("/:token", async (req, res) => {
  const token = req.params.token;
  const db = req.app.locals.db as Pool;

  try {
    // 1. token → group_id を検索
    const gRes = await db.query(
      `SELECT id, slot_dt, location, type_mode, status
       FROM matched_groups
       WHERE token = $1
       LIMIT 1`,
      [token]
    );

    const group = gRes.rows[0];
    if (!group) {
      return res.status(404).json({ error: "group_not_found" });
    }

    // 2. メンバー一覧
    const mRes = await db.query(
      `SELECT user_id, gender
       FROM matched_group_members
       WHERE group_id = $1
       ORDER BY gender, user_id`,
      [group.id]
    );

    const members = mRes.rows;

    if (members.length === 0) {
      return res.json({
        group,
        members: []
      });
    }

    // 3. プロフィール取得
    const ids = members.map((m) => m.user_id);
    const pRes = await db.query(
      `SELECT 
         u.id,
         up.nickname,
         up.age,
         up.gender,
         up.photo_masked_url
       FROM users u
       LEFT JOIN user_profiles up ON up.user_id = u.id
       WHERE u.id = ANY($1::bigint[])`,
      [ids]
    );

    const profMap = new Map<number, any>();
    for (const row of pRes.rows) {
      profMap.set(row.id, row);
    }

    // 4. 結合して返す
    const memberProfiles = members.map((m) => ({
      user_id: m.user_id,
      gender: m.gender,
      profile: profMap.get(m.user_id) || null
    }));

    return res.json({
      group,
      members: memberProfiles
    });

  } catch (e) {
    console.error("[GET /groups/:token] error", e);
    return res.status(500).json({ error: "server_error" });
  }
});

export default router;