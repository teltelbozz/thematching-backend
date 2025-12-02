"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/routes/cron.ts
const express_1 = require("express");
const db_1 = require("../db");
const matchCron_1 = __importDefault(require("../cron/matchCron"));
const router = (0, express_1.Router)();
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
        const result = await (0, matchCron_1.default)(db_1.pool);
        return res.json(result);
    }
    catch (e) {
        console.error("[cron/matching] error", e);
        return res.status(500).json({ error: e?.message || "server_error" });
    }
});
exports.default = router;
