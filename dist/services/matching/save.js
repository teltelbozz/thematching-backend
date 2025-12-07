"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveMatchesForSlot = saveMatchesForSlot;
/**
 * computeMatchesForSlot() の結果を書き込む + 応募ステータス更新(processed)
 */
async function saveMatchesForSlot(db, slotDt, location, typeMode, matched) {
    const client = await db.connect();
    try {
        await client.query("BEGIN");
        // ------------------------------------------------------
        // 1. matched_groups と matched_group_members を保存
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
                const groupId = grpRes.rows[0].id;
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
            console.log(`[saveMatchesForSlot] Saved ${matched.length} groups for slot ${slotDt}`);
        }
        // ------------------------------------------------------
        // 2. 🔥 応募(user_setup)ステータスを processed に更新（A案）
        // ------------------------------------------------------
        const updateStatusSql = `
      UPDATE user_setup
      SET status = 'processed'
      WHERE id IN (
        SELECT s.id
        FROM user_setup s
        JOIN user_setup_slots sl
          ON sl.user_setup_id = s.id
        WHERE sl.slot_dt = $1
      );
    `;
        const statusRes = await client.query(updateStatusSql, [slotDt]);
        console.log(`[saveMatchesForSlot] Marked ${statusRes.rowCount} setups as processed for slot ${slotDt}`);
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
