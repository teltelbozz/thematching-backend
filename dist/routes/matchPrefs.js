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
/** ユーティリティ：配列・数値・真偽などを穏当にパース */
const toInt = (v, d = undefined) => {
    if (v === '' || v === null || v === undefined)
        return d;
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : d;
};
const toBool = (v, d = false) => {
    if (typeof v === 'boolean')
        return v;
    if (typeof v === 'string')
        return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
    return d;
};
const toStr = (v, d = undefined) => {
    if (v === '' || v === null || v === undefined)
        return d;
    return String(v);
};
const toStrArray = (v) => {
    if (Array.isArray(v))
        return v.map((x) => String(x)).filter(Boolean);
    if (typeof v === 'string') {
        // カンマ区切りも許可
        return v.split(',').map((s) => s.trim()).filter(Boolean);
    }
    return [];
};
const toJson = (v) => {
    if (v === null || v === undefined || v === '')
        return null;
    if (typeof v === 'object')
        return v;
    try {
        return JSON.parse(String(v));
    }
    catch {
        return null;
    }
};
/** バリデーション（ゆるめ＋レンジチェック） */
function validate(input) {
    const errors = [];
    const partner_age_min = toInt(input.partner_age_min);
    const partner_age_max = toInt(input.partner_age_max);
    if (partner_age_min !== undefined && (partner_age_min < 18 || partner_age_min > 80)) {
        errors.push('invalid_partner_age_min');
    }
    if (partner_age_max !== undefined && (partner_age_max < 18 || partner_age_max > 80)) {
        errors.push('invalid_partner_age_max');
    }
    if (partner_age_min !== undefined && partner_age_max !== undefined &&
        partner_age_min > partner_age_max) {
        errors.push('age_min_gt_max');
    }
    const purpose = toStr(input.purpose);
    if (purpose && !['friend', 'dating', 'party', 'serious'].includes(purpose)) {
        errors.push('invalid_purpose');
    }
    const partner_gender = toStr(input.partner_gender);
    if (partner_gender && !['male', 'female', 'any'].includes(partner_gender)) {
        errors.push('invalid_partner_gender');
    }
    const pay_policy = toStr(input.pay_policy);
    if (pay_policy && !['male_pays', 'split', 'flex'].includes(pay_policy)) {
        errors.push('invalid_pay_policy');
    }
    const party_size = toInt(input.party_size);
    if (party_size !== undefined && (party_size < 1 || party_size > 4)) {
        errors.push('invalid_party_size');
    }
    return { ok: errors.length === 0, errors };
}
/** デフォルト応答（未設定時に返す雛形） */
function defaultPrefs() {
    return {
        purpose: null,
        partner_age_min: null,
        partner_age_max: null,
        partner_gender: 'any',
        partner_personality_tags: [],
        partner_atmosphere_tags: [],
        partner_style_tags: [],
        preferred_slots: null,
        areas: [],
        venue_types: [],
        pay_policy: 'flex',
        party_size: 1,
        allow_friends: true,
        use_intro_free: false,
        auto_subscribe_ack: false,
        priority_weights: null,
    };
}
/** GET /api/match-prefs … 現在の希望条件 */
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
         partner_age_min,
         partner_age_max,
         partner_gender,
         partner_personality_tags,
         partner_atmosphere_tags,
         partner_style_tags,
         preferred_slots,
         areas,
         venue_types,
         pay_policy,
         party_size,
         allow_friends,
         use_intro_free,
         auto_subscribe_ack,
         priority_weights
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
/** PUT /api/match-prefs … upsert */
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
        // 正規化
        const payload = {
            purpose: toStr(input.purpose, undefined),
            partner_age_min: toInt(input.partner_age_min, null),
            partner_age_max: toInt(input.partner_age_max, null),
            partner_gender: toStr(input.partner_gender, 'any'),
            partner_personality_tags: toStrArray(input.partner_personality_tags),
            partner_atmosphere_tags: toStrArray(input.partner_atmosphere_tags),
            partner_style_tags: toStrArray(input.partner_style_tags),
            preferred_slots: toJson(input.preferred_slots),
            areas: toStrArray(input.areas),
            venue_types: toStrArray(input.venue_types),
            pay_policy: toStr(input.pay_policy, 'flex'),
            party_size: toInt(input.party_size, 1),
            allow_friends: toBool(input.allow_friends, true),
            use_intro_free: toBool(input.use_intro_free, false),
            auto_subscribe_ack: toBool(input.auto_subscribe_ack, false),
            priority_weights: toJson(input.priority_weights),
        };
        await db.query(`INSERT INTO user_match_prefs (
         user_id, purpose, partner_age_min, partner_age_max, partner_gender,
         partner_personality_tags, partner_atmosphere_tags, partner_style_tags,
         preferred_slots, areas, venue_types, pay_policy, party_size,
         allow_friends, use_intro_free, auto_subscribe_ack, priority_weights
       ) VALUES (
         $1,$2,$3,$4,$5,
         $6,$7,$8,
         $9,$10,$11,$12,$13,
         $14,$15,$16,$17
       )
       ON CONFLICT (user_id) DO UPDATE SET
         purpose = EXCLUDED.purpose,
         partner_age_min = EXCLUDED.partner_age_min,
         partner_age_max = EXCLUDED.partner_age_max,
         partner_gender = EXCLUDED.partner_gender,
         partner_personality_tags = EXCLUDED.partner_personality_tags,
         partner_atmosphere_tags = EXCLUDED.partner_atmosphere_tags,
         partner_style_tags = EXCLUDED.partner_style_tags,
         preferred_slots = EXCLUDED.preferred_slots,
         areas = EXCLUDED.areas,
         venue_types = EXCLUDED.venue_types,
         pay_policy = EXCLUDED.pay_policy,
         party_size = EXCLUDED.party_size,
         allow_friends = EXCLUDED.allow_friends,
         use_intro_free = EXCLUDED.use_intro_free,
         auto_subscribe_ack = EXCLUDED.auto_subscribe_ack,
         priority_weights = EXCLUDED.priority_weights,
         updated_at = NOW()`, [
            uid,
            payload.purpose,
            payload.partner_age_min,
            payload.partner_age_max,
            payload.partner_gender,
            payload.partner_personality_tags,
            payload.partner_atmosphere_tags,
            payload.partner_style_tags,
            payload.preferred_slots,
            payload.areas,
            payload.venue_types,
            payload.pay_policy,
            payload.party_size,
            payload.allow_friends,
            payload.use_intro_free,
            payload.auto_subscribe_ack,
            payload.priority_weights,
        ]);
        // 返却
        const r = await db.query(`SELECT
         purpose,
         partner_age_min,
         partner_age_max,
         partner_gender,
         partner_personality_tags,
         partner_atmosphere_tags,
         partner_style_tags,
         preferred_slots,
         areas,
         venue_types,
         pay_policy,
         party_size,
         allow_friends,
         use_intro_free,
         auto_subscribe_ack,
         priority_weights
       FROM user_match_prefs WHERE user_id = $1`, [uid]);
        return res.json({ prefs: r.rows[0] ?? defaultPrefs() });
    }
    catch (e) {
        console.error('[match-prefs:put]', e?.message || e);
        return res.status(500).json({ error: 'server_error' });
    }
});
exports.default = router;
