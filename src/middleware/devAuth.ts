import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { pool } from '../db'; // pg Pool を使っている前提（既存と同じ）

const DEV_ON = process.env.DEV_FAKE_AUTH === '1';
const DEV_KEY = process.env.DEV_FAKE_AUTH_KEY || '';

export async function devAuth(req: Request, res: Response, next: NextFunction) {
  if (!DEV_ON) return next(); // 本番などOFF時は素通し

  try {
    // 誤用防止（オリジンと鍵）
    const origin = String(req.headers.origin || '');
    const allowed = process.env.FRONT_ORIGIN || '';
    if (!allowed || !origin.startsWith(allowed)) return next();
    if (DEV_KEY) {
      const clientKey = req.header('x-dev-auth-key') || '';
      if (clientKey !== DEV_KEY) return next();
    }

    // 擬似ユーザID（例: "dev:aki"）を受け取った時だけ発動
    const fakeLineUserId = req.header('x-dev-line-user-id');
    if (!fakeLineUserId) return next();

    const line_uid = String(fakeLineUserId);
    const email = `${crypto.createHash('sha1').update(line_uid).digest('hex')}@dev.local`;

    // users に upsert（line_user_id は一意の想定）
    const u = await pool.query(
      `insert into users(line_user_id, email)
       values($1, $2)
       on conflict (line_user_id) do update set email = excluded.email
       returning id, line_user_id`,
      [line_uid, email]
    );

    // 認証済みユーザとして注入（下流ルートで利用）
    (req as any).user = {
      id: u.rows[0].id,
      line_user_id: u.rows[0].line_user_id,
      is_dev: true,
    };

    res.setHeader('X-Dev-Auth', '1'); // 視覚化
    return next();
  } catch (e) {
    console.error('[devAuth] failed', e);
    return next(); // 失敗しても通常フローに影響させない
  }
}