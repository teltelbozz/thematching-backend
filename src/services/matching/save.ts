// src/services/matching/save.ts
import type { Pool } from "pg";
import type { MatchCandidate } from "./engine";

/**
 * computeMatchesForSlot() の結果を書き込む
 */
export async function saveMatchesForSlot(
  db: Pool,
  slotDt: string,
  location: string,
  typeMode: "wine_talk" | "wine_and_others",
  matched: MatchCandidate[]
) {
  if (matched.length === 0) {
    console.log(`[saveMatchesForSlot] No groups for ${slotDt}`);
    return;
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    for (const group of matched) {
      // 1. matched_groups
      const insertGroup = `
        INSERT INTO matched_groups (slot_dt, location, type_mode, status)
        VALUES ($1, $2, $3, 'pending')
        RETURNING id
      `;
      const grpRes = await client.query(insertGroup, [
        slotDt,
        location,
        typeMode,
      ]);
      const groupId = grpRes.rows[0].id as number;

      // 2. matched_group_members
      const insertMember = `
        INSERT INTO matched_group_members (group_id, user_id, gender)
        VALUES ($1, $2, $3)
      `;

      // female
      await client.query(insertMember, [groupId, group.female[0], "female"]);
      await client.query(insertMember, [groupId, group.female[1], "female"]);

      // male
      await client.query(insertMember, [groupId, group.male[0], "male"]);
      await client.query(insertMember, [groupId, group.male[1], "male"]);

      // 3. match_history（案4: 男女ペアのみ）
      const insertHistory = `
        INSERT INTO match_history (user_id_female, user_id_male, slot_dt)
        VALUES ($1, $2, $3)
        ON CONFLICT DO NOTHING
      `;
      for (const f of group.female) {
        for (const m of group.male) {
          const female = Math.min(f, m);
          const male = Math.max(f, m);
          await client.query(insertHistory, [female, male, slotDt]);
        }
      }
    }

    await client.query("COMMIT");
    console.log(
      `[saveMatchesForSlot] Saved ${matched.length} groups for slot ${slotDt}`
    );
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[saveMatchesForSlot] error:", err);
    throw err;
  } finally {
    client.release();
  }
}