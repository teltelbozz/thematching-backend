// src/routes/groups.ts
import { Router } from "express";
import type { Pool } from "pg";

const router = Router();

/**
 * GET /groups/:token
 * - 完全共有型（認証なし）
 * - token 有効期限：イベント（slot_dt）翌日いっぱい（JST）まで
 * - 表示：nickname / age / gender / occupation / photo（masked優先、なければ通常）
 */
router.get("/:token", async (req, res) => {
  const token = String(req.params.token || "").trim();
  const db = req.app.locals.db as Pool;

  if (!token) return res.status(400).json({ error: "invalid_token" });

  try {
    // 1) group 取得 + 期限計算（JSTで翌日いっぱい）
    // expires_at = 「slot日の翌々日 00:00 JST（直前まで有効）」にして判定しやすくする
    const gRes = await db.query(
      `
      SELECT
        id,
        token,
        slot_dt,
        location,
        type_mode,
        status,
        (slot_dt AT TIME ZONE 'Asia/Tokyo') AS slot_jst,
        (
          (date_trunc('day', slot_dt AT TIME ZONE 'Asia/Tokyo') + interval '2 day')
          AT TIME ZONE 'Asia/Tokyo'
        ) AS expires_at
      FROM matched_groups
      WHERE token = $1
      LIMIT 1
      `,
      [token]
    );

    const group = gRes.rows[0];
    if (!group) {
      return res.status(404).json({ error: "group_not_found" });
    }

    // 期限切れ判定（now() は timestamptz）
    const exp = new Date(group.expires_at).getTime();
    const now = Date.now();
    if (!Number.isFinite(exp) || now >= exp) {
      return res.status(404).json({ error: "group_expired" });
    }

    // 2) メンバー + プロフィールを1発で取得（順序は female -> male -> user_id）
    const mRes = await db.query(
      `
      SELECT
        mgm.user_id,
        mgm.gender,
        up.nickname,
        up.age,
        up.occupation,
        COALESCE(up.photo_masked_url, up.photo_url) AS photo_url
      FROM matched_group_members mgm
      LEFT JOIN user_profiles up ON up.user_id = mgm.user_id
      WHERE mgm.group_id = $1
      ORDER BY
        CASE mgm.gender WHEN 'female' THEN 0 WHEN 'male' THEN 1 ELSE 2 END,
        mgm.user_id
      `,
      [group.id]
    );

    return res.json({
      ok: true,
      group: {
        id: Number(group.id),
        token: group.token,
        status: group.status,
        slot_dt: group.slot_dt,      // ISO (timestamptz)
        slot_jst: group.slot_jst,    // "YYYY-MM-DD HH:MM:SS"
        location: group.location,
        type_mode: group.type_mode,
        expires_at: group.expires_at // ISO (timestamptz)
      },
      members: mRes.rows.map((r: any) => ({
        user_id: Number(r.user_id),
        gender: r.gender,
        nickname: r.nickname ?? null,
        age: r.age == null ? null : Number(r.age),
        occupation: r.occupation ?? null,
        photo_url: r.photo_url ?? null,
      })),
    });
  } catch (e) {
    console.error("[GET /groups/:token] error", e);
    return res.status(500).json({ error: "server_error" });
  }
});

export default router;