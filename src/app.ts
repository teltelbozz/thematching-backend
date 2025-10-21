// src/app.ts
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import morgan from 'morgan';
import config from './config';

// ★ 追加
import { pool } from './db';

import authRoutes from './routes/auth';
import profileRoutes from './routes/profile';

const app = express();

// Vercel/プロキシ越しでも Secure Cookie を有効化
app.set('trust proxy', 1);

// ★ 追加：ここで必ず DB を差し込む（保険）
app.locals.db = pool;

app.use(morgan('combined'));
app.use(express.json());
app.use(cookieParser());

app.use(
  cors({
    origin: config.frontOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, env: config.env });
});

app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);

export default app;