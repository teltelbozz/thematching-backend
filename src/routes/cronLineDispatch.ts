// src/routes/cronLineDispatch.ts
import { Router } from "express";
import { pool } from "../db";
import config from "../config";
import { pushLineText } from "../lib/linePush";

const router = Router();

function requireCronSecret(req: any, res: any, next: any) {
  const secret = process.env.CRON_SECRET;
  const auth = req.header("authorization") || "";
  if (!secret || auth !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}

function computeNextRetry(attempts: number) {
  // attempts は失敗後に +1 される想定
  const minutes = [1, 5, 30, 180, 720, 1440]; // 1m,5m,30m,3h,12h,24h
  const idx = Math.min(attempts - 1, minutes.length - 1);
  return new Date(Date.now() + minutes[idx] * 60 * 1000);
}

router.post("/line/dispatch", requireCronSecret, async (_req, res) => {
  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!accessToken) return res.status(500).json({ error: "line_access_token_not_configured" });

  const limit = 50;

  const client = await pool.connect();
  const processed: any[] = [];
  try {
    await client.query("BEGIN");

    // 取り出して processing にする（並列cronでも安全）
    const pick = await client.query(
      `
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
      SET status='processing'
      FROM picked
      WHERE n.id = picked.id
      RETURNING n.*
      `,
      [limit]
    );

    await client.query("COMMIT");

    for (const n of pick.rows) {
      try {
        await pushLineText(accessToken, n.line_user_id, n.message_text);

        await pool.query(
          `
          UPDATE line_notifications
          SET status='sent', sent_at=now(), last_error=NULL
          WHERE id=$1
          `,
          [n.id]
        );

        processed.push({ id: n.id, status: "sent" });
      } catch (e: any) {
        const nextAttempts = Number(n.attempts || 0) + 1;
        const nextRetryAt = computeNextRetry(nextAttempts);
        const msg = String(e?.message || e);

        await pool.query(
          `
          UPDATE line_notifications
          SET status='failed',
              attempts=$2,
              next_retry_at=$3,
              last_error=$4
          WHERE id=$1
          `,
          [n.id, nextAttempts, nextRetryAt.toISOString(), msg.slice(0, 2000)]
        );

        processed.push({ id: n.id, status: "failed", attempts: nextAttempts });
      }
    }

    return res.json({ ok: true, picked: pick.rowCount, processed });
  } catch (e: any) {
    await client.query("ROLLBACK").catch(() => {});
    return res.status(500).json({ error: e?.message || "server_error" });
  } finally {
    client.release();
  }
});

export default router;