// src/routes/cron.ts
import { Router } from "express";
import { pool } from "../db";
import executeMatchCron from "../cron/matchCron";

const router = Router();

/**
 * POST /cron/matching
 *  - Vercel Cron から叩かれる
 */
router.post("/matching", async (req, res) => {
  // ① CRON_SECRET 認証
  const secret = process.env.CRON_SECRET;
  const auth = req.header("authorization") || "";

  if (!secret || auth !== `Bearer ${secret}`) {
    console.warn("[cron/matching] unauthorized");
    return res.status(401).send("Unauthorized");
  }

  try {
    // ② バッチ実行
    const result = await executeMatchCron(pool);
    return res.json(result);
  } catch (e: any) {
    console.error("[cron/matching] error", e);
    return res.status(500).json({ error: e?.message || "server_error" });
  }
});

export default router;