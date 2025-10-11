"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = requireAuth;
const jose_1 = require("jose");
const SESSION_SECRET = new TextEncoder().encode(process.env.SESSION_SECRET || 'dev-secret');
const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'sid';
function readCookie(req, name) {
    const raw = req.headers?.cookie;
    if (!raw)
        return;
    const target = raw.split(';').map((s) => s.trim()).find((s) => s.startsWith(name + '='));
    return target ? decodeURIComponent(target.split('=')[1]) : undefined;
}
async function requireAuth(req, res, next) {
    try {
        const bearer = String(req.headers['authorization'] || '');
        const tokenFromBearer = bearer.startsWith('Bearer ') ? bearer.slice(7) : undefined;
        const token = tokenFromBearer || readCookie(req, SESSION_COOKIE_NAME);
        if (!token)
            return res.status(401).json({ error: 'unauthenticated' });
        const { payload } = await (0, jose_1.jwtVerify)(token, SESSION_SECRET, { algorithms: ['HS256'] });
        req.userId = payload.uid;
        return next();
    }
    catch (e) {
        return res.status(401).json({ error: 'unauthenticated' });
    }
}
