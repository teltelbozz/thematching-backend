"use strict";
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
const config_1 = __importDefault(require("../config"));
const ALG = 'HS256';
const accessSecret = config_1.default.jwt.accessSecret;
const refreshSecret = config_1.default.jwt.refreshSecret;
/** アクセストークン発行 */
async function issueAccessToken(payload) {
    return jsonwebtoken_1.default.sign(payload, accessSecret, {
        algorithm: ALG,
        expiresIn: config_1.default.jwt.accessTtlSec, // 秒
    });
}
/** リフレッシュトークン発行 */
async function issueRefreshToken(payload) {
    return jsonwebtoken_1.default.sign(payload, refreshSecret, {
        algorithm: ALG,
        expiresIn: config_1.default.jwt.refreshTtlSec, // 秒
    });
}
/** アクセストークン検証（既存互換で { payload } を返す） */
async function verifyAccess(token) {
    const decoded = jsonwebtoken_1.default.verify(token, accessSecret, { algorithms: [ALG] });
    return { payload: decoded };
}
/** リフレッシュトークン検証（既存互換で { payload } を返す） */
async function verifyRefreshToken(token) {
    const decoded = jsonwebtoken_1.default.verify(token, refreshSecret, { algorithms: [ALG] });
    return { payload: decoded };
}
/** Authorization: Bearer xxx 抜き出し */
function readBearer(req) {
    const h = req.headers.authorization || '';
    const m = /^Bearer\s+(.+)$/.exec(h);
    return m ? m[1] : null;
}
