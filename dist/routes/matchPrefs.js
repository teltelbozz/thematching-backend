"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// src/routes/matchPrefs.ts
const express_1 = require("express");
const tokenService_1 = require("../auth/tokenService");
const router = (0, express_1.Router)();
/** verifyAccess() の戻りが {payload} / payload のどちらでも対応 */
function claimsFromVerified(v) {
    return (v && typeof v === 'object' && 'payload' in v) ? v.payload : v;
}
/** uid が数値ならそのまま返す。文字列なら users.line_user_id を辿って id を解決（なければ発行）。*/
async function resolveUserIdFromClaims(claims, db) {
    const raw = claims?.uid;
    if (typeof raw === 'number' && Number.isFinite(raw))
        return raw;
    if (typeof raw === 'string' && raw.trim() !== '') {
        const sub = raw.trim();
        const r1 = await db.query('SELECT id FROM users WHERE line_user_id = $1 LIMIT 1', [sub]);
        if (r1.rows[0])
            return r1.rows[0].id;
        const r2 = await db.query('INSERT INTO users (line_user_id) VALUES ($1) RETURNING id', [sub]);
        return r2.rows[0]?.id ?? null;
    }
    return null;
}
/** ユーティリティ：穏当パース */
const toInt = (v, d = undefined) => {
    if (v === '' || v === null || v === undefined)
        return d;
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : d;
};
const toStr = (v, d = undefined) => {
    if (v === '' || v === null || v === undefined)
        return d;
    return String(v);
};
/** バリデーション（DB列に合わせた名前で） */
function validate(input) {
    const errors = [];
    const min = toInt(input.preferred_age_min);
    const max = toInt(input.preferred_age_max);
    if (min !== undefined && min !== null && (min < 18 || min > 80)) {
        errors.push('invalid_preferred_age_min');
    }
    if (max !== undefined && max !== null && (max < 18 || max > 80)) {
        errors.push('invalid_preferred_age_max');
    }
    if (min != null && max != null && min > max) {
        errors.push('age_min_gt_max');
    }
    const purpose = toStr(input.purpose);
    if (purpose && !['friend', 'dating', 'party', 'serious'].includes(purpose)) {
        errors.push('invalid_purpose');
    }
    const g = toStr(input.preferred_gender);
    if (g && !['male', 'female', 'any'].includes(g)) {
        errors.push('invalid_preferred_gender');
    }
    const sz = toInt(input.group_size_preference);
    if (sz != null && (sz < 1 || sz > 4)) {
        errors.push('invalid_group_size_preference');
    }
    return { ok: errors.length === 0, errors };
}
/** デフォルト応答（未設定時）— DBの列名に合わせる */
function defaultPrefs() {
    return {
        purpose: null,
        preferred_age_min: null,
        preferred_age_max: null,
        preferred_gender: 'any',
        preferred_style: null,
        preferred_atmosphere: null,
        location_preference: null,
        budget_preference: null,
        group_size_preference: 1,
        time_slots: null, // 例: "fri-19:00,sat-21:00"
    };
}
/** GET /api/match-prefs */
router.get('/', async (req, res) => {
    try {
        const token = (0, tokenService_1.readBearer)(req);
        if (!token)
            return res.status(401).json({ error: 'unauthenticated' });
        const verified = await (0, tokenService_1.verifyAccess)(token);
        const claims = claimsFromVerified(verified);
        const db = req.app.locals.db;
        if (!db) {
            console.error('[match-prefs:get] db_not_initialized');
            return res.status(500).json({ error: 'server_error' });
        }
        const uid = await resolveUserIdFromClaims(claims, db);
        if (uid == null)
            return res.status(401).json({ error: 'unauthenticated' });
        const r = await db.query(`SELECT
         purpose,
         preferred_age_min,
         preferred_age_max,
         preferred_gender,
         preferred_style,
         preferred_atmosphere,
         location_preference,
         budget_preference,
         group_size_preference,
         time_slots
       FROM user_match_prefs WHERE user_id = $1`, [uid]);
        if (!r.rows[0])
            return res.json({ prefs: defaultPrefs() });
        return res.json({ prefs: r.rows[0] });
    }
    catch (e) {
        console.error('[match-prefs:get]', e?.message || e);
        return res.status(500).json({ error: 'server_error' });
    }
});
/** PUT /api/match-prefs … upsert（DB列名に完全準拠） */
router.put('/', async (req, res) => {
    try {
        const token = (0, tokenService_1.readBearer)(req);
        if (!token)
            return res.status(401).json({ error: 'unauthenticated' });
        const verified = await (0, tokenService_1.verifyAccess)(token);
        const claims = claimsFromVerified(verified);
        const db = req.app.locals.db;
        if (!db) {
            console.error('[match-prefs:put] db_not_initialized');
            return res.status(500).json({ error: 'server_error' });
        }
        const uid = await resolveUserIdFromClaims(claims, db);
        if (uid == null)
            return res.status(401).json({ error: 'unauthenticated' });
        const input = req.body || {};
        const v = validate(input);
        if (!v.ok)
            return res.status(400).json({ error: 'invalid_input', details: v.errors });
        // 正規化（null / undefined 整理）
        const payload = {
            purpose: toStr(input.purpose, undefined),
            preferred_age_min: toInt(input.preferred_age_min, null),
            preferred_age_max: toInt(input.preferred_age_max, null),
            preferred_gender: toStr(input.preferred_gender, 'any'),
            preferred_style: toStr(input.preferred_style, undefined),
            preferred_atmosphere: toStr(input.preferred_atmosphere, undefined),
            location_preference: toStr(input.location_preference, undefined),
            budget_preference: toInt(input.budget_preference, null),
            group_size_preference: toInt(input.group_size_preference, 1),
            time_slots: toStr(input.time_slots, undefined),
        };
        await db.query(`INSERT INTO user_match_prefs (
         user_id,
         purpose,
         preferred_age_min,
         preferred_age_max,
         preferred_gender,
         preferred_style,
         preferred_atmosphere,
         location_preference,
         budget_preference,
         group_size_preference,
         time_slots
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11
       )
       ON CONFLICT (user_id) DO UPDATE SET
         purpose = EXCLUDED.purpose,
         preferred_age_min = EXCLUDED.preferred_age_min,
         preferred_age_max = EXCLUDED.preferred_age_max,
         preferred_gender = EXCLUDED.preferred_gender,
         preferred_style = EXCLUDED.preferred_style,
         preferred_atmosphere = EXCLUDED.preferred_atmosphere,
         location_preference = EXCLUDED.location_preference,
         budget_preference = EXCLUDED.budget_preference,
         group_size_preference = EXCLUDED.group_size_preference,
         time_slots = EXCLUDED.time_slots,
         updated_at = NOW()`, [
            uid,
            payload.purpose,
            payload.preferred_age_min,
            payload.preferred_age_max,
            payload.preferred_gender,
            payload.preferred_style,
            payload.preferred_atmosphere,
            payload.location_preference,
            payload.budget_preference,
            payload.group_size_preference,
            payload.time_slots,
        ]);
        const r = await db.query(`SELECT
         purpose,
         preferred_age_min,
         preferred_age_max,
         preferred_gender,
         preferred_style,
         preferred_atmosphere,
         location_preference,
         budget_preference,
         group_size_preference,
         time_slots
       FROM user_match_prefs WHERE user_id = $1`, [uid]);
        return res.json({ prefs: r.rows[0] ?? defaultPrefs() });
    }
    catch (e) {
        console.error('[match-prefs:put]', e?.message || e);
        return res.status(500).json({ error: 'server_error' });
    }
});
exports.default = router;
