"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dispatchLineNotifications = dispatchLineNotifications;
const linePush_1 = require("../../lib/linePush");
function computeNextRetry(attempts) {
    const minutes = [1, 5, 30, 180, 720, 1440];
    const idx = Math.min(Math.max(attempts - 1, 0), minutes.length - 1);
    return new Date(Date.now() + minutes[idx] * 60 * 1000);
}
function maskLineUserId(v) {
    if (!v)
        return null;
    if (v.length <= 10)
        return v;
    return `${v.slice(0, 5)}...${v.slice(-4)}`;
}
function looksLikeLineUserId(v) {
    if (!v)
        return false;
    return /^U[a-fA-F0-9]{32}$/.test(v);
}
function parseLineHttpStatus(msg) {
    const m = msg.match(/^line_push_failed:(\d{3}):/);
    if (!m)
        return null;
    const code = Number(m[1]);
    return Number.isFinite(code) ? code : null;
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
        const pickedRows = pick.rows;
        const pickedLikelyReal = pickedRows.filter((r) => looksLikeLineUserId(r.line_user_id)).length;
        const pickedLikelyDummy = pickedRows.length - pickedLikelyReal;
        const pickedSample = pickedRows.slice(0, 5).map((r) => ({
            id: r.id,
            groupId: r.group_id,
            userId: r.user_id,
            lineUserIdMasked: maskLineUserId(r.line_user_id),
            likelyRealLineId: looksLikeLineUserId(r.line_user_id),
            attempts: Number(r.attempts || 0),
        }));
        console.log(`[dispatchLineNotifications] pick-summary picked=${pickedRows.length} likelyReal=${pickedLikelyReal} likelyDummyOrInvalid=${pickedLikelyDummy} sample=${JSON.stringify(pickedSample)}`);
        for (const n of pickedRows) {
            try {
                if (!n.line_user_id) {
                    const nextAttempts = Number(n.attempts || 0) + 1;
                    const nextRetryAt = computeNextRetry(nextAttempts);
                    const msg = "line_user_id_missing";
                    await pool.query(`
            UPDATE line_notifications
            SET status = 'failed',
                attempts = $2,
                next_retry_at = $3,
                last_error = $4
            WHERE id = $1
            `, [n.id, nextAttempts, nextRetryAt.toISOString(), msg]);
                    processed.push({
                        id: n.id,
                        status: "failed",
                        groupId: n.group_id,
                        userId: n.user_id,
                        lineUserIdMasked: null,
                        attempts: nextAttempts,
                        errorHead: msg,
                        lineHttpStatus: null,
                    });
                    continue;
                }
                await (0, linePush_1.pushLineText)(accessToken, n.line_user_id, n.message_text);
                await pool.query(`
          UPDATE line_notifications
          SET status = 'sent', sent_at = now(), last_error = NULL
          WHERE id = $1
          `, [n.id]);
                processed.push({
                    id: n.id,
                    status: "sent",
                    groupId: n.group_id,
                    userId: n.user_id,
                    lineUserIdMasked: maskLineUserId(n.line_user_id),
                });
            }
            catch (e) {
                const nextAttempts = Number(n.attempts || 0) + 1;
                const nextRetryAt = computeNextRetry(nextAttempts);
                const msg = String(e?.message || e);
                const lineHttpStatus = parseLineHttpStatus(msg);
                await pool.query(`
          UPDATE line_notifications
          SET status = 'failed',
              attempts = $2,
              next_retry_at = $3,
              last_error = $4
          WHERE id = $1
          `, [n.id, nextAttempts, nextRetryAt.toISOString(), msg.slice(0, 2000)]);
                processed.push({
                    id: n.id,
                    status: "failed",
                    groupId: n.group_id,
                    userId: n.user_id,
                    lineUserIdMasked: maskLineUserId(n.line_user_id),
                    attempts: nextAttempts,
                    errorHead: msg.slice(0, 160),
                    lineHttpStatus,
                });
            }
        }
        const sentCount = processed.filter((p) => p.status === "sent").length;
        const failedCount = processed.filter((p) => p.status === "failed").length;
        const failedByStatus = {};
        for (const p of processed) {
            if (p.status !== "failed")
                continue;
            const key = p.lineHttpStatus == null ? "unknown" : String(p.lineHttpStatus);
            failedByStatus[key] = (failedByStatus[key] || 0) + 1;
        }
        const failedSamples = processed.filter((p) => p.status === "failed").slice(0, 3).map((p) => ({
            id: p.id,
            userId: p.userId,
            lineUserIdMasked: p.lineUserIdMasked,
            lineHttpStatus: p.lineHttpStatus ?? "unknown",
            errorHead: p.errorHead,
        }));
        console.log(`[dispatchLineNotifications] picked=${pick.rowCount ?? 0} sent=${sentCount} failed=${failedCount} failedByStatus=${JSON.stringify(failedByStatus)} failedSamples=${JSON.stringify(failedSamples)}`);
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
