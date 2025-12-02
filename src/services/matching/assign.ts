// src/services/matching/assign.ts
import crypto from "crypto";
import type { Pool } from "pg";

/**
 * matched_groups.token が NULL のものにランダム token を付与
 */
export async function assignTokensForSlot(
  db: Pool,
  slotDt: string,
  location: string,
  typeMode: "wine_talk" | "wine_and_others"
) {
  const client = await db.connect();
  try {
    const sel = `
      SELECT id
      FROM matched_groups
      WHERE slot_dt = $1
        AND location = $2
        AND type_mode = $3
        AND token IS NULL
      ORDER BY id
    `;
    const res = await client.query(sel, [slotDt, location, typeMode]);
    const ids: number[] = res.rows.map((r) => r.id);

    if (ids.length === 0) {
      console.log(`[assignTokensForSlot] no groups for token assign`);
      return;
    }

    console.log(`[assignTokensForSlot] target groups:`, ids);

    for (const id of ids) {
      const token = generateToken();
      const upd = `
        UPDATE matched_groups
        SET token = $1
        WHERE id = $2
      `;
      await client.query(upd, [token, id]);
      console.log(`  → group_id=${id} token=${token}`);
    }

    console.log(`[assignTokensForSlot] done`);
  } catch (err) {
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