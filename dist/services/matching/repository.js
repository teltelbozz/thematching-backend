"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSlotsForDate = getSlotsForDate;
exports.getEntriesForSlot = getEntriesForSlot;
exports.getHistoryEdges = getHistoryEdges;
// src/services/matching/repository.ts
const db_1 = require("../../db");
/**
 * 指定日（YYYY-MM-DD）に対応する slot_dt 一覧を取得
 * - slot_status = 'active' のものだけ
 * - setup_status は一切見ない
 */
async function getSlotsForDate(date) {
    const { rows } = await db_1.pool.query(`
    SELECT DISTINCT sl.slot_dt
    FROM user_setup_slots sl
    WHERE sl.slot_dt::date = $1::date
      AND sl.status = 'active'
    ORDER BY sl.slot_dt
    `, [date]);
    return rows.map((r) => r.slot_dt);
}
/**
 * ある slot_dt にエントリしているユーザ一覧を取得
 * - slot_status = 'active' のものだけ
 * - setup_status は完全に無視
 */
async function getEntriesForSlot(slotDt) {
    const { rows } = await db_1.pool.query(`
    SELECT
      u.id        AS user_id,
      p.gender    AS gender,
      p.age       AS age,
      s.type_mode AS type_mode,
      s.location  AS location
    FROM user_setup_slots sl
      JOIN user_setup s     ON s.id = sl.user_setup_id
      JOIN users u          ON u.id = s.user_id
      JOIN user_profiles p ON p.user_id = u.id
    WHERE sl.slot_dt = $1
      AND sl.status = 'active'
    ORDER BY u.id
    `, [slotDt]);
    return rows.map((r) => ({
        user_id: Number(r.user_id),
        gender: r.gender === "female" ? "female" : "male",
        age: Number(r.age),
        type_mode: r.type_mode,
        location: r.location,
    }));
}
/**
 * match_history を Set<string> として返す
 * 形式: "minId-maxId"
 */
async function getHistoryEdges() {
    const { rows } = await db_1.pool.query(`
    SELECT user_id_female, user_id_male FROM match_history
  `);
    const set = new Set();
    for (const r of rows) {
        const a = Number(r.user_id_female);
        const b = Number(r.user_id_male);
        const key = `${Math.min(a, b)}-${Math.max(a, b)}`;
        set.add(key);
    }
    return set;
}
