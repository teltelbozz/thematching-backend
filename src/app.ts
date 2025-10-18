// src/app.ts
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import morgan from 'morgan';
import config from './config';

// ★ 追加: DB プールをここで必ず注入
import { pool } from './db';

// ★ ルータ
import authRoutes from './routes/auth';
import profileRoutes from './routes/profile';

const app = express();

// Vercel/プロキシ越しでも Secure Cookie を有効化
app.set('trust proxy', 1);

// ★ ここで必ず DB を差し込む（どの実行パスでも有効）
app.locals.db = pool;

// ログ／JSON／Cookie
app.use(morgan('combined'));
app.use(express.json());
app.use(cookieParser());

// CORS（オリジン固定＋Cookie許可）
app.use(
  cors({
    origin: config.frontOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// ヘルスチェック
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, env: config.env });
});

// ルータのマウント
app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);

// ------- 診断用（任意） -------
app.get('/api/diag/db', (req, res) => {
  res.json({
    hasDb: !!req.app.locals?.db,
    nodeEnv: process.env.NODE_ENV,
    hasEnv: !!process.env.DATABASE_URL,
  });
});

app.get('/api/diag/routes', (_req, res) => {
  const routes: Array<{ method: string; path: string }> = [];
  const stack = (app as any)?._router?.stack ?? [];
  for (const layer of stack) {
    if (layer.route?.path) {
      const methods = Object.keys(layer.route.methods)
        .filter((m) => layer.route.methods[m])
        .map((m) => m.toUpperCase());
      methods.forEach((m) => routes.push({ method: m, path: layer.route.path }));
    } else if (layer.name === 'router' && layer.handle?.stack) {
      for (const lr of layer.handle.stack) {
        if (!lr.route?.path) continue;
        const methods = Object.keys(lr.route.methods)
          .filter((m) => lr.route.methods[m])
          .map((m) => m.toUpperCase());
        // ベースパスの推測は控えめに
        methods.forEach((m) => routes.push({ method: m, path: lr.route.path }));
      }
    }
  }
  res.json({ routes });
});
// -----------------------------

export default app;