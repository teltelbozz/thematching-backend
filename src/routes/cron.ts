// src/routes/cron.ts
import { Router } from "express";
import type { Request, Response } from "express";
import { pool } from "../db";
import executeMatchCron from "../cron/matchCron";
import { runMatchingForSlot } from "../services/matching/run";

const router = Router();

async function handleMatching(req: Request, res: Response) {
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
}

router.post("/matching", handleMatching);

router.post("/matching/manual", async (req: Request, res: Response) => {
  const secret = process.env.CRON_SECRET;
  const auth = req.header("authorization") || "";

  if (!secret || auth !== `Bearer ${secret}`) {
    console.warn("[cron/manual] unauthorized");
    return res.status(401).send("Unauthorized");
  }

  const slotDt: string | undefined = req.body?.slotDt;
  if (!slotDt) return res.status(400).json({ error: "slotDt required" });

  try {
    const result = await runMatchingForSlot(pool, slotDt);
    return res.json({ ok: true, ...result });
  } catch (e: any) {
    console.error("[cron/manual] error:", e);
    return res.status(500).json({ error: e?.message || "server_error" });
  }
});

export default router;