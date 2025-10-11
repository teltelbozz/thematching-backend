import express from 'express';
import cors from 'cors';
import morgan from 'morgan';

import { devAuth } from './middleware/devAuth';

// 既存のルート群（実装済みのものだけ import してください）
import authRoutes from './routes/auth';
import profileRoutes from './routes/profile';
import prefsRoutes from './routes/prefs';
import setupRoutes from './routes/setup';
// もし他にもあればここで import
// import slotsRoutes from './routes/slots';
// import matchesRoutes from './routes/matches';
// import chatsRoutes from './routes/chats';

const app = express();

// 逆プロキシ（Vercel/Proxy）前提なら
app.set('trust proxy', 1);

// ログ
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// CORS
app.use(cors({
  origin: process.env.FRONT_ORIGIN, // 例: https://thematching-frontend.vercel.app
  credentials: true,
}));

// Body
app.use(express.json({ limit: '1mb' }));

// devAuth（※必ず /api/* ルートより前に）
app.use(devAuth);

// ---- ヘルスチェック ----
app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});
app.get('/api/health/ping', (_req, res) => {
  res.type('text').send('pong');
});

// ---- 既存APIルート ----
app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/prefs', prefsRoutes);
app.use('/api/setup', setupRoutes);
// app.use('/api/slots', slotsRoutes);
// app.use('/api/matches', matchesRoutes);
// app.use('/api/chats', chatsRoutes);

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'not_found', path: req.path });
});

// エラーハンドラ
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[app:error]', err);
  const status = err?.status || 500;
  res.status(status).json({ error: 'server_error', message: err?.message || 'internal_error' });
});

export default app;