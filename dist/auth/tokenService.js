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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.issueAccessToken = issueAccessToken;
exports.issueRefreshToken = issueRefreshToken;
exports.verifyAccess = verifyAccess;
exports.verifyRefreshToken = verifyRefreshToken;
exports.readBearer = readBearer;
const config_1 = __importDefault(require("../config"));
// ESM専用の jose を CJS でも使えるように関数内で動的 import
const loadJose = () => Promise.resolve().then(() => __importStar(require('jose')));
const enc = new TextEncoder();
const accessKey = enc.encode(config_1.default.jwt.accessSecret);
const refreshKey = enc.encode(config_1.default.jwt.refreshSecret);
/** アクセストークン発行 */
async function issueAccessToken(payload) {
    const { SignJWT } = await loadJose();
    return await new SignJWT(payload)
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime(`${config_1.default.jwt.accessTtlSec}s`)
        .sign(accessKey);
}
/** リフレッシュトークン発行 */
async function issueRefreshToken(payload) {
    const { SignJWT } = await loadJose();
    return await new SignJWT(payload)
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime(`${config_1.default.jwt.refreshTtlSec}s`)
        .sign(refreshKey);
}
/** アクセストークン検証（既存互換で { payload } 返却） */
async function verifyAccess(token) {
    const { jwtVerify } = await loadJose();
    const res = await jwtVerify(token, accessKey, { algorithms: ['HS256'] });
    return { payload: res.payload };
}
/** リフレッシュトークン検証（既存互換で { payload } 返却） */
async function verifyRefreshToken(token) {
    const { jwtVerify } = await loadJose();
    const res = await jwtVerify(token, refreshKey, { algorithms: ['HS256'] });
    return { payload: res.payload };
}
/** Authorization: Bearer xxx 抜き出し */
function readBearer(req) {
    const h = req.headers.authorization || '';
    const m = /^Bearer\s+(.+)$/.exec(h);
    return m ? m[1] : null;
}
