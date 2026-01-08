"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const r = (0, express_1.Router)();
// jose の読み込み確認
r.get('/diag/jose', async (_req, res) => {
    try {
        // TS が require に変換しないよう eval を使う
        await eval('import("jose")');
        res.json({ ok: true, jose: 'loaded' });
    }
    catch (e) {
        res.status(500).json({ ok: false, error: String(e?.message ?? e) });
    }
});
exports.default = r;
