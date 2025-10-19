"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.issueAccessToken = issueAccessToken;
exports.issueRefreshToken = issueRefreshToken;
exports.verifyAccess = verifyAccess;
exports.verifyRefresh = verifyRefresh;
exports.readBearer = readBearer;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const config_1 = __importDefault(require("../config"));
const ALG = 'HS256';
const accessSecret = config_1.default.jwt.accessSecret;
const refreshSecret = config_1.default.jwt.refreshSecret;
function stripJwtReserved(p) {
    const { exp, iat, nbf, ...rest } = p;
    return rest;
}
async function issueAccessToken(payload) {
    const clean = stripJwtReserved(payload);
    return jsonwebtoken_1.default.sign(clean, accessSecret, {
        algorithm: ALG,
        expiresIn: config_1.default.jwt.accessTtlSec,
    });
}
async function issueRefreshToken(payload) {
    const clean = stripJwtReserved(payload);
    return jsonwebtoken_1.default.sign(clean, refreshSecret, {
        algorithm: ALG,
        expiresIn: config_1.default.jwt.refreshTtlSec,
    });
}
/** 署名検証（payload をそのまま返す） */
async function verifyAccess(token) {
    return jsonwebtoken_1.default.verify(token, accessSecret, { algorithms: [ALG] });
}
async function verifyRefresh(token) {
    return jsonwebtoken_1.default.verify(token, refreshSecret, { algorithms: [ALG] });
}
/** Authorization: Bearer xxx 抜き出し */
function readBearer(req) {
    const h = req.headers.authorization || '';
    const m = /^Bearer\s+(.+)$/.exec(h);
    return m ? m[1] : null;
}
