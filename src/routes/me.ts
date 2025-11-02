// src/routes/me.ts
import { Router } from 'express';
import type { Pool } from 'pg';
import { readBearer, verifyAccess } from '../auth/tokenService';

const router = Router();

/**
 * GET /api/me
 * 現在ログイン中のユーザー情報を返す。
 * - userId: DB上のユーザーID
 * - hasProfile: プロフィール登録済みか
 * - gender: 'male' | 'female' | null
 */
router.get('/', async (req, res) => {
  try {
    const token = readBearer(req);
    if (!token) return res.status(401).json({ error: 'unauthenticated' });

    const verified = await verifyAccess(token);
    const claims = (verified as any)?.payload ?? verified;
    const uid = claims?.uid;
    if (!uid) return res.status(401).json({ error: 'unauthenticated' });

    const db = req.app.locals.db as Pool | undefined;
    if (!db) {
      console.error('[me:get] db_not_initialized');
      return res.status(500).json({ error: 'server_error' });
    }

    // users ← (uid は users.id か users.line_user_id のどちらか)
    // user_profiles を LEFT JOIN して gender と hasProfile を同時取得
    const q = `
      SELECT
        u.id AS user_id,
        (p.id IS NOT NULL) AS has_profile,
        p.gender AS gender
      FROM users u
      LEFT JOIN user_profiles p ON p.user_id = u.id
      WHERE u.id = $1 OR u.line_user_id = $2
      LIMIT 1
    `;
    const { rows } = await db.query(q, [uid, uid]);

    const row = rows[0];
    if (!row?.user_id) return res.status(401).json({ error: 'unauthenticated' });

    // gender は 'male' | 'female' | null を想定
    const gender =
      row.gender === 'male' || row.gender === 'female' ? row.gender : null;

    return res.json({
      userId: row.user_id as number,
      hasProfile: !!row.has_profile,
      gender, // ← 追加
    });
  } catch (e: any) {
    console.error('[me:get]', e?.message || e);
    return res.status(500).json({ error: 'server_error' });
  }
});

export default router;