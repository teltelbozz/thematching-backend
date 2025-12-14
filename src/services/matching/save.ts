// src/services/matching/save.ts
import type { Pool } from "pg";
import type { MatchCandidate } from "./engine";

/**
 * computeMatchesForSlot() の結果を書き込む
 * + slot_status を processed にする（slot単位のみ）
 */
export async function saveMatchesForSlot(
  db: Pool,
  slotDt: string,
  location: string,
  typeMode: "wine_talk" | "wine_and_others",
  matched: MatchCandidate[]
) {
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    // ------------------------------------------------------
    // 1. matched_groups / matched_group_members 保存
    // ------------------------------------------------------
    if (matched.length > 0) {
      for (const group of matched) {
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

        const insertMember = `
          INSERT INTO matched_group_members (group_id, user_id, gender)
          VALUES ($1, $2, $3)
        `;

        // 女性2名
        await client.query(insertMember, [groupId, group.female[0], "female"]);
        await client.query(insertMember, [groupId, group.female[1], "female"]);

        // 男性2名
        await client.query(insertMember, [groupId, group.male[0], "male"]);
        await client.query(insertMember, [groupId, group.male[1], "male"]);

        // match_history（男女ペアのみ）
        const insertHistory = `
          INSERT INTO match_history (user_id_female, user_id_male, slot_dt)
          VALUES ($1, $2, $3)
          ON CONFLICT DO NOTHING
        `;
        for (const f of group.female) {
          for (const m of group.male) {
            const fem = Math.min(f, m);
            const mal = Math.max(f, m);
            await client.query(insertHistory, [fem, mal, slotDt]);
          }
        }
      }
    }

    // ------------------------------------------------------
    // 2. この slotDt の slot だけ processed にする
    // ------------------------------------------------------
    const updateSlotStatusSql = `
      UPDATE user_setup_slots
      SET status = 'processed'
      WHERE slot_dt = $1
        AND status = 'active'
    `;
    const res = await client.query(updateSlotStatusSql, [slotDt]);

    console.log(
      `[saveMatchesForSlot] slot_dt=${slotDt} processed slots=${res.rowCount}`
    );

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[saveMatchesForSlot] error:", err);
    throw err;
  } finally {
    client.release();
  }
}