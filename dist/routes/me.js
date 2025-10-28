"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// src/routes/me.ts
const express_1 = require("express");
const tokenService_1 = require("../auth/tokenService");
const router = (0, express_1.Router)();
/**
 * /api/me
 * 現在ログイン中のユーザー情報を返す。
 * - userId: DB上のユーザーID
 * - hasProfile: user_profilesに登録があるかどうか
 */
router.get('/', async (req, res) => {
    try {
        const token = (0, tokenService_1.readBearer)(req);
        if (!token)
            return res.status(401).json({ error: 'unauthenticated' });
        const verified = await (0, tokenService_1.verifyAccess)(token);
        const claims = verified?.payload ?? verified;
        const uid = claims?.uid;
        if (!uid)
            return res.status(401).json({ error: 'unauthenticated' });
        const db = req.app.locals.db;
        if (!db) {
            console.error('[me:get] db_not_initialized');
            return res.status(500).json({ error: 'server_error' });
        }
        // ユーザー存在チェック
        const userRes = await db.query('SELECT id FROM users WHERE id = $1 OR line_user_id = $2 LIMIT 1', [uid, uid]);
        const userId = userRes.rows[0]?.id;
        if (!userId)
            return res.status(401).json({ error: 'unauthenticated' });
        // プロフィール存在チェック
        const profileRes = await db.query(`SELECT 1 FROM user_profiles WHERE user_id = $1 LIMIT 1`, [userId]);
        // ✅ 行が存在すれば hasProfile = true
        const hasProfile = profileRes.rows.length > 0;
        return res.json({ userId, hasProfile });
    }
    catch (e) {
        console.error('[me:get]', e?.message || e);
        return res.status(500).json({ error: 'server_error' });
    }
});
exports.default = router;
