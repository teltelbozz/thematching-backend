// src/services/notifications/enqueueLineNotifications.ts
import type { Pool, PoolClient } from "pg";

const FRONT_ORIGIN =
  (process.env.FRONT_ORIGIN || "https://thematching-frontend.vercel.app").replace(/\/+$/, "");

function buildMessage(url: string) {
  return (
    "マッチングが成立しました！\n" +
    "グループページはこちら：\n" +
    `${url}\n\n` +
    "※このURLは共有に注意してください。"
  );
}

/**
 * slot単位でLINE通知をキューへ積む（冪等）
 * - tokenが確定している group のみ対象
 * - ON CONFLICT で二重投入を防ぐ
 */
export async function enqueueLineNotificationsForSlot(pool: Pool, slotDt: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const textPrefix = "マッチングが成立しました！\nグループページはこちら：\n";
    const textSuffix = "\n\n※このURLは共有に注意してください。";

    // 1発で enqueue
    const r = await client.query(
      `
      INSERT INTO line_notifications (
        group_id, user_id, line_user_id, message_text, status, next_retry_at
      )
      SELECT
        g.id AS group_id,
        m.user_id,
        u.line_user_id,
        ($2 || ($3 || '/g/' || g.token) || $4) AS message_text,
        'pending' AS status,
        now() AS next_retry_at
      FROM matched_groups g
      JOIN matched_group_members m ON m.group_id = g.id
      JOIN users u ON u.id = m.user_id
      WHERE g.slot_dt = $1
        AND g.token IS NOT NULL
        AND g.token <> ''
        AND u.line_user_id IS NOT NULL
        AND u.line_user_id <> ''
      ON CONFLICT (group_id, user_id) DO NOTHING
      `,
      [slotDt, textPrefix, FRONT_ORIGIN, textSuffix]
    );

    await client.query("COMMIT");
    return { ok: true, inserted: r.rowCount };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/**
 * group単位でLINE通知をキューへ積む（冪等）
 * - assign.ts の transaction 内で使うため PoolClient を受け取る
 */
export async function enqueueLineNotificationsForGroup(
  client: PoolClient,
  groupId: number,
  token: string
) {
  const url = `${FRONT_ORIGIN}/g/${encodeURIComponent(token)}`;
  const messageText = buildMessage(url);

  const r = await client.query(
    `
    INSERT INTO line_notifications (
      group_id, user_id, line_user_id, message_text, status, next_retry_at
    )
    SELECT
      $1 AS group_id,
      mgm.user_id,
      u.line_user_id,
      $2 AS message_text,
      'pending' AS status,
      now() AS next_retry_at
    FROM matched_group_members mgm
    JOIN users u ON u.id = mgm.user_id
    WHERE mgm.group_id = $1
      AND u.line_user_id IS NOT NULL
      AND u.line_user_id <> ''
    ON CONFLICT (group_id, user_id) DO NOTHING
    `,
    [groupId, messageText]
  );

  return { inserted: r.rowCount };
}