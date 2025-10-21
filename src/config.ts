// src/config.ts
const env = process.env;

/**
 * 指定した環境変数が未定義ならエラーを投げる。
 */
function must(v: string | undefined, name: string): string {
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

/**
 * JWT 秘密鍵は「JWT_」付き → 無ければ旧名をフォールバック。
 */
const accessSecret = env.JWT_ACCESS_SECRET ?? env.ACCESS_SECRET;
const refreshSecret = env.JWT_REFRESH_SECRET ?? env.REFRESH_SECRET;

const config = {
  // NODE_ENV
  env: env.NODE_ENV || 'development',

  // CORS 許可先（Vercel Frontend URL）
  frontOrigin: must(env.FRONT_ORIGIN, 'FRONT_ORIGIN'),

  jwt: {
    // TypeScript的に確実にstring型と保証される
    accessSecret: must(accessSecret, 'JWT_ACCESS_SECRET or ACCESS_SECRET'),
    refreshSecret: must(refreshSecret, 'JWT_REFRESH_SECRET or REFRESH_SECRET'),
    accessTtlSec: Number(env.ACCESS_TTL_SECONDS || 600),
    refreshTtlSec: Number(env.REFRESH_TTL_SECONDS || 60 * 60 * 24 * 7),
    refreshCookie: env.REFRESH_COOKIE_NAME || 'rt',
  },

  line: {
    // デフォルト値を許容
    issuer: env.LINE_ISSUER || 'https://access.line.me',
    channelId: must(env.LINE_CHANNEL_ID, 'LINE_CHANNEL_ID'),
  },
};

export default config;
export type AppConfig = typeof config;