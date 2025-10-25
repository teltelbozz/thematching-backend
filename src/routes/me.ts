// src/routes/me.ts
import { Router } from 'express';
import type { Pool } from 'pg';
import { readBearer, verifyAccess } from '../auth/tokenService';

const router = Router();

/**
 * /api/me
 * 現在ログイン中のユーザー情報を返す。
 * - userId: DB上のユーザーID
 * - hasProfile: user_profilesに登録があるかどうか
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

    // ユーザー存在チェック
    const userRes = await db.query(
      'SELECT id FROM users WHERE id = $1 OR line_user_id = $2 LIMIT 1',
      [uid, uid],
    );
    const userId = userRes.rows[0]?.id;
    if (!userId) return res.status(401).json({ error: 'unauthenticated' });

    // プロフィール存在チェック
    const profileRes = await db.query(
      `SELECT nickname, age, gender, occupation
         FROM user_profiles WHERE user_id = $1`,
      [userId],
    );

    const profile = profileRes.rows[0];
    const hasProfile =
      !!profile &&
      !!profile.nickname &&
      !!profile.age &&
      !!profile.gender &&
      !!profile.occupation;

    return res.json({ userId, hasProfile });
  } catch (e: any) {
    console.error('[me:get]', e?.message || e);
    return res.status(500).json({ error: 'server_error' });
  }
});

export default router;