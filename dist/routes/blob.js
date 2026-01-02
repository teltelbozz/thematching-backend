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
 * POST /api/blob/profile-photo
 * - 既存互換（確定プロフィールがある人向け）
 * - field: file
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
 * POST /api/blob/profile-photo-draft
 * - 新フロー（draftがある人向け）
 * - field: file
 * - profile_drafts に draft_photo_url/pathname を保存
 * - 既に draft_photo_pathname があるなら古いblobを削除（孤児防止）
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
        // 既存draft写真があれば先に取得（差し替えの孤児防止）
        const prev = await db.query(`SELECT draft_photo_pathname FROM profile_drafts WHERE user_id = $1`, [userId]);
        const prevPathname = prev.rows[0]?.draft_photo_pathname ?? null;
        const key = `draft-profile-photos/${userId}/${Date.now()}-${rand(12)}.${ext}`;
        const uploaded = await (0, blob_1.put)(key, f.buffer, {
            access: 'public',
            contentType: f.mimetype,
            addRandomSuffix: false,
        });
        await db.query(`
      UPDATE profile_drafts
      SET draft_photo_url = $2,
          draft_photo_pathname = $3,
          updated_at = NOW()
      WHERE user_id = $1
      `, [userId, uploaded.url, uploaded.pathname]);
        // 古いblobを削除（失敗してもアップロード自体は成功扱い）
        if (prevPathname && prevPathname !== uploaded.pathname) {
            (0, blob_1.del)(prevPathname).catch((e) => console.warn('[blob/draft] delete prev failed', e));
        }
        return res.json({ ok: true, url: uploaded.url, pathname: uploaded.pathname });
    }
    catch (e) {
        console.error('[blob/profile-photo-draft]', e);
        return res.status(500).json({ error: e?.message || 'server_error' });
    }
});
/**
 * POST /api/blob/draft-photo/delete
 * - cancel時などに、pathnameを渡してblob削除（任意）
 * body: { pathname: string }
 */
router.post('/draft-photo/delete', async (req, res) => {
    try {
        const userId = Number(req.userId);
        if (!userId || !Number.isFinite(userId))
            return res.status(401).json({ error: 'unauthorized' });
        const pathname = String(req.body?.pathname ?? '');
        if (!pathname)
            return res.status(400).json({ error: 'pathname_required' });
        await (0, blob_1.del)(pathname);
        return res.json({ ok: true, deleted: true });
    }
    catch (e) {
        console.error('[blob/draft-photo/delete]', e);
        return res.status(500).json({ error: e?.message || 'server_error' });
    }
});
exports.default = router;
