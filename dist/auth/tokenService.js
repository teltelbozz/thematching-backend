"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readBearer = readBearer;
exports.readCookie = readCookie;
exports.signAccess = signAccess;
exports.verifyAccess = verifyAccess;
exports.signRefresh = signRefresh;
exports.verifyRefresh = verifyRefresh;
exports.base64url = base64url;
const jose_1 = require("jose");
const index_js_1 = require("../config/index.js");
// ===== util =====
// Bearer ヘッダから JWT を取り出す
function readBearer(req) {
    const h = req.headers['authorization'];
    if (!h)
        return null;
    const m = /^Bearer (.+)$/i.exec(h);
    return m ? m[1] : null;
}
// Cookie から値を取り出す
function readCookie(req, name) {
    const h = req.headers['cookie'];
    if (!h)
        return null;
    const m = new RegExp(`${name}=([^;]+)`).exec(h);
    return m ? decodeURIComponent(m[1]) : null;
}
// ===== token service =====
// access token (短期)
async function signAccess(uid) {
    return await new jose_1.SignJWT({ uid })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime(`${index_js_1.config.jwt.accessTtlSec}s`)
        .sign(new TextEncoder().encode(index_js_1.config.jwt.accessSecret));
}
async function verifyAccess(token) {
    return await (0, jose_1.jwtVerify)(token, new TextEncoder().encode(index_js_1.config.jwt.accessSecret), {
        algorithms: ['HS256'],
    });
}
// refresh token (長期)
async function signRefresh(uid, rot) {
    return await new jose_1.SignJWT({ uid, rot })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime(`${index_js_1.config.jwt.refreshTtlSec}s`)
        .sign(new TextEncoder().encode(index_js_1.config.jwt.refreshSecret));
}
async function verifyRefresh(token) {
    return await (0, jose_1.jwtVerify)(token, new TextEncoder().encode(index_js_1.config.jwt.refreshSecret), {
        algorithms: ['HS256'],
    });
}
// ===== helper =====
// base64url encode（必要に応じて利用）
function base64url(input) {
    return Buffer.from(input, 'base64')
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '')
        .split('')
        .map((s) => s.charCodeAt(0).toString(16)) // ★型を追加
        .join('');
}
