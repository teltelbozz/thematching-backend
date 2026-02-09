"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../db");
const dispatchLineNotifications_1 = require("../services/notifications/dispatchLineNotifications");
const router = (0, express_1.Router)();
function isAdminAuthorized(req) {
    const secret = process.env.ADMIN_SECRET || process.env.CRON_SECRET;
    const auth = req.header("authorization") || "";
    return !!secret && auth === `Bearer ${secret}`;
}
/**
 * GET /admin/line-notifications/summary
 * - LINE通知キューのサマリ/監視用
 * - 認証: Authorization: Bearer <ADMIN_SECRET or CRON_SECRET>
 */
router.get("/line-notifications/summary", async (req, res) => {
    if (!isAdminAuthorized(req)) {
        console.warn("[admin/line-notifications/summary] unauthorized");
        return res.status(401).json({ error: "unauthorized" });
    }
    const errorsLimit = Math.min(Number(req.query.errorsLimit || 20), 200);
    const samplesLimit = Math.min(Number(req.query.samplesLimit || 20), 200);
    try {
        // 1) status別カウント
        const countsRes = await db_1.pool.query(`
      SELECT status, COUNT(*)::int AS count
      FROM line_notifications
      GROUP BY status
      ORDER BY status
    `);
        const counts = {};
        for (const r of countsRes.rows)
            counts[String(r.status)] = Number(r.count);
        // 2) pending の next_retry_at の範囲
        const pendingRangeRes = await db_1.pool.query(`
      SELECT
        MIN(next_retry_at) AS min_next_retry_at,
        MAX(next_retry_at) AS max_next_retry_at,
        COUNT(*)::int      AS pending_count
      FROM line_notifications
      WHERE status = 'pending'
    `);
        // 3) failed のエラー集計（上位）
        const topErrorsRes = await db_1.pool.query(`
      SELECT
        LEFT(COALESCE(last_error, ''), 160) AS err_head,
        COUNT(*)::int AS count
      FROM line_notifications
      WHERE status = 'failed'
      GROUP BY LEFT(COALESCE(last_error, ''), 160)
      ORDER BY count DESC
      LIMIT $1
      `, [errorsLimit]);
        // 4) 最近のfailedサンプル
        const failedSamplesRes = await db_1.pool.query(`
      SELECT
        id,
        status,
        attempts,
        next_retry_at,
        sent_at,
        created_at,
        group_id,
        user_id,
        line_user_id,
        LEFT(COALESCE(last_error, ''), 240) AS last_error_head
      FROM line_notifications
      WHERE status = 'failed'
      ORDER BY id DESC
      LIMIT $1
      `, [samplesLimit]);
        // 5) 最近のsentサンプル（正常も見たい時用）
        const sentSamplesRes = await db_1.pool.query(`
      SELECT
        id,
        status,
        attempts,
        sent_at,
        created_at,
        group_id,
        user_id,
        line_user_id
      FROM line_notifications
      WHERE status = 'sent'
      ORDER BY id DESC
      LIMIT $1
      `, [Math.min(samplesLimit, 50)]);
        // 6) processing が詰まってないか（長時間processing検知）
        const stuckProcessingRes = await db_1.pool.query(`
      SELECT
        COUNT(*)::int AS stuck_count
      FROM line_notifications
      WHERE status = 'processing'
        AND created_at < now() - interval '30 minutes'
    `);
        return res.json({
            ok: true,
            counts,
            pending: pendingRangeRes.rows[0] || null,
            topFailedErrors: topErrorsRes.rows || [],
            failedSamples: failedSamplesRes.rows || [],
            sentSamples: sentSamplesRes.rows || [],
            stuckProcessing: stuckProcessingRes.rows[0] || { stuck_count: 0 },
            now: new Date().toISOString(),
        });
    }
    catch (e) {
        console.error("[admin/line-notifications/summary] error", e);
        return res.status(500).json({ error: e?.message || "server_error" });
    }
});
/**
 * POST /admin/line-notifications/dispatch
 * - 管理画面から手動でdispatch実行
 * - 認証: Authorization: Bearer <ADMIN_SECRET or CRON_SECRET>
 */
router.post("/line-notifications/dispatch", async (req, res) => {
    if (!isAdminAuthorized(req)) {
        console.warn("[admin/line-notifications/dispatch] unauthorized");
        return res.status(401).json({ error: "unauthorized" });
    }
    const limitRaw = Number(req.query.limit ?? 50);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(Math.trunc(limitRaw), 200)) : 50;
    try {
        const result = await (0, dispatchLineNotifications_1.dispatchLineNotifications)(db_1.pool, { limit });
        return res.json(result);
    }
    catch (e) {
        console.error("[admin/line-notifications/dispatch] error", e);
        return res.status(500).json({ error: e?.message || "server_error" });
    }
});
exports.default = router;
