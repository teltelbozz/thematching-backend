// src/services/matching/assign.ts
import crypto from "crypto";
import type { Pool } from "pg";
import { enqueueLineNotificationsForGroup } from "../notifications/enqueueLineNotifications";

/**
 * matched_groups.token が NULL のものにランダム token を付与
 * + token 確定直後に LINE通知キューへ積む（方式B）
 */
export async function assignTokensForSlot(
  db: Pool,
  slotDt: string,
  location: string,
  typeMode: "wine_talk" | "wine_and_others"
) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    // token未付与の group をロックして取得（並列実行でも安全）
    const sel = `
      SELECT id
      FROM matched_groups
      WHERE slot_dt = $1
        AND location = $2
        AND type_mode = $3
        AND token IS NULL
      ORDER BY id
      FOR UPDATE
    `;
    const res = await client.query(sel, [slotDt, location, typeMode]);
    const ids: number[] = res.rows.map((r) => Number(r.id)).filter(Boolean);

    if (ids.length === 0) {
      console.log(`[assignTokensForSlot] no groups for token assign`);
      await client.query("COMMIT");
      return;
    }

    console.log(`[assignTokensForSlot] target groups:`, ids);

    for (const id of ids) {
      const token = generateToken();

      // token確定（RETURNINGで確実に取る）
      const upd = `
        UPDATE matched_groups
        SET token = $1
        WHERE id = $2
          AND token IS NULL
        RETURNING id, token
      `;
      const u = await client.query(upd, [token, id]);
      const row = u.rows[0];
      if (!row?.id || !row?.token) continue;

      console.log(`  → group_id=${row.id} token=${row.token}`);

      // ★ token確定直後に enqueue（冪等）
      const q = await enqueueLineNotificationsForGroup(
        client,
        Number(row.id),
        String(row.token)
      );
      console.log(`    enqueue inserted=${q.inserted}`);
    }

    await client.query("COMMIT");
    console.log(`[assignTokensForSlot] done`);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[assignTokensForSlot] error:", err);
    throw err;
  } finally {
    client.release();
  }
}

function generateToken(): string {
  const r = crypto.randomBytes(8).toString("base64url");
  return `tok_${r}`;
}