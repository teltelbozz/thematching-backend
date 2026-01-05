// src/routes/adminUserDetail.ts
import { Router } from "express";
import type { Pool } from "pg";

const router = Router();

function requireAdmin(req: any, res: any): boolean {
  const secret = process.env.ADMIN_SECRET || process.env.CRON_SECRET;
  const auth = req.header("authorization") || "";

  if (!secret || auth !== `Bearer ${secret}`) {
    console.warn("[admin/user-detail] unauthorized");
    res.status(401).json({ error: "unauthorized" });
    return false;
  }
  return true;
}

function getDb(req: any): Pool {
  const db = req.app?.locals?.db as Pool | undefined;
  if (!db) throw new Error("db_not_initialized");
  return db;
}

/**
 * GET /admin/users/:userId
 * - ユーザ基本 + プロフィール（一覧より詳細）
 */
/**
 * GET /admin/users/:userId
 * - ユーザ基本 + プロフィール（一覧より詳細）
 * - ✅ photo_url / photo_masked_url を返す
 */
router.get("/users/:userId", async (req, res) => {
  if (!requireAdmin(req, res)) return;

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
        p.verified_age,
        p.photo_url,
        p.photo_masked_url
      FROM users u
      LEFT JOIN user_profiles p ON p.user_id = u.id
      WHERE u.id = $1
      LIMIT 1
    `;
    const { rows } = await db.query(sql, [userId]);

    if (rows.length === 0) {
      return res.status(404).json({ error: "not_found" });
    }

    const r: any = rows[0];
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

        // ✅ 追加
        photo_url: r.photo_url ?? null,
        photo_masked_url: r.photo_masked_url ?? null,
      },
    });
  } catch (e: any) {
    console.error("[admin/users/:userId] error", e);
    return res.status(500).json({ error: e?.message || "server_error" });
  }
});

/**
 * GET /admin/users/:userId/slots?limit=200
 * - ✅ スロット単位の処理ステータスを返す（user_setup_slots.status）
 * - 既存の slots[].status を "slot_status" に差し替える（デグレ回避）
 * - 親の status は setup_status として返す（必要なら）
 */
router.get("/users/:userId/slots", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const db = getDb(req);
  const userId = Number(req.params.userId);
  if (!Number.isFinite(userId)) {
    return res.status(400).json({ error: "invalid userId" });
  }

  const limit = Math.min(Number(req.query.limit || 200), 500);

  // 任意: status フィルタ（slot_statusで絞る）
  const status = (req.query.status as string | undefined) || undefined;
  if (status && status !== "active" && status !== "processed") {
    return res.status(400).json({ error: "invalid status filter" });
  }

  try {
    const where: string[] = ["s.user_id = $1"];
    const params: any[] = [userId];
    let i = 2;

    if (status) {
      where.push(`sl.status = $${i++}`);
      params.push(status);
    }

    const sql = `
      SELECT
        s.id            AS setup_id,
        s.week_key,
        s.type_mode,
        s.location,
        s.cost_pref,
        s.venue_pref,
        s.status        AS setup_status,   -- 親（参考用）
        s.submitted_at,

        sl.id           AS slot_id,
        sl.slot_dt,
        sl.status       AS slot_status,    -- ✅ これが欲しいやつ

        (sl.slot_dt AT TIME ZONE 'Asia/Tokyo') AS slot_jst
      FROM user_setup s
      JOIN user_setup_slots sl ON sl.user_setup_id = s.id
      WHERE ${where.join(" AND ")}
      ORDER BY sl.slot_dt DESC, sl.id DESC
      LIMIT $${i}
    `;
    params.push(limit);

    const { rows } = await db.query(sql, params);

    return res.json({
      ok: true,
      userId,
      count: rows.length,
      slots: rows.map((r: any) => ({
        setup_id: Number(r.setup_id),
        week_key: r.week_key,
        type_mode: r.type_mode,
        location: r.location,
        cost_pref: r.cost_pref,
        venue_pref: r.venue_pref,

        // ✅ 既存互換：slots[].status は slot_status を返す（ここが最重要）
        status: r.slot_status,

        // 参考: 親の状態も返す（UIで必要になったら使える）
        setup_status: r.setup_status,

        submitted_at: r.submitted_at,
        slot_id: Number(r.slot_id),
        slot_dt: r.slot_dt,   // ISO (timestamptz)
        slot_jst: r.slot_jst, // "YYYY-MM-DD HH:MM:SS" (JST)
      })),
    });
  } catch (e: any) {
    console.error("[admin/users/:userId/slots] error", e);
    return res.status(500).json({ error: e?.message || "server_error" });
  }
});

export default router;