"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// src/config.ts
const env = process.env;
function must(name, v) {
    if (!v)
        throw new Error(`Missing env: ${name}`);
    return v;
}
const config = {
    env: env.NODE_ENV || 'development',
    frontOrigin: must('FRONT_ORIGIN', env.FRONT_ORIGIN), // CORS 許可先
    jwt: {
        accessSecret: must('JWT_ACCESS_SECRET', env.JWT_ACCESS_SECRET),
        refreshSecret: must('JWT_REFRESH_SECRET', env.JWT_REFRESH_SECRET),
        accessTtlSec: Number(env.JWT_ACCESS_TTL_SEC ?? '600'),
        refreshTtlSec: Number(env.JWT_REFRESH_TTL_SEC ?? '2592000'),
        refreshCookie: env.JWT_REFRESH_COOKIE || 'app_refresh',
    },
    line: {
        issuer: must('LINE_ISSUER', env.LINE_ISSUER),
        channelId: must('LINE_CHANNEL_ID', env.LINE_CHANNEL_ID),
    },
};
exports.default = config;
