"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const router = (0, express_1.Router)();
// 超簡易：admin secret（環境変数）でガード
function requireAdmin(req, res, next) {
    const secret = process.env.ADMIN_SECRET;
    const auth = String(req.headers.authorization || "");
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!secret || token !== secret) {
        return res.status(401).json({ ok: false, error: "unauthorized" });
    }
    next();
}
/**
 * PATCH /api/admin/groups/:groupId/announcement
 * body: { venue_name, venue_address, venue_map_url, fee_text, notes }
 */
router.patch("/groups/:groupId/announcement", requireAdmin, async (req, res) => {
    const db = req.app.locals.db;
    const groupId = Number(req.params.groupId);
    if (!Number.isFinite(groupId)) {
        return res.status(400).json({ ok: false, error: "invalid_group_id" });
    }
    const { venue_name = null, venue_address = null, venue_map_url = null, fee_text = null, notes = null, } = req.body || {};
    try {
        const r = await db.query(`
      UPDATE matched_groups
      SET
        venue_name = $2,
        venue_address = $3,
        venue_map_url = $4,
        fee_text = $5,
        notes = $6
      WHERE id = $1
      RETURNING
        id, token, slot_dt, location, type_mode, status,
        venue_name, venue_address, venue_map_url, fee_text, notes
      `, [groupId, venue_name, venue_address, venue_map_url, fee_text, notes]);
        const row = r.rows[0];
        if (!row)
            return res.status(404).json({ ok: false, error: "group_not_found" });
        return res.json({ ok: true, group: row });
    }
    catch (e) {
        console.error("[PATCH /admin/groups/:id/announcement] error", e);
        return res.status(500).json({ ok: false, error: "server_error" });
    }
});
/**
 * GET /api/admin/groups/recent?limit=50
 * 管理画面で group_id を選ぶための一覧
 */
router.get("/groups/recent", requireAdmin, async (req, res) => {
    const db = req.app.locals.db;
    const limit = Math.min(Number(req.query.limit || 50), 200);
    try {
        const r = await db.query(`
      SELECT
        id, token, slot_dt, location, type_mode, status,
        venue_name, fee_text
      FROM matched_groups
      ORDER BY id DESC
      LIMIT $1
      `, [limit]);
        return res.json({ ok: true, groups: r.rows });
    }
    catch (e) {
        console.error("[GET /admin/groups/recent] error", e);
        return res.status(500).json({ ok: false, error: "server_error" });
    }
});
exports.default = router;
