// src/app.ts
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import morgan from 'morgan';
import config from './config';

import authRoutes from './routes/auth';
import profileRoutes from './routes/profile';

const app = express();

app.set('trust proxy', 1);

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

// 診断: ルート一覧
app.get('/api/diag/routes', (_req, res) => {
  const routes: Array<{ method: string; path: string }> = [];
  const stack = (app as any)?._router?.stack ?? [];
  for (const layer of stack) {
    if (layer.route?.path) {
      const methods = Object.keys(layer.route.methods).filter((m) => layer.route.methods[m]);
      for (const m of methods) routes.push({ method: m.toUpperCase(), path: layer.route.path });
    } else if (layer.name === 'router' && layer.handle?.stack) {
      for (const lr of layer.handle.stack) {
        if (!lr.route?.path) continue;
        const methods = Object.keys(lr.route.methods).filter((m) => lr.route.methods[m]);
        const base =
          (layer?.regexp?.fast_star && '*') ||
          (layer?.regexp?.fast_slash && '/') ||
          (layer?.regexp?.source?.includes('\\/api') ? '/api' : '');
        for (const m of methods) routes.push({ method: m.toUpperCase(), path: `${base}${lr.route.path}` });
      }
    }
  }
  res.json({ routes });
});

export default app;