// src/routes/adminGroups.ts
import { Router } from "express";
import type { Pool } from "pg";
import config from "../config";

const router = Router();

/**
 * Admin 認証（matching-demo.html の Admin Token と同じ想定）
 * 既存の /admin /cron と同じ token で守りたいので、最低限ここでチェックします。
 */
function requireAdminToken(req: any, res: any, next: any) {
  const auth = String(req.headers.authorization || "");
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";

  // ✅ 既存実装が参照している env 名に合わせて候補を広く取る
  // （本当は「既存のミドルウェアをimportして使う」のがベスト）
  const expected =
    (config as any).cronToken ||
    (config as any).adminToken ||
    (config as any).CRON_TOKEN ||
    (config as any).ADMIN_TOKEN ||
    process.env.CRON_TOKEN ||
    process.env.ADMIN_TOKEN ||
    process.env.ADMIN_API_TOKEN ||         // ← ありがち
    process.env.CRON_SECRET ||             // ← ありがち
    process.env.THEMATCHING_CRON_TOKEN ||  // ← ありがち
    process.env.THEMATCHING_ADMIN_TOKEN;   // ← ありがち

  if (!expected) {
    // 設定が無いなら事故るので 500
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
 *
 * ✅ 仕様：
 * - フィールド未指定 → 現状維持
 * - フィールドを null 指定 → 消す（NULLにする）
 */
router.patch("/groups/:groupId/ops-message", requireAdminToken, async (req, res) => {
  const db = req.app.locals.db as Pool;

  const groupId = Number(req.params.groupId);
  if (!Number.isFinite(groupId) || groupId <= 0) {
    return res.status(400).json({ error: "invalid_group_id" });
  }

  const body = req.body ?? {};

  const hasVenueName = Object.prototype.hasOwnProperty.call(body, "venue_name");
  const hasVenueAddress = Object.prototype.hasOwnProperty.call(body, "venue_address");
  const hasVenueMapUrl = Object.prototype.hasOwnProperty.call(body, "venue_map_url");
  const hasFeeText = Object.prototype.hasOwnProperty.call(body, "fee_text");
  const hasNotes = Object.prototype.hasOwnProperty.call(body, "notes");

  if (!hasVenueName && !hasVenueAddress && !hasVenueMapUrl && !hasFeeText && !hasNotes) {
    return res.status(400).json({ error: "no_fields" });
  }

  // 値：未指定は何でもOK（使わない）。指定された場合はその値（null含む）を使う。
  const venue_name = hasVenueName ? body.venue_name : null;
  const venue_address = hasVenueAddress ? body.venue_address : null;
  const venue_map_url = hasVenueMapUrl ? body.venue_map_url : null;
  const fee_text = hasFeeText ? body.fee_text : null;
  const notes = hasNotes ? body.notes : null;

  try {
    const r = await db.query(
      `
      UPDATE matched_groups
      SET
        venue_name    = CASE WHEN $2::boolean THEN $3 ELSE venue_name END,
        venue_address = CASE WHEN $4::boolean THEN $5 ELSE venue_address END,
        venue_map_url = CASE WHEN $6::boolean THEN $7 ELSE venue_map_url END,
        fee_text      = CASE WHEN $8::boolean THEN $9 ELSE fee_text END,
        notes         = CASE WHEN $10::boolean THEN $11 ELSE notes END
      WHERE id = $1
      RETURNING
        id, token, slot_dt, location, type_mode, status,
        venue_name, venue_address, venue_map_url, fee_text, notes
      `,
      [
        groupId,

        hasVenueName, venue_name,
        hasVenueAddress, venue_address,
        hasVenueMapUrl, venue_map_url,
        hasFeeText, fee_text,
        hasNotes, notes,
      ]
    );

    const row = r.rows[0];
    if (!row) return res.status(404).json({ error: "group_not_found" });

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
  } catch (e) {
    console.error("[PATCH /admin/groups/:groupId/ops-message] error", e);
    return res.status(500).json({ error: "server_error" });
  }
});

export default router;