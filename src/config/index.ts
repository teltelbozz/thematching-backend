// src/config/index.ts
export type SameSiteOpt = 'lax' | 'strict' | 'none';

function must(v: string | undefined, name: string) {
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const env = process.env.NODE_ENV ?? 'development';
const isProd = env === 'production';

export const config = {
  env,
  isProd,

  // フロントの正確なオリジン（例: https://thematching-frontend.vercel.app）
  frontOrigin: must(process.env.FRONT_ORIGIN, 'FRONT_ORIGIN'),

  // LINE
  line: {
    issuer: process.env.LINE_ISSUER || 'https://access.line.me',
    channelId: must(process.env.LINE_CHANNEL_ID, 'LINE_CHANNEL_ID'),
  },

  // JWT
  jwt: {
    accessSecret: must(process.env.ACCESS_SECRET, 'ACCESS_SECRET'),
    refreshSecret: must(process.env.REFRESH_SECRET, 'REFRESH_SECRET'),
    accessTtlSec: Number(process.env.ACCESS_TTL_SECONDS || 600),
    refreshTtlSec: Number(process.env.REFRESH_TTL_SECONDS || 60 * 60 * 24 * 7),
    refreshCookie: process.env.REFRESH_COOKIE_NAME || 'rt',
  },

  // dev フラグ
  devAuth:
    process.env.DEV_FAKE_AUTH === '1' ||
    process.env.DEV_FAKE_AUTH?.toLowerCase() === 'true',

  // Cookie ポリシー
  cookie: {
    sameSite: (process.env.COOKIE_SAMESITE?.toLowerCase() as SameSiteOpt) || 'none',
    secure:
      (process.env.COOKIE_SECURE?.toLowerCase() || (isProd ? 'true' : 'false')) ===
      'true',
    // 必要時のみ指定（不要なら undefined にして付けない）
    domain: process.env.COOKIE_DOMAIN || undefined,
    path: process.env.COOKIE_PATH || '/',
  },
} as const;

export default config;