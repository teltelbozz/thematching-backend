"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dispatchLineNotifications = dispatchLineNotifications;
const linePush_1 = require("../../lib/linePush");
function computeNextRetry(attempts) {
    const minutes = [1, 5, 30, 180, 720, 1440];
    const idx = Math.min(Math.max(attempts - 1, 0), minutes.length - 1);
    return new Date(Date.now() + minutes[idx] * 60 * 1000);
}
async function dispatchLineNotifications(pool, opts) {
    const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    if (!accessToken) {
        throw new Error("line_access_token_not_configured");
    }
    const limitRaw = Number(opts?.limit ?? 50);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(Math.trunc(limitRaw), 200)) : 50;
    const client = await pool.connect();
    const processed = [];
    try {
        await client.query("BEGIN");
        const pick = await client.query(`
      WITH picked AS (
        SELECT id
        FROM line_notifications
        WHERE status IN ('pending', 'failed')
          AND next_retry_at <= now()
        ORDER BY id
        LIMIT $1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE line_notifications n
      SET status = 'processing'
      FROM picked
      WHERE n.id = picked.id
      RETURNING n.*
      `, [limit]);
        await client.query("COMMIT");
        for (const n of pick.rows) {
            try {
                await (0, linePush_1.pushLineText)(accessToken, n.line_user_id, n.message_text);
                await pool.query(`
          UPDATE line_notifications
          SET status = 'sent', sent_at = now(), last_error = NULL
          WHERE id = $1
          `, [n.id]);
                processed.push({ id: n.id, status: "sent" });
            }
            catch (e) {
                const nextAttempts = Number(n.attempts || 0) + 1;
                const nextRetryAt = computeNextRetry(nextAttempts);
                const msg = String(e?.message || e);
                await pool.query(`
          UPDATE line_notifications
          SET status = 'failed',
              attempts = $2,
              next_retry_at = $3,
              last_error = $4
          WHERE id = $1
          `, [n.id, nextAttempts, nextRetryAt.toISOString(), msg.slice(0, 2000)]);
                processed.push({ id: n.id, status: "failed", attempts: nextAttempts });
            }
        }
        const sentCount = processed.filter((p) => p.status === "sent").length;
        const failedCount = processed.filter((p) => p.status === "failed").length;
        console.log(`[dispatchLineNotifications] picked=${pick.rowCount ?? 0} sent=${sentCount} failed=${failedCount}`);
        return { ok: true, picked: pick.rowCount ?? 0, processed };
    }
    catch (e) {
        await client.query("ROLLBACK").catch(() => { });
        throw e;
    }
    finally {
        client.release();
    }
}
