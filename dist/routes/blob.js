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
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let s = '';
    for (let i = 0; i < n; i++)
        s += chars[Math.floor(Math.random() * chars.length)];
    return s;
}
function extFromMime(mime) {
    const m = (mime || '').toLowerCase();
    if (m === 'image/jpeg' || m === 'image/jpg')
        return 'jpg';
    if (m === 'image/png')
        return 'png';
    if (m === 'image/webp')
        return 'webp';
    return null;
}
async function ensureProfileExists(db, userId) {
    const r = await db.query(`SELECT 1 FROM user_profiles WHERE user_id = $1 LIMIT 1`, [userId]);
    return (r.rowCount ?? 0) > 0;
}
async function ensureDraftExists(db, userId) {
    const r = await db.query(`SELECT 1 FROM profile_drafts WHERE user_id = $1 LIMIT 1`, [userId]);
    return (r.rowCount ?? 0) > 0;
}
/**
 * 既存互換（A設計）
 * POST /api/blob/profile-photo
 * - multipart/form-data (field: "file")
 * - requireAuth 前提で req.userId が入っている
 * - user_profiles が存在しないと 412 profile_required
 * - user_profiles.photo_url を即更新
 */
router.post('/profile-photo', upload.single('file'), async (req, res) => {
    try {
        const userId = Number(req.userId);
        if (!userId || !Number.isFinite(userId))
            return res.status(401).json({ error: 'unauthorized' });
        const db = db_1.pool;
        const okProfile = await ensureProfileExists(db, userId);
        if (!okProfile)
            return res.status(412).json({ error: 'profile_required' });
        const f = req.file;
        if (!f)
            return res.status(400).json({ error: 'file_required' });
        const ext = extFromMime(f.mimetype);
        if (!ext)
            return res.status(400).json({ error: 'invalid_file_type' });
        const key = `profile-photos/${userId}/${Date.now()}-${rand(12)}.${ext}`;
        const uploaded = await (0, blob_1.put)(key, f.buffer, {
            access: 'public',
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
        console.error('[blob/profile-photo]', e);
        return res.status(500).json({ error: e?.message || 'server_error' });
    }
});
/**
 * 新フロー（draft）
 * POST /api/blob/profile-photo-draft
 * - multipart/form-data (field: "file")
 * - profile_drafts が存在しないと 412 draft_required
 * - profile_drafts.draft_photo_url / draft_photo_pathname を更新
 */
router.post('/profile-photo-draft', upload.single('file'), async (req, res) => {
    try {
        const userId = Number(req.userId);
        if (!userId || !Number.isFinite(userId))
            return res.status(401).json({ error: 'unauthorized' });
        const db = db_1.pool;
        const okDraft = await ensureDraftExists(db, userId);
        if (!okDraft)
            return res.status(412).json({ error: 'draft_required' });
        const f = req.file;
        if (!f)
            return res.status(400).json({ error: 'file_required' });
        const ext = extFromMime(f.mimetype);
        if (!ext)
            return res.status(400).json({ error: 'invalid_file_type' });
        const key = `profile-drafts/${userId}/${Date.now()}-${rand(12)}.${ext}`;
        const uploaded = await (0, blob_1.put)(key, f.buffer, {
            access: 'public',
            contentType: f.mimetype,
            addRandomSuffix: false,
        });
        // 既存の draft_photo があれば（任意で）上書き。削除は cancel/confirm 時にまとめて行う運用にすると安全。
        await db.query(`
      UPDATE profile_drafts
      SET draft_photo_url = $2,
          draft_photo_pathname = $3,
          updated_at = NOW()
      WHERE user_id = $1
      `, [userId, uploaded.url, uploaded.pathname]);
        return res.json({ ok: true, url: uploaded.url, pathname: uploaded.pathname });
    }
    catch (e) {
        console.error('[blob/profile-photo-draft]', e);
        return res.status(500).json({ error: e?.message || 'server_error' });
    }
});
/**
 * POST /api/blob/delete
 * body: { pathname: string }
 * - Vercel Blob の pathname を削除
 */
router.post('/delete', async (req, res) => {
    try {
        const userId = Number(req.userId);
        if (!userId || !Number.isFinite(userId))
            return res.status(401).json({ error: 'unauthorized' });
        const pathname = String(req.body?.pathname || '');
        if (!pathname)
            return res.status(400).json({ error: 'pathname_required' });
        await (0, blob_1.del)(pathname);
        return res.json({ ok: true, deleted: true });
    }
    catch (e) {
        console.error('[blob/delete]', e);
        return res.status(500).json({ error: e?.message || 'server_error' });
    }
});
exports.default = router;
