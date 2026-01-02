"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/routes/blob.ts
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const blob_1 = require("@vercel/blob");
const db_1 = require("../db");
const router = (0, express_1.Router)();
// ===== multer (memory) =====
const upload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});
function rand(n = 10) {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let s = "";
    for (let i = 0; i < n; i++)
        s += chars[Math.floor(Math.random() * chars.length)];
    return s;
}
function extFromMime(mime) {
    const m = (mime || "").toLowerCase();
    if (m === "image/jpeg" || m === "image/jpg")
        return "jpg";
    if (m === "image/png")
        return "png";
    if (m === "image/webp")
        return "webp";
    return null;
}
async function ensureProfileExists(db, userId) {
    const r = await db.query(`SELECT 1 FROM user_profiles WHERE user_id = $1 LIMIT 1`, [userId]);
    return (r.rowCount ?? 0) > 0;
}
/**
 * 既存(A設計)：
 * POST /api/blob/profile-photo
 * - user_profiles が存在する人だけアップロード許可（孤児Blob防止）
 * - 成功すると user_profiles.photo_url を更新
 */
router.post("/profile-photo", upload.single("file"), async (req, res) => {
    try {
        const userIdRaw = req.userId;
        const userId = Number(userIdRaw);
        if (!userId || !Number.isFinite(userId))
            return res.status(401).json({ error: "unauthorized" });
        const db = db_1.pool;
        const okProfile = await ensureProfileExists(db, userId);
        if (!okProfile)
            return res.status(412).json({ error: "profile_required" });
        const f = req.file;
        if (!f)
            return res.status(400).json({ error: "file_required" });
        const ext = extFromMime(f.mimetype);
        if (!ext)
            return res.status(400).json({ error: "invalid_file_type" });
        const key = `profile-photos/${userId}/${Date.now()}-${rand(12)}.${ext}`;
        const uploaded = await (0, blob_1.put)(key, f.buffer, {
            access: "public",
            contentType: f.mimetype,
            addRandomSuffix: false,
        });
        await db.query(`
      UPDATE user_profiles
      SET photo_url = $2,
          updated_at = NOW()
      WHERE user_id = $1
      `, [userId, uploaded.url]);
        return res.json({ ok: true, url: uploaded.url, pathname: uploaded.pathname });
    }
    catch (e) {
        console.error("[blob/profile-photo]", e);
        return res.status(500).json({ error: e?.message || "server_error" });
    }
});
/**
 * 新UX(draft用)：
 * POST /api/blob/profile-photo-draft
 * - profile_drafts に draft_photo_url / draft_photo_pathname を保存
 * - user_profiles が無くてもOK（仮保存中だから）
 * - 既に draft に写真があれば、古いBlobは削除して差し替え（孤児防止）
 */
router.post("/profile-photo-draft", upload.single("file"), async (req, res) => {
    const userIdRaw = req.userId;
    const userId = Number(userIdRaw);
    if (!userId || !Number.isFinite(userId))
        return res.status(401).json({ error: "unauthorized" });
    const db = db_1.pool;
    try {
        const f = req.file;
        if (!f)
            return res.status(400).json({ error: "file_required" });
        const ext = extFromMime(f.mimetype);
        if (!ext)
            return res.status(400).json({ error: "invalid_file_type" });
        // 既存draft写真があれば消してから差し替え（孤児防止）
        const prev = await db.query(`SELECT draft_photo_pathname FROM profile_drafts WHERE user_id = $1`, [userId]);
        const prevPath = prev.rows[0]?.draft_photo_pathname ?? null;
        if (prevPath) {
            try {
                await (0, blob_1.del)(prevPath);
            }
            catch (e) {
                console.warn("[blob/profile-photo-draft] delete prev failed (ignore):", e);
            }
        }
        const key = `draft-profile-photos/${userId}/${Date.now()}-${rand(12)}.${ext}`;
        const uploaded = await (0, blob_1.put)(key, f.buffer, {
            access: "public",
            contentType: f.mimetype,
            addRandomSuffix: false,
        });
        // draft 行が無ければ作る（仮保存前に写真を上げても成立する）
        await db.query(`
      INSERT INTO profile_drafts (
        user_id, created_at, updated_at,
        draft_photo_url, draft_photo_pathname
      ) VALUES ($1, now(), now(), $2, $3)
      ON CONFLICT (user_id) DO UPDATE SET
        draft_photo_url = EXCLUDED.draft_photo_url,
        draft_photo_pathname = EXCLUDED.draft_photo_pathname,
        updated_at = now()
      `, [userId, uploaded.url, uploaded.pathname]);
        return res.json({ ok: true, url: uploaded.url, pathname: uploaded.pathname });
    }
    catch (e) {
        console.error("[blob/profile-photo-draft]", e);
        return res.status(500).json({ error: e?.message || "server_error" });
    }
});
/**
 * （任意）draftの写真を明示的に削除したい場合：
 * POST /api/blob/profile-photo-draft/delete
 * - DBに残っている pathname を見て削除 → DBもクリア
 */
router.post("/profile-photo-draft/delete", async (req, res) => {
    const userIdRaw = req.userId;
    const userId = Number(userIdRaw);
    if (!userId || !Number.isFinite(userId))
        return res.status(401).json({ error: "unauthorized" });
    const db = db_1.pool;
    try {
        const r = await db.query(`SELECT draft_photo_pathname FROM profile_drafts WHERE user_id = $1`, [userId]);
        const pathname = r.rows[0]?.draft_photo_pathname ?? null;
        if (pathname) {
            try {
                await (0, blob_1.del)(pathname);
            }
            catch (e) {
                console.warn("[blob/profile-photo-draft/delete] del failed (ignore):", e);
            }
        }
        await db.query(`
      UPDATE profile_drafts
      SET draft_photo_url = NULL,
          draft_photo_pathname = NULL,
          updated_at = now()
      WHERE user_id = $1
      `, [userId]);
        return res.json({ ok: true, deleted: true });
    }
    catch (e) {
        console.error("[blob/profile-photo-draft/delete]", e);
        return res.status(500).json({ error: e?.message || "server_error" });
    }
});
exports.default = router;
