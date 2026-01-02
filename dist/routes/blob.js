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
/** ===== multer (memory) ===== */
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
/**
 * POST /api/blob/profile-photo
 * - A設計（確定プロフィールがある場合のみアップロード可）
 */
router.post('/profile-photo', upload.single('file'), async (req, res) => {
    try {
        const userIdRaw = req.userId;
        const userId = Number(userIdRaw);
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
 * POST /api/blob/draft-photo
 * - draftフロー用：確定プロフィールが無くてもOK
 * - user_profile_drafts に photo_tmp_url / photo_tmp_pathname を保存
 * - multipart/form-data field name: "file"
 */
router.post('/draft-photo', upload.single('file'), async (req, res) => {
    try {
        const userIdRaw = req.userId;
        const userId = Number(userIdRaw);
        if (!userId || !Number.isFinite(userId))
            return res.status(401).json({ error: 'unauthorized' });
        const db = db_1.pool;
        const f = req.file;
        if (!f)
            return res.status(400).json({ error: 'file_required' });
        const ext = extFromMime(f.mimetype);
        if (!ext)
            return res.status(400).json({ error: 'invalid_file_type' });
        // ✅ draft用の一時領域
        const key = `profile-drafts/${userId}/${Date.now()}-${rand(12)}.${ext}`;
        const uploaded = await (0, blob_1.put)(key, f.buffer, {
            access: 'public',
            contentType: f.mimetype,
            addRandomSuffix: false,
        });
        // ✅ draftが無ければ作って紐づける
        await db.query(`
      INSERT INTO user_profile_drafts (user_id, draft, photo_tmp_url, photo_tmp_pathname, created_at, updated_at)
      VALUES ($1, '{}'::jsonb, $2, $3, now(), now())
      ON CONFLICT (user_id) DO UPDATE SET
        photo_tmp_url = EXCLUDED.photo_tmp_url,
        photo_tmp_pathname = EXCLUDED.photo_tmp_pathname,
        updated_at = now()
      `, [userId, uploaded.url, uploaded.pathname]);
        return res.json({ ok: true, url: uploaded.url, pathname: uploaded.pathname });
    }
    catch (e) {
        console.error('[blob/draft-photo]', e);
        return res.status(500).json({ error: e?.message || 'server_error' });
    }
});
/**
 * POST /api/blob/draft-photo/delete
 * body: { pathname: string }
 * - tmp写真を削除（離脱/キャンセル用）
 */
router.post('/draft-photo/delete', async (req, res) => {
    try {
        const userIdRaw = req.userId;
        const userId = Number(userIdRaw);
        if (!userId || !Number.isFinite(userId))
            return res.status(401).json({ error: 'unauthorized' });
        const pathname = req.body?.pathname;
        if (!pathname || typeof pathname !== 'string')
            return res.status(400).json({ error: 'pathname_required' });
        // ✅ Vercel Blob は pathname を渡せば削除できる
        await (0, blob_1.del)(pathname);
        // ✅ DB側も消す（同一ユーザーのみ）
        const db = db_1.pool;
        await db.query(`
      UPDATE user_profile_drafts
      SET photo_tmp_url = NULL,
          photo_tmp_pathname = NULL,
          updated_at = now()
      WHERE user_id = $1 AND photo_tmp_pathname = $2
      `, [userId, pathname]);
        return res.json({ ok: true, deleted: true });
    }
    catch (e) {
        console.error('[blob/draft-photo/delete]', e);
        return res.status(500).json({ error: e?.message || 'server_error' });
    }
});
exports.default = router;
