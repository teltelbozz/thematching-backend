// src/app.ts
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import morgan from 'morgan';
import config from './config';

// ★ 追加：各ルータ
import authRoutes from './routes/auth';
import profileRoutes from './routes/profile'; // ← これを必ず import

const app = express();

// Vercel/プロキシ越しでも Secure Cookie を有効化
app.set('trust proxy', 1);

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
app.use('/api/profile', profileRoutes);  //router.get('/', ...) なので、この記載。 /api/profile にマウントされる

// ------- 診断用: 登録ルートを一覧表示 -------
app.get('/api/diag/routes', (_req, res) => {
  const routes: Array<{ method: string; path: string }> = [];
  const stack = (app as any)?._router?.stack ?? [];
  for (const layer of stack) {
    if (layer.route && layer.route.path) {
      const methods = Object.keys(layer.route.methods)
        .filter((m) => layer.route.methods[m])
        .map((m) => m.toUpperCase());
      for (const m of methods) {
        routes.push({ method: m, path: layer.route.path });
      }
    } else if (layer.name === 'router' && layer.handle?.stack) {
      for (const lr of layer.handle.stack) {
        if (lr.route?.path) {
          const methods = Object.keys(lr.route.methods)
            .filter((m) => lr.route.methods[m])
            .map((m) => m.toUpperCase());
          for (const m of methods) {
            // ベースパス（layer.regexp）をざっくり復元
            const base =
              (layer?.regexp?.fast_star && '*') ||
              (layer?.regexp?.fast_slash && '/') ||
              (layer?.regexp?.source?.includes('\\/api') ? '/api' : '');
            routes.push({ method: m, path: `${base}${lr.route.path}` });
          }
        }
      }
    }
  }
  res.json({ routes });
});
// --------------------------------------------

export default app;