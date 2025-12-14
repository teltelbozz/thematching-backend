"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveMatchesForSlot = saveMatchesForSlot;
/**
 * computeMatchesForSlot() の結果を書き込む + status更新（B案：slot単位）
 * - user_setup_slots の該当 slotDt を processed にする（activeのみ）
 * - user_setup(status) は更新しない（setup_status 運用しない方針）
 */
async function saveMatchesForSlot(db, slotDt, location, typeMode, matched) {
    const client = await db.connect();
    try {
        await client.query("BEGIN");
        // ------------------------------------------------------
        // 1) matched_groups / members / history を保存（現状維持）
        // ------------------------------------------------------
        if (matched.length === 0) {
            console.log(`[saveMatchesForSlot] No matched groups for ${slotDt}`);
        }
        else {
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
                const groupId = Number(grpRes.rows[0].id);
                // matched_group_members INSERT
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
                // match_history（案4: 男女ペアのみ）
                const insertHistory = `
          INSERT INTO match_history (user_id_female, user_id_male, slot_dt)
          VALUES ($1, $2, $3)
          ON CONFLICT DO NOTHING
        `;
                for (const f of group.female) {
                    for (const m of group.male) {
                        const a = Math.min(f, m);
                        const b = Math.max(f, m);
                        await client.query(insertHistory, [a, b, slotDt]);
                    }
                }
            }
            console.log(`[saveMatchesForSlot] Saved ${matched.length} groups for slot ${slotDt}`);
        }
        // ------------------------------------------------------
        // 2) slot単位で processed にする（この slotDt の active だけ）
        // ------------------------------------------------------
        const updateSlotStatusSql = `
      UPDATE user_setup_slots
      SET status = 'processed'
      WHERE slot_dt = $1
        AND status = 'active'
    `;
        const slotRes = await client.query(updateSlotStatusSql, [slotDt]);
        console.log(`[saveMatchesForSlot] Marked ${slotRes.rowCount} setup_slots as processed for slot ${slotDt}`);
        await client.query("COMMIT");
    }
    catch (err) {
        await client.query("ROLLBACK");
        console.error("[saveMatchesForSlot] error:", err);
        throw err;
    }
    finally {
        client.release();
    }
}
