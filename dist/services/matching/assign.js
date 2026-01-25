"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.assignTokensForSlot = assignTokensForSlot;
// src/services/matching/assign.ts
const crypto_1 = __importDefault(require("crypto"));
const enqueueLineNotifications_1 = require("../notifications/enqueueLineNotifications");
/**
 * matched_groups.token が NULL のものにランダム token を付与
 * + token 確定直後に LINE通知キューへ積む（方式B）
 */
async function assignTokensForSlot(db, slotDt, location, typeMode) {
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
        const ids = res.rows.map((r) => Number(r.id)).filter(Boolean);
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
            if (!row?.id || !row?.token)
                continue;
            console.log(`  → group_id=${row.id} token=${row.token}`);
            // ★ token確定直後に enqueue（冪等）
            const q = await (0, enqueueLineNotifications_1.enqueueLineNotificationsForGroup)(client, Number(row.id), String(row.token));
            console.log(`    enqueue inserted=${q.inserted}`);
        }
        await client.query("COMMIT");
        console.log(`[assignTokensForSlot] done`);
    }
    catch (err) {
        await client.query("ROLLBACK").catch(() => { });
        console.error("[assignTokensForSlot] error:", err);
        throw err;
    }
    finally {
        client.release();
    }
}
function generateToken() {
    const r = crypto_1.default.randomBytes(8).toString("base64url");
    return `tok_${r}`;
}
