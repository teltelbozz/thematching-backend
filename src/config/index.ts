
/**
 * 全設定値をまとめたオブジェクト
 */
const config = {
  env: process.env.NODE_ENV ?? 'development',
  frontOrigin: process.env.FRONT_ORIGIN || 'https://thematching-frontend.vercel.app',
  corsMethods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'] as const,
  line: {
    issuer: process.env.LINE_ISSUER || 'https://access.line.me',
    channelId: must(process.env.LINE_CHANNEL_ID, 'LINE_CHANNEL_ID'),
  },
  jwt: {
    accessSecret: must(process.env.ACCESS_SECRET, 'ACCESS_SECRET'),
    refreshSecret: must(process.env.REFRESH_SECRET, 'REFRESH_SECRET'),
    accessTtlSec: Number(process.env.ACCESS_TTL_SECONDS || 600),
    refreshTtlSec: Number(process.env.REFRESH_TTL_SECONDS || 60 * 60 * 7),
    refreshCookie: process.env.REFRESH_COOKIE_NAME || 'rt',
  },
  db: {
    url: must(process.env.DATABASE_URL, 'DATABASE_URL'),
  },
  debugAuth: process.env.DEBUG_AUTH === '1',
  devAuth: process.env.DEV_FAKE_AUTH === '1' || process.env.DEV_FAKE_AUTH?.toLowerCase() === 'true',
} as const;

function must<T>(v: T | undefined, name: string): T {
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

export default config;       // import config from '../config'
export { config };          // import { config } from '../config'
export const CONFIG = config; // import { CONFIG } from '../config' も可