// src/app.ts
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import morgan from 'morgan';
import config from './config';
import authRoutes from './routes/auth';

const app = express();

// 重要：Vercel/プロキシ越しでも Secure Cookie を有効にするため
app.set('trust proxy', 1);

// ログ／JSON／Cookie
app.use(morgan('combined'));
app.use(express.json());
app.use(cookieParser());

// CORS 設定：オリジン固定＋Cookie許可（※ワイルドカード不可）
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

// 認証ルート
app.use('/api/auth', authRoutes);

export default app;