"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../db");
const router = (0, express_1.Router)();
// JSTの週キー（簡易）
function toWeekKeyJST(d) {
    const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
    const start = new Date(Date.UTC(jst.getUTCFullYear(), 0, 1));
    const diffDays = Math.floor((+jst - +start) / (1000 * 60 * 60 * 24));
    const week = Math.floor(diffDays / 7) + 1;
    const yyyy = jst.getUTCFullYear();
    return `${yyyy}-W${String(week).padStart(2, '0')}`;
}
function parseSlotToTz(slot) {
    return new Date(`${slot.date}T${slot.time}:00+09:00`);
}
function isPastDeadline(slot, now = new Date()) {
    const slotDt = parseSlotToTz(slot);
    const dl = new Date(slotDt.getTime() - 2 * 24 * 60 * 60 * 1000);
    dl.setHours(20, 0, 0, 0);
    return now.getTime() > dl.getTime();
}
function isFriOrSat(slot) {
    const dt = parseSlotToTz(slot);
    const w = dt.getDay();
    return w === 5 || w === 6;
}
function isValidTime(t) {
    return t === '19:00' || t === '21:00';
}
function validatePayload(p) {
    const errors = [];
    if (!p || typeof p !== 'object')
        errors.push('payload required');
    if (!['wine_talk', 'wine_and_others'].includes(p?.type_mode))
        errors.push('type_mode invalid');
    if (p?.location !== 'shibuya_shinjuku')
        errors.push('location must be shibuya_shinjuku');
    if (!['men_pay_all', 'split_even', 'follow_partner'].includes(p?.cost_pref))
        errors.push('cost_pref invalid');
    const cs = p?.candidate_slots;
    if (!Array.isArray(cs) || cs.length < 1) {
        errors.push('candidate_slots must be non-empty array');
    }
    else {
        for (const s of cs) {
            if (!s?.date)
                errors.push('slot.date required');
            if (!isValidTime(s?.time))
                errors.push('slot.time must be 19:00 or 21:00');
            if (!isFriOrSat(s))
                errors.push(`slot ${s?.date} not Fri/Sat`);
            if (isPastDeadline(s))
                errors.push(`slot ${s?.date} ${s?.time} past deadline`);
        }
    }
    if (errors.length) {
        const err = new Error('validation_error: ' + errors.join(', '));
        err.status = 400;
        throw err;
    }
}
// GET /api/setup : 最新の保存内容を返す
router.get('/', async (req, res) => {
    const userId = req.userId;
    if (!userId)
        return res.status(401).json({ error: 'unauthorized' });
    const latest = await db_1.pool.query(`SELECT id, type_mode, location, cost_pref, venue_pref
     FROM user_setup
     WHERE user_id = $1
     ORDER BY submitted_at DESC
     LIMIT 1`, [userId]);
    if (latest.rowCount === 0)
        return res.json({ setup: null });
    const setupRow = latest.rows[0];
    const slots = await db_1.pool.query(`SELECT slot_dt FROM user_setup_slots WHERE user_setup_id = $1 ORDER BY slot_dt ASC`, [setupRow.id]);
    const candidate_slots = slots.rows.map((r) => {
        const dt = new Date(r.slot_dt);
        const yyyy = dt.getFullYear();
        const mm = String(dt.getMonth() + 1).padStart(2, '0');
        const dd = String(dt.getDate()).padStart(2, '0');
        const hh = String(dt.getHours()).padStart(2, '0');
        const mi = String(dt.getMinutes()).padStart(2, '0');
        return { date: `${yyyy}-${mm}-${dd}`, time: `${hh}:${mi}` };
    });
    const resp = {
        type_mode: setupRow.type_mode,
        candidate_slots,
        location: setupRow.location,
        venue_pref: setupRow.venue_pref ?? null,
        cost_pref: setupRow.cost_pref,
    };
    return res.json({ setup: resp });
});
// PUT /api/setup : 保存（1回の保存でヘッダ+スロットを丸ごと置き換え）
router.put('/', async (req, res) => {
    const userId = req.userId;
    if (!userId)
        return res.status(401).json({ error: 'unauthorized' });
    const payload = req.body;
    try {
        validatePayload(payload);
    }
    catch (e) {
        return res.status(e?.status ?? 400).json({ error: e?.message ?? 'validation_error' });
    }
    const now = new Date();
    const weekKey = toWeekKeyJST(now);
    const client = await db_1.pool.connect();
    try {
        await client.query('BEGIN');
        const inserted = await client.query(`INSERT INTO user_setup
        (user_id, week_key, type_mode, location, cost_pref, venue_pref, submitted_at)
       VALUES ($1, $2, $3, $4, $5, NULL, now())
       RETURNING id`, [userId, weekKey, payload.type_mode, payload.location, payload.cost_pref]);
        const setupId = inserted.rows[0].id;
        if (payload.candidate_slots?.length) {
            const values = [];
            const placeholders = [];
            payload.candidate_slots.forEach((s) => {
                values.push(setupId);
                values.push(parseSlotToTz(s).toISOString());
                placeholders.push(`($${values.length - 1}, $${values.length})`);
            });
            await client.query(`INSERT INTO user_setup_slots (user_setup_id, slot_dt)
         VALUES ${placeholders.join(',')}`, values);
        }
        await client.query('COMMIT');
        return res.json({ setup: payload });
    }
    catch (e) {
        await client.query('ROLLBACK');
        console.error('[setup.put] tx error:', e);
        return res.status(500).json({ error: 'internal_error' });
    }
    finally {
        client.release();
    }
});
exports.default = router;
