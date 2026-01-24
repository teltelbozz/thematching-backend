"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/routes/adminGroups.ts
const express_1 = require("express");
const config_1 = __importDefault(require("../config")); // 既存にある前提（app.tsで使ってるので）
const router = (0, express_1.Router)();
/**
 * Admin 認証（matching-demo.html の Admin Token と同じ想定）
 * 既存の admin/cron と同じ token で守りたいので、最低限ここでチェックします。
 */
function requireAdminToken(req, res, next) {
    const auth = String(req.headers.authorization || "");
    const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
    // config 側の名前が環境で違う可能性があるので、よくある候補を順に拾う
    const expected = config_1.default.cronToken ||
        config_1.default.adminToken ||
        process.env.CRON_TOKEN ||
        process.env.ADMIN_TOKEN;
    if (!expected) {
        // 設定が無いなら事故るので 500（ここは好みで 401 でもOK）
        return res.status(500).json({ error: "admin_token_not_configured" });
    }
    if (!token || token !== expected) {
        return res.status(401).json({ error: "unauthorized" });
    }
    next();
}
/**
 * PATCH /admin/groups/:groupId/ops-message
 * - matched_groups の運営メッセージを更新
 * - 完全共有型のグループページが参照するデータ源
 */
router.patch("/groups/:groupId/ops-message", requireAdminToken, async (req, res) => {
    const db = req.app.locals.db;
    const groupId = Number(req.params.groupId);
    if (!Number.isFinite(groupId) || groupId <= 0) {
        return res.status(400).json({ error: "invalid_group_id" });
    }
    const body = req.body ?? {};
    // null で消せる運用にする（未指定は更新しない）
    const venue_name = Object.prototype.hasOwnProperty.call(body, "venue_name") ? body.venue_name : undefined;
    const venue_address = Object.prototype.hasOwnProperty.call(body, "venue_address") ? body.venue_address : undefined;
    const venue_map_url = Object.prototype.hasOwnProperty.call(body, "venue_map_url") ? body.venue_map_url : undefined;
    const fee_text = Object.prototype.hasOwnProperty.call(body, "fee_text") ? body.fee_text : undefined;
    const notes = Object.prototype.hasOwnProperty.call(body, "notes") ? body.notes : undefined;
    // 何も来てない場合
    if (venue_name === undefined &&
        venue_address === undefined &&
        venue_map_url === undefined &&
        fee_text === undefined &&
        notes === undefined) {
        return res.status(400).json({ error: "no_fields" });
    }
    // 部分更新：COALESCEで「未指定は現状維持」、指定されたら更新（null指定も通す）
    try {
        const r = await db.query(`
      UPDATE matched_groups
      SET
        venue_name    = COALESCE($2, venue_name),
        venue_address = COALESCE($3, venue_address),
        venue_map_url = COALESCE($4, venue_map_url),
        fee_text      = COALESCE($5, fee_text),
        notes         = COALESCE($6, notes)
      WHERE id = $1
      RETURNING
        id, token, slot_dt, location, type_mode, status,
        venue_name, venue_address, venue_map_url, fee_text, notes
      `, [
            groupId,
            venue_name === undefined ? null : venue_name,
            venue_address === undefined ? null : venue_address,
            venue_map_url === undefined ? null : venue_map_url,
            fee_text === undefined ? null : fee_text,
            notes === undefined ? null : notes,
        ]);
        const row = r.rows[0];
        if (!row)
            return res.status(404).json({ error: "group_not_found" });
        return res.json({
            ok: true,
            group: {
                id: Number(row.id),
                token: row.token,
                status: row.status,
                slot_dt: row.slot_dt,
                location: row.location,
                type_mode: row.type_mode,
                venue_name: row.venue_name ?? null,
                venue_address: row.venue_address ?? null,
                venue_map_url: row.venue_map_url ?? null,
                fee_text: row.fee_text ?? null,
                notes: row.notes ?? null,
            },
        });
    }
    catch (e) {
        console.error("[PATCH /admin/groups/:id/ops-message] error", e);
        return res.status(500).json({ error: "server_error" });
    }
});
exports.default = router;
