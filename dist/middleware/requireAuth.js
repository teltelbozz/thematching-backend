"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = requireAuth;
// joseはESM専用なので、関数内で動的importする
const loadJose = () => Promise.resolve().then(() => __importStar(require('jose')));
const SESSION_SECRET = new TextEncoder().encode(process.env.SESSION_SECRET || 'dev-secret');
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
        // 動的importでjwtVerifyを取得
        const { jwtVerify } = await loadJose();
        const { payload } = await jwtVerify(token, SESSION_SECRET, { algorithms: ['HS256'] });
        req.userId = payload.uid;
        return next();
    }
    catch (e) {
        console.error('[requireAuth]', e);
        return res.status(401).json({ error: 'unauthenticated' });
    }
}
exports.default = requireAuth;
