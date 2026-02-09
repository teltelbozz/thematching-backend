// src/routes/cronLineDispatch.ts
import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { pool } from "../db";
import { dispatchLineNotifications } from "../services/notifications/dispatchLineNotifications";

const router = Router();

function requireCronSecret(req: Request, res: Response, next: NextFunction) {
  const secret = process.env.CRON_SECRET;
  const auth = req.header("authorization") || "";
  if (!secret || auth !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}

router.post("/line/dispatch", requireCronSecret, async (_req: Request, res: Response) => {
  try {
    const result = await dispatchLineNotifications(pool, { limit: 50 });
    return res.json(result);
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "server_error" });
  }
});

export default router;
