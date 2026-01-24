"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// src/routes/terms.ts
const express_1 = require("express");
const tokenService_1 = require("../auth/tokenService");
const router = (0, express_1.Router)();
console.log('[boot] terms router loaded');
router.get('/ping', (_req, res) => res.json({ ok: true, ping: 'terms-route-alive' }));
function normalizeClaims(v) {
    if (v && typeof v === 'object' && 'payload' in v)
        return v.payload;
    return v;
}
function normalizeUidNumber(v) {
    if (typeof v === 'number' && Number.isFinite(v))
        return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)))
        return Number(v);
    return null;
}
async function resolveUserIdFromClaims(claims, db) {
    const raw = claims?.uid;
    const asNum = normalizeUidNumber(raw);
    if (asNum != null)
        return asNum;
    if (typeof raw === 'string' && raw.trim()) {
        const sub = raw.trim();
        const r1 = await db.query('SELECT id FROM users WHERE line_user_id = $1 LIMIT 1', [sub]);
        if (r1.rows[0])
            return r1.rows[0].id;
        const r2 = await db.query('INSERT INTO users (line_user_id) VALUES ($1) RETURNING id', [sub]);
        return r2.rows[0]?.id ?? null;
    }
    return null;
}
function getDb(req) {
    const db = req.app?.locals?.db;
    if (!db)
        throw new Error('db_not_initialized');
    return db;
}
async function getCurrentTerms(db) {
    const r = await db.query(`
    SELECT id, version, title, body_md, effective_at
    FROM terms_documents
    WHERE effective_at <= now()
    ORDER BY effective_at DESC
    LIMIT 1
    `);
    return r.rows[0] ?? null;
}
router.get('/current', async (req, res) => {
    try {
        const db = getDb(req);
        const terms = await getCurrentTerms(db);
        if (!terms)
            return res.status(404).json({ error: 'no_terms' });
        return res.json({ ok: true, terms });
    }
    catch (e) {
        console.error('[terms/current]', e);
        return res.status(500).json({ error: e?.message || 'server_error' });
    }
});
router.get('/status', async (req, res) => {
    try {
        const token = (0, tokenService_1.readBearer)(req);
        if (!token)
            return res.status(401).json({ error: 'unauthenticated' });
        const verified = await (0, tokenService_1.verifyAccess)(token);
        const claims = normalizeClaims(verified);
        const db = getDb(req);
        const userId = await resolveUserIdFromClaims(claims, db);
        if (userId == null)
            return res.status(401).json({ error: 'unauthenticated' });
        const terms = await getCurrentTerms(db);
        if (!terms) {
            return res.json({
                ok: true,
                accepted: true,
                currentVersion: null,
                acceptedVersion: null,
            });
        }
        const r = await db.query(`
      SELECT 1
      FROM user_terms_acceptances
      WHERE user_id = $1 AND terms_id = $2
      LIMIT 1
      `, [userId, terms.id]);
        const accepted = (r.rowCount ?? 0) > 0;
        return res.json({
            ok: true,
            accepted,
            currentVersion: terms.version,
            acceptedVersion: accepted ? terms.version : null,
        });
    }
    catch (e) {
        console.error('[terms/status]', e);
        return res.status(500).json({ error: e?.message || 'server_error' });
    }
});
router.post('/accept', async (req, res) => {
    try {
        const token = (0, tokenService_1.readBearer)(req);
        if (!token)
            return res.status(401).json({ error: 'unauthenticated' });
        const verified = await (0, tokenService_1.verifyAccess)(token);
        const claims = normalizeClaims(verified);
        const db = getDb(req);
        const userId = await resolveUserIdFromClaims(claims, db);
        if (userId == null)
            return res.status(401).json({ error: 'unauthenticated' });
        const { termsId, version, userAgent } = req.body || {};
        let terms = null;
        if (termsId && Number.isFinite(Number(termsId))) {
            const r = await db.query(`SELECT id, version FROM terms_documents WHERE id = $1 LIMIT 1`, [Number(termsId)]);
            terms = r.rows[0] ?? null;
        }
        else if (version && typeof version === 'string') {
            const r = await db.query(`SELECT id, version FROM terms_documents WHERE version = $1 LIMIT 1`, [version]);
            terms = r.rows[0] ?? null;
        }
        else {
            const cur = await getCurrentTerms(db);
            if (cur)
                terms = { id: cur.id, version: cur.version };
        }
        if (!terms)
            return res.status(404).json({ error: 'terms_not_found' });
        await db.query(`
      INSERT INTO user_terms_acceptances (user_id, terms_id, accepted_at, user_agent)
      VALUES ($1, $2, now(), $3)
      ON CONFLICT (user_id, terms_id) DO UPDATE SET
        accepted_at = EXCLUDED.accepted_at,
        user_agent = COALESCE(EXCLUDED.user_agent, user_terms_acceptances.user_agent)
      `, [userId, terms.id, typeof userAgent === 'string' ? userAgent : null]);
        return res.json({
            ok: true,
            accepted: true,
            termsId: terms.id,
            version: terms.version,
        });
    }
    catch (e) {
        console.error('[terms/accept]', e);
        return res.status(500).json({ error: e?.message || 'server_error' });
    }
});
exports.default = router;
