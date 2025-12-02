// src/cron/matchCron.ts
import express from "express";
import type { Pool } from "pg";
import { runDailyMatching } from "../match/matchService";

const router = express.Router();

/**
 * /cron/match-daily
 * Vercel Cron から叩く専用エンドポイント
 */
router.post("/match-daily", async (req, res) => {
  const db = req.app.locals.db as Pool;

  try {
    const results = await runDailyMatching(db);

    return res.json({
      ok: true,
      groups: results
    });
  } catch (e) {
    console.error("[cron match-daily] error", e);
    return res.status(500).json({ ok: false });
  }
});

export default router;