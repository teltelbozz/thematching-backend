"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// src/routes/diag.ts（仮）
const express_1 = require("express");
const r = (0, express_1.Router)();
r.get('/diag/jose', async (_req, res) => {
    try {
        // ここで jose を動的 import（CJS でも安全）
        await eval('import("jose")');
        res.json({ ok: true, jose: 'loaded' });
    }
    catch (e) {
        res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
});
exports.default = r;
