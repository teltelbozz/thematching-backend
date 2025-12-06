"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/routes/cron.ts
const express_1 = require("express");
const db_1 = require("../db");
// 翌日分の slot を全部処理するバッチ
const matchCron_1 = __importDefault(require("../cron/matchCron"));
// slotDt を指定して 1 件だけ手動で処理する
const run_1 = require("../services/matching/run");
const router = (0, express_1.Router)();
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
        const result = await (0, matchCron_1.default)(db_1.pool);
        return res.json(result);
    }
    catch (e) {
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
    const slotDt = req.body.slotDt;
    if (!slotDt) {
        return res.status(400).json({ error: "slotDt required" });
    }
    try {
        const result = await (0, run_1.runMatchingForSlot)(db_1.pool, slotDt);
        return res.json({
            ok: true,
            ...result, // {slot, matchedGroups, unmatched, detail}
        });
    }
    catch (e) {
        console.error("[cron/manual] error:", e);
        return res.status(500).json({ error: e?.message });
    }
});
exports.default = router;
