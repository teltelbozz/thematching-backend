"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// src/routes/cronLineDispatch.ts
const express_1 = require("express");
const db_1 = require("../db");
const dispatchLineNotifications_1 = require("../services/notifications/dispatchLineNotifications");
const router = (0, express_1.Router)();
function requireCronSecret(req, res, next) {
    const secret = process.env.CRON_SECRET;
    const auth = req.header("authorization") || "";
    if (!secret || auth !== `Bearer ${secret}`) {
        return res.status(401).json({ error: "unauthorized" });
    }
    next();
}
router.post("/line/dispatch", requireCronSecret, async (_req, res) => {
    try {
        const result = await (0, dispatchLineNotifications_1.dispatchLineNotifications)(db_1.pool, { limit: 50 });
        return res.json(result);
    }
    catch (e) {
        return res.status(500).json({ error: e?.message || "server_error" });
    }
});
exports.default = router;
