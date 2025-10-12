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
exports.verifyLineIdToken = verifyLineIdToken;
// src/auth/lineVerify.ts
const index_js_1 = require("../config/index.js");
// jose は ESM 専用のため、CJS/TS からは動的 import で呼び出す
const joseP = Promise.resolve().then(() => __importStar(require('jose')));
/**
 * LINEのIDトークンを公式JWKSでRS256検証し、ペイロードを返す
 */
async function verifyLineIdToken(idToken) {
    if (!idToken || typeof idToken !== 'string') {
        throw new Error('Missing id_token');
    }
    const { createRemoteJWKSet, jwtVerify } = await joseP;
    // LINE 公式 JWKS（公開鍵）
    const JWKS = createRemoteJWKSet(new URL('https://api.line.me/oauth2/v2.1/certs'));
    const { payload, protectedHeader } = await jwtVerify(idToken, JWKS, {
        issuer: index_js_1.config.line.issuer || 'https://access.line.me',
        audience: index_js_1.config.line.channelId, // 例: "2008150959"
        algorithms: ['RS256'], // RS256 を明示
        clockTolerance: 300, // ±5分許容（端末時間ズレ対策）
    });
    // 念のため alg の健全性チェック（想定外を早期検知）
    if (protectedHeader?.alg && protectedHeader.alg !== 'RS256') {
        throw new Error(`Unexpected alg: ${protectedHeader.alg}`);
    }
    return payload;
}
exports.default = verifyLineIdToken;
