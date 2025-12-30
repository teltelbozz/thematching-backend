// src/app.ts
import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import morgan from "morgan";
import config from "./config";
import meRoutes from "./routes/me";
import matchPrefsRoutes from "./routes/matchPrefs";
import setupRoutes from "./routes/setup";
import requireAuth from "./middleware/requireAuth";
import groupsRouter from "./routes/groups";
import cronRouter from "./routes/cron";
import matchingResultRouter from "./routes/matchingResult";
import path from "path";
import adminUsersRouter from "./routes/adminUsers";
import adminUserDetailRouter from "./routes/adminUserDetail";

import { pool } from "./db";

import authRoutes from "./routes/auth";
import profileRoutes from "./routes/profile";
import termsRoutes from "./routes/terms";

// ★ 追加：Blob routes
import blobRoutes from "./routes/blob";

const app = express();

// Vercel/プロキシ越しでも Secure Cookie を有効化
app.set("trust proxy", 1);

// ★ DB
app.locals.db = pool;

app.use(morgan("combined"));
app.use(express.json());
app.use(cookieParser());

app.use(
  cors({
    origin: config.frontOrigin,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-cleanup-token"],
  })
);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, env: config.env, build: process.env.VERCEL_GIT_COMMIT_SHA });
});

app.use("/api/auth", authRoutes);
app.use("/api/profile", profileRoutes);

// 規約
app.use("/api/terms", termsRoutes);

// ★ 追加：Blob（アップロード/クリーンアップ）
app.use("/api/blob", requireAuth, blobRoutes);

app.use("/api/me", meRoutes);
app.use("/api/match-prefs", matchPrefsRoutes);
app.use("/api/setup", requireAuth, setupRoutes);
app.use("/groups", groupsRouter);
app.use("/cron", cronRouter);
app.use("/admin", matchingResultRouter);
app.use("/admin", adminUsersRouter);
app.use("/admin", adminUserDetailRouter);

// dist/public を参照
app.use(express.static(path.join(__dirname, "public")));

export default app;