// src/routes/groupPublic.ts
import { Router } from "express";
import type { Pool } from "pg";

const router = Router();

function getDb(req: any): Pool {
  const db = req.app?.locals?.db as Pool | undefined;
  if (!db) throw new Error("db_not_initialized");
  return db;
}

// JSTで「翌日 23:59:59」まで有効にする
// 例: slot_dt = 2024-12-05 19:00 JST -> expires = 2024-12-06 23:59:59 JST
function buildExpiryExpr() {
  // slot_dt を JST に変換して日付に落とし、+1日して、その日の 23:59:59(JST) にする
  // timestamptz に戻すため AT TIME ZONE 'Asia/Tokyo' を逆適用
  return `
    (
      (
        (date_trunc('day', (mg.slot_dt AT TIME ZONE 'Asia/Tokyo')) + interval '1 day')
        + interval '23 hours 59 minutes 59 seconds'
      ) AT TIME ZONE 'Asia/Tokyo'
    )
  `;
}

/**
 * GET /api/g/:token
 * - 完全共有型（token知っていれば見れる）
 * - 期限: イベント翌日 23:59:59(JST) まで
 */
router.get("/:token", async (req, res) => {
  const token = String(req.params.token || "").trim();
  if (!token) return res.status(400).json({ error: "invalid_token" });

  const db = getDb(req);

  try {
    const expiryExpr = buildExpiryExpr();

    // 1) group を引く（期限も一緒に計算）
    const groupSql = `
      SELECT
        mg.id,
        mg.token,
        mg.slot_dt,
        mg.location,
        mg.type_mode,
        mg.status,
        ${expiryExpr} AS expires_at
      FROM matched_groups mg
      WHERE mg.token = $1
      LIMIT 1
    `;
    const g = await db.query(groupSql, [token]);
    if (g.rows.length === 0) return res.status(404).json({ error: "not_found" });

    const group = g.rows[0];

    // 2) 期限チェック
    const expiresAt = new Date(group.expires_at);
    const now = new Date();
    if (now.getTime() > expiresAt.getTime()) {
      return res.status(410).json({
        error: "expired",
        token,
        expires_at: group.expires_at,
      });
    }

    // 3) members
    const membersSql = `
      SELECT
        mgm.user_id,
        mgm.gender,
        p.nickname,
        p.age,
        p.occupation,
        p.photo_url,
        p.photo_masked_url
      FROM matched_group_members mgm
      JOIN user_profiles p ON p.user_id = mgm.user_id
      WHERE mgm.group_id = $1
      ORDER BY
        CASE mgm.gender WHEN 'female' THEN 0 ELSE 1 END,
        mgm.user_id
    `;
    const m = await db.query(membersSql, [group.id]);

    return res.json({
      ok: true,
      group: {
        id: Number(group.id),
        token: group.token,
        slot_dt: group.slot_dt,
        location: group.location,
        type_mode: group.type_mode,
        status: group.status,
        expires_at: group.expires_at,
      },
      members: m.rows.map((r: any) => ({
        user_id: Number(r.user_id),
        gender: r.gender,
        nickname: r.nickname,
        age: r.age == null ? null : Number(r.age),
        occupation: r.occupation ?? null,
        // v0は mask無しでOK（後で切替可能）
        photo_url: r.photo_url ?? null,
        photo_masked_url: r.photo_masked_url ?? null,
      })),
    });
  } catch (e: any) {
    console.error("[api/g/:token] error", e);
    return res.status(500).json({ error: e?.message || "server_error" });
  }
});

export default router;