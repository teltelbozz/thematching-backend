"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// src/config.ts
const env = process.env;
function must(v, name) {
    if (!v)
        throw new Error(`Missing env: ${name}`);
    return v;
}
const accessSecret = env.JWT_ACCESS_SECRET ?? env.ACCESS_SECRET;
const refreshSecret = env.JWT_REFRESH_SECRET ?? env.REFRESH_SECRET;
const config = {
    env: env.NODE_ENV || 'development',
    frontOrigin: must(env.FRONT_ORIGIN, 'FRONT_ORIGIN'),
    jwt: {
        accessSecret: must(accessSecret, 'JWT_ACCESS_SECRET or ACCESS_SECRET'),
        refreshSecret: must(refreshSecret, 'JWT_REFRESH_SECRET or REFRESH_SECRET'),
        accessTtlSec: Number(env.ACCESS_TTL_SECONDS || 600),
        refreshTtlSec: Number(env.REFRESH_TTL_SECONDS || 60 * 60 * 24 * 7),
        refreshCookie: env.REFRESH_COOKIE_NAME || 'rt',
    },
    line: {
        issuer: env.LINE_ISSUER || 'https://access.line.me',
        channelId: must(env.LINE_CHANNEL_ID, 'LINE_CHANNEL_ID'),
        channelAccessToken: env.LINE_CHANNEL_ACCESS_TOKEN || "", // mustにするかは好み
    },
};
exports.default = config;
