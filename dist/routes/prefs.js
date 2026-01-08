"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const tokenService_1 = require("../auth/tokenService");
const router = (0, express_1.Router)();
function normUid(v) {
    if (typeof v === 'number' && Number.isFinite(v))
        return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)))
        return Number(v);
    return null;
}
router.get('/', async (req, res) => {
    try {
        const token = (0, tokenService_1.readBearer)(req);
        if (!token)
            return res.status(401).json({ error: 'unauthenticated' });
        const { payload } = await (0, tokenService_1.verifyAccess)(token);
        const uid = normUid(payload.uid);
        if (uid == null)
            return res.status(401).json({ error: 'unauthenticated' });
        const db = req.app.locals.db;
        const r = await db.query(`SELECT user_id, participation_style, party_size, type_mode, venue_pref, cost_pref, saved_dates
       FROM user_match_prefs WHERE user_id = $1`, [uid]);
        return res.json({ prefs: r.rows[0] || null });
    }
    catch (e) {
        console.error('[prefs:get]', e?.message || e);
        return res.status(500).json({ error: 'server_error' });
    }
});
router.put('/', async (req, res) => {
    try {
        const token = (0, tokenService_1.readBearer)(req);
        if (!token)
            return res.status(401).json({ error: 'unauthenticated' });
        const { payload } = await (0, tokenService_1.verifyAccess)(token);
        const uid = normUid(payload.uid);
        if (uid == null)
            return res.status(401).json({ error: 'unauthenticated' });
        const { participation_style, party_size, type_mode, venue_pref, cost_pref, saved_dates } = req.body || {};
        // ざっくりバリデーション
        if (participation_style && !['solo', 'with_friend'].includes(participation_style))
            return res.status(400).json({ error: 'invalid_participation_style' });
        if (party_size != null && !(Number.isInteger(party_size) && party_size >= 1 && party_size <= 4))
            return res.status(400).json({ error: 'invalid_party_size' });
        if (type_mode && !['talk', 'play', 'either'].includes(type_mode))
            return res.status(400).json({ error: 'invalid_type_mode' });
        if (venue_pref && !['cheap_izakaya', 'fancy_dining', 'bar_cafe'].includes(venue_pref))
            return res.status(400).json({ error: 'invalid_venue_pref' });
        if (cost_pref && !['men_pay_all', 'split_even', 'follow_partner'].includes(cost_pref))
            return res.status(400).json({ error: 'invalid_cost_pref' });
        if (saved_dates && !Array.isArray(saved_dates))
            return res.status(400).json({ error: 'invalid_saved_dates' });
        const db = req.app.locals.db;
        await db.query(`INSERT INTO user_match_prefs (user_id, participation_style, party_size, type_mode, venue_pref, cost_pref, saved_dates)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (user_id) DO UPDATE SET
         participation_style = COALESCE(EXCLUDED.participation_style, user_match_prefs.participation_style),
         party_size          = COALESCE(EXCLUDED.party_size,          user_match_prefs.party_size),
         type_mode           = COALESCE(EXCLUDED.type_mode,           user_match_prefs.type_mode),
         venue_pref          = COALESCE(EXCLUDED.venue_pref,          user_match_prefs.venue_pref),
         cost_pref           = COALESCE(EXCLUDED.cost_pref,           user_match_prefs.cost_pref),
         saved_dates         = COALESCE(EXCLUDED.saved_dates,         user_match_prefs.saved_dates),
         updated_at = NOW()`, [uid, participation_style ?? null, party_size ?? null, type_mode ?? null, venue_pref ?? null, cost_pref ?? null, saved_dates ?? null]);
        const r = await db.query(`SELECT user_id, participation_style, party_size, type_mode, venue_pref, cost_pref, saved_dates
       FROM user_match_prefs WHERE user_id = $1`, [uid]);
        return res.json({ prefs: r.rows[0] });
    }
    catch (e) {
        console.error('[prefs:put]', e?.message || e);
        return res.status(500).json({ error: 'server_error' });
    }
});
exports.default = router;
