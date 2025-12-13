import { Router } from "express";
import { pool } from "../db";

const router = Router();

/**
 * GET /admin/users
 * - 管理画面向けユーザ一覧（デモHTMLでも使う）
 * - 認証: Authorization: Bearer <ADMIN_SECRET or CRON_SECRET>
 *
 * NOTE:
 *  将来は「管理者ログイン」等に差し替えやすいように、ここでまとめてガード。
 */
router.get("/users", async (req, res) => {
  const secret = process.env.ADMIN_SECRET || process.env.CRON_SECRET; // まずは簡易
  const auth = req.header("authorization") || "";

  if (!secret || auth !== `Bearer ${secret}`) {
    console.warn("[admin/users] unauthorized");
    return res.status(401).json({ error: "unauthorized" });
  }

  // オプション: gender フィルタ (male/female)
  const gender = (req.query.gender as string | undefined) || undefined;
  // オプション: キーワード検索（nickname / line_user_id / user_id）
  const q = (req.query.q as string | undefined) || undefined;

  // オプション: 上限制御
  const limit = Math.min(Number(req.query.limit || 200), 500);
  const offset = Math.max(Number(req.query.offset || 0), 0);

  try {
    const where: string[] = [];
    const params: any[] = [];
    let i = 1;

    if (gender === "male" || gender === "female") {
      where.push(`p.gender = $${i++}`);
      params.push(gender);
    }

    if (q && q.trim()) {
      // user_id も検索できるように text 化
      where.push(
        `(p.nickname ILIKE $${i} OR u.line_user_id ILIKE $${i} OR u.id::text = $${i})`
      );
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
        p.verified_age
      FROM users u
      JOIN user_profiles p ON p.user_id = u.id
      ${whereSql}
      ORDER BY u.id
      LIMIT $${i++} OFFSET $${i++}
    `;

    params.push(limit, offset);

    const { rows } = await pool.query(sql, params);

    return res.json({
      ok: true,
      count: rows.length,
      users: rows.map((r: any) => ({
        user_id: Number(r.user_id),
        line_user_id: r.line_user_id,
        created_at: r.created_at,
        nickname: r.nickname,
        gender: r.gender === "female" ? "female" : "male",
        age: Number(r.age),
        verified_age: Boolean(r.verified_age),
      })),
    });
  } catch (e: any) {
    console.error("[admin/users] error", e);
    return res.status(500).json({ error: e?.message || "server_error" });
  }
});

export default router;