// src/routes/cron.ts
import { Router } from "express";
import { pool } from "../db";

// 翌日分の slot を全部処理するバッチ
import executeMatchCron from "../cron/matchCron";

// slotDt を指定して 1 件だけ手動で処理する
import { runMatchingForSlot } from "../services/matching/run";

const router = Router();

/**
 * POST /cron/matching
 * - Vercel Cron が叩くエンドポイント
 * - 翌日分の slot をまとめてマッチング
 */
router.post("/matching", async (req, res) => {
  const secret = process.env.CRON_SECRET;
  const auth = req.header("authorization") || "";

  if (!secret || auth !== `Bearer ${secret}`) {
    console.warn("[cron/matching] unauthorized");
    return res.status(401).send("Unauthorized");
  }

  try {
    const result = await executeMatchCron(pool);
    return res.json(result);
  } catch (e: any) {
    console.error("[cron/matching] error", e);
    return res.status(500).json({ error: e?.message || "server_error" });
  }
});

/**
 * POST /cron/matching/manual
 * - slotDt を指定して「単発でマッチング」を実行する API
 * - テスト用途
 */
router.post("/matching/manual", async (req, res) => {
  const secret = process.env.CRON_SECRET;
  const auth = req.header("authorization") || "";

  if (!secret || auth !== `Bearer ${secret}`) {
    console.warn("[cron/manual] unauthorized");
    return res.status(401).send("Unauthorized");
  }

  const slotDt: string | undefined = req.body.slotDt;
  if (!slotDt) {
    return res.status(400).json({ error: "slotDt required" });
  }

  try {
    const result = await runMatchingForSlot(pool, slotDt);

    return res.json({
      ok: true,
      ...result,     // {slot, matchedGroups, unmatched, detail}
    });
  } catch (e: any) {
    console.error("[cron/manual] error:", e);
    return res.status(500).json({ error: e?.message });
  }
});

export default router;