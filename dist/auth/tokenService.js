"use strict";
// src/auth/tokenService.ts
// jsonwebtoken 版（CommonJS 互換）— HS256 で access / refresh を発行・検証
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.issueAccessToken = issueAccessToken;
exports.issueRefreshToken = issueRefreshToken;
exports.verifyAccess = verifyAccess;
exports.verifyRefreshToken = verifyRefreshToken;
exports.readBearer = readBearer;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const index_js_1 = require("../config/index.js");
const ALG = 'HS256';
const accessSecret = index_js_1.config.jwt.accessSecret;
const refreshSecret = index_js_1.config.jwt.refreshSecret;
/** アクセストークン発行（同期） */
function issueAccessToken(payload) {
    return jsonwebtoken_1.default.sign(payload, accessSecret, {
        algorithm: ALG,
        expiresIn: index_js_1.config.jwt.accessTtlSec, // 秒
    });
}
/** リフレッシュトークン発行（同期） */
function issueRefreshToken(payload) {
    return jsonwebtoken_1.default.sign(payload, refreshSecret, {
        algorithm: ALG,
        expiresIn: index_js_1.config.jwt.refreshTtlSec, // 秒
    });
}
/** アクセストークン検証（既存互換で { payload } を返す・同期） */
function verifyAccess(token) {
    const decoded = jsonwebtoken_1.default.verify(token, accessSecret, { algorithms: [ALG] });
    return { payload: decoded };
}
/** リフレッシュトークン検証（既存互換で { payload } を返す・同期） */
function verifyRefreshToken(token) {
    const decoded = jsonwebtoken_1.default.verify(token, refreshSecret, { algorithms: [ALG] });
    return { payload: decoded };
}
/** Authorization: Bearer xxx 抜き出し（同期） */
function readBearer(req) {
    const h = req.headers.authorization || '';
    const m = /^Bearer\s+(.+)$/.exec(h);
    return m ? m[1] : null;
}
