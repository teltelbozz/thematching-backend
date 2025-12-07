// src/app.ts
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import morgan from 'morgan';
import config from './config';
import meRoutes from './routes/me' 
import matchPrefsRoutes from './routes/matchPrefs';
import setupRoutes from './routes/setup';
import requireAuth from './middleware/requireAuth'; // 既存
import groupsRouter from "./routes/groups";
import matchCron from "./cron/matchCron";
import cronRouter from './routes/cron';
import matchingResultRouter from './routes/matchingResult'; //マッチング結果を返す


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
app.use('/api/me', meRoutes);
app.use('/api/match-prefs', matchPrefsRoutes); 
app.use('/api/setup', requireAuth, setupRoutes);
app.use("/groups", groupsRouter);//参加URL生成
app.use('/cron', cronRouter);
app.use('/admin', matchingResultRouter);

export default app;