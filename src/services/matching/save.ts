// src/services/matching/save.ts
import type { Pool } from "pg";
import type { MatchCandidate } from "./engine";

/**
 * computeMatchesForSlot() の結果を書き込む + status更新（B案：slot単位）
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
    // 1. matched_groups と matched_group_members を保存（現状維持）
    // ------------------------------------------------------
    if (matched.length === 0) {
      console.log(`[saveMatchesForSlot] No matched groups for ${slotDt}`);
    } else {
      for (const group of matched) {
        // matched_groups INSERT
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

        // matched_group_members INSERT
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

        // match_history（案4: 男女ペアのみ）
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

      console.log(
        `[saveMatchesForSlot] Saved ${matched.length} groups for slot ${slotDt}`
      );
    }

    // ------------------------------------------------------
    // 2. 🔥 B案：この slotDt の user_setup_slots だけ processed にする
    // ------------------------------------------------------
    const updateSlotStatusSql = `
      UPDATE user_setup_slots
      SET status = 'processed'
      WHERE slot_dt = $1
        AND status = 'active'
    `;
    const slotRes = await client.query(updateSlotStatusSql, [slotDt]);
    console.log(
      `[saveMatchesForSlot] Marked ${slotRes.rowCount} setup_slots as processed for slot ${slotDt}`
    );

    // ------------------------------------------------------
    // 3. 親 user_setup は「active slot が残っていない」ものだけ processed
    //    （複数slot登録でも、全部終わるまで親はactiveのまま）
    // ------------------------------------------------------
    const updateSetupStatusSql = `
      UPDATE user_setup s
      SET status = 'processed'
      WHERE s.status = 'active'
        AND EXISTS (
          SELECT 1
          FROM user_setup_slots sl
          WHERE sl.user_setup_id = s.id
        )
        AND NOT EXISTS (
          SELECT 1
          FROM user_setup_slots sl
          WHERE sl.user_setup_id = s.id
            AND sl.status = 'active'
        )
    `;
    const setupRes = await client.query(updateSetupStatusSql);
    console.log(
      `[saveMatchesForSlot] Marked ${setupRes.rowCount} setups as processed (no active slots remain)`
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