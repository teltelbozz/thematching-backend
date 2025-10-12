"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = requireAuth;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret';
const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'sid';
function readCookie(req, name) {
    const raw = req.headers?.cookie;
    if (!raw)
        return;
    const target = raw
        .split(';')
        .map((s) => s.trim())
        .find((s) => s.startsWith(name + '='));
    return target ? decodeURIComponent(target.split('=')[1]) : undefined;
}
async function requireAuth(req, res, next) {
    try {
        const bearer = String(req.headers['authorization'] || '');
        const tokenFromBearer = bearer.startsWith('Bearer ') ? bearer.slice(7) : undefined;
        const token = tokenFromBearer || readCookie(req, SESSION_COOKIE_NAME);
        if (!token)
            return res.status(401).json({ error: 'unauthenticated' });
        const decoded = jsonwebtoken_1.default.verify(token, SESSION_SECRET, { algorithms: ['HS256'] });
        req.userId = decoded?.uid;
        return next();
    }
    catch (e) {
        console.error('[requireAuth]', e);
        return res.status(401).json({ error: 'unauthenticated' });
    }
}
exports.default = requireAuth;
