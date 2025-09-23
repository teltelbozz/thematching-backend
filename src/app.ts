import express from 'express';
import cors from 'cors';

// ★ ESM 実行では import に拡張子 .js を必ず付ける
import healthRouter from './routes/health.js';
import slotsRouter from './routes/slots.js';
import matchesRouter from './routes/matches.js';
import chatsRouter from './routes/chats.js';
import reviewsRouter from './routes/reviews.js';
import authRouter from './routes/auth.js';
import devAuth from './middleware/devAuth.js';
// ユーザ登録追加分(0923)
import profileRouter from './routes/profile.js';
import verifyRouter from './routes/verify.js';
import paymentsRouter from './routes/payments.js';

import { config } from './config/index.js';
const app = express();

/**
 * フロントエンドの URL（CORS 許可先）
 * 必要に応じて Vercel の Environment Variables FRONT_ORIGIN で上書きできます
 */
const FRONT_ORIGIN =
  process.env.FRONT_ORIGIN || 'https://thematching-frontend.vercel.app';

// Vercel 経由で Secure Cookie を扱うために必須
app.set('trust proxy', 1);

/**
 * CORS 設定（Cookie を伴うクロスサイト通信を許可）
 * - origin はワイルドカード不可（credentials:true と共存できない）
 */
function parseOrigins(v: string) {
  return v.split(',').map(s => s.trim()).filter(Boolean);
}
const ALLOW = parseOrigins(process.env.FRONT_ORIGIN || config.frontOrigin);

const corsOptions: cors.CorsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true); // 同一オリジン/ネイティブ
    const ok = ALLOW.includes(origin) || ALLOW.some(p => {
      if (p.endsWith('*')) return origin.startsWith(p.slice(0, -1));
      if (p.startsWith('*.')) return origin.endsWith(p.slice(1));
      return false;
    });
    return (ok || ALLOW.includes(origin)) ? cb(null, true) : cb(new Error(`CORS blocked: ${origin}`));
  },
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
  maxAge: 86400,
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(express.json());

// 開発用の devAuth（環境変数 DEV_FAKE_AUTH=1 のときのみ有効）
if (devAuth) {
  app.use(devAuth);
}

// ルーター登録
app.use('/api/health', healthRouter);
app.use('/api/auth', authRouter);
app.use('/api/slots', slotsRouter);
app.use('/api/matches', matchesRouter);
app.use('/api/chats', chatsRouter);
app.use('/api/reviews', reviewsRouter);

// ユーザ登録追加分(0923)
app.use('/api/profile', profileRouter);
app.use('/api/verify', verifyRouter);
app.use('/api/payments', paymentsRouter);

export default app;