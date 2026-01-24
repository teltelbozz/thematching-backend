"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = requireAuth;
exports.requireAuthUserId = requireAuthUserId;
const tokenService_1 = require("../auth/tokenService");
function extractToken(req) {
    const t = (0, tokenService_1.readBearer)(req);
    if (t && t.toLowerCase() !== 'null' && t.toLowerCase() !== 'undefined')
        return t;
    const raw = req.headers.cookie;
    const cookieName = process.env.SESSION_COOKIE_NAME || 'sid';
    if (raw) {
        for (const p of raw.split(';')) {
            const [k, v] = p.trim().split('=');
            if (k === cookieName && v)
                return decodeURIComponent(v);
        }
    }
    return undefined;
}
async function requireAuth(req, res, next) {
    try {
        const token = extractToken(req);
        if (!token)
            return res.status(401).json({ error: 'unauthenticated' });
        const verified = await (0, tokenService_1.verifyAccess)(token);
        const claims = verified?.payload ?? verified;
        const uid = claims?.uid || claims?.userId || claims?.sub;
        if (!uid)
            return res.status(401).json({ error: 'invalid_token' });
        req.userId = typeof uid === 'string' ? parseInt(uid, 10) || uid : uid;
        return next();
    }
    catch (e) {
        console.error('[requireAuth] verify error:', e?.message || e);
        return res.status(401).json({ error: 'unauthenticated' });
    }
}
function requireAuthUserId(req, res, next) {
    if (req.userId == null)
        return res.status(401).json({ error: 'unauthorized' });
    return next();
}
exports.default = requireAuth;
