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

function parseUserId(req: any, res: any): number | null {
  const userId = Number(req.params.userId);
  if (!Number.isFinite(userId)) {
    res.status(400).json({ error: "invalid userId" });
    return null;
  }
  return userId;
}

/**
 * GET /admin/users/:userId
 * - ユーザ基本 + プロフィール（一覧より詳細）
 * - ✅ photo_url / photo_masked_url を返す
 * - ✅ kyc_verified / kyc_verified_at を返す
 */
router.get("/users/:userId", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const db = getDb(req);
  const userId = parseUserId(req, res);
  if (userId == null) return;

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
        p.photo_masked_url,

        p.kyc_verified,
        p.kyc_verified_at
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

        nickname: r.nickname ?? null,
        gender: r.gender ?? null,
        age: r.age == null ? null : Number(r.age),
        verified_age: Boolean(r.verified_age),

        photo_url: r.photo_url ?? null,
        photo_masked_url: r.photo_masked_url ?? null,

        kyc_verified: Boolean(r.kyc_verified),
        kyc_verified_at: r.kyc_verified_at ?? null,
      },
    });
  } catch (e: any) {
    console.error("[admin/users/:userId] error", e);
    return res.status(500).json({ error: e?.message || "server_error" });
  }
});

/**
 * POST /admin/users/:userId/kyc
 * - 管理画面からKYC済みフラグをON/OFF
 * body: { verified: boolean }
 */
router.post("/users/:userId/kyc", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const db = getDb(req);
  const userId = parseUserId(req, res);
  if (userId == null) return;

  const verified = (req.body || {})?.verified;
  if (typeof verified !== "boolean") {
    return res.status(400).json({ error: "invalid_request", hint: "body.verified must be boolean" });
  }

  try {
    // user_profiles が無いユーザーに対しては 412（プロフィール後にKYCの前提）
    const exists = await db.query(`SELECT 1 FROM user_profiles WHERE user_id = $1 LIMIT 1`, [userId]);
    if ((exists.rowCount ?? 0) === 0) {
      return res.status(412).json({ error: "profile_required" });
    }

    await db.query(
      `
      UPDATE user_profiles
      SET
        kyc_verified = $2,
        kyc_verified_at = CASE WHEN $2 THEN now() ELSE NULL END,
        updated_at = now()
      WHERE user_id = $1
      `,
      [userId, verified]
    );

    return res.json({ ok: true, userId, kyc_verified: verified });
  } catch (e: any) {
    console.error("[admin/users/:userId/kyc] error", e);
    return res.status(500).json({ error: e?.message || "server_error" });
  }
});

/**
 * GET /admin/users/:userId/slots?limit=200
 * - ✅ スロット単位の処理ステータスを返す（user_setup_slots.status）
 * - 既存の slots[].status を slot_status に差し替え（デグレ回避）
 */
router.get("/users/:userId/slots", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const db = getDb(req);
  const userId = parseUserId(req, res);
  if (userId == null) return;

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
        s.status        AS setup_status,
        s.submitted_at,

        sl.id           AS slot_id,
        sl.slot_dt,
        sl.status       AS slot_status,

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

        // ✅ 既存互換：slots[].status は slot_status
        status: r.slot_status,

        setup_status: r.setup_status,

        submitted_at: r.submitted_at,
        slot_id: Number(r.slot_id),
        slot_dt: r.slot_dt,
        slot_jst: r.slot_jst,
      })),
    });
  } catch (e: any) {
    console.error("[admin/users/:userId/slots] error", e);
    return res.status(500).json({ error: e?.message || "server_error" });
  }
});

export default router;