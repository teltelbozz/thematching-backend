
import type { Pool } from 'pg';

export async function upsertUserByLineId(db: Pool, lineUserId: string) {
  const sql = `
    WITH ins AS (
      INSERT INTO users (line_user_id, email)
      VALUES ($1, NULL)
      ON CONFLICT (line_user_id) DO NOTHING
      RETURNING id
    )
    SELECT id FROM ins
    UNION ALL
    SELECT id FROM users WHERE line_user_id = $1
    LIMIT 1
  `;
  const r = await db.query(sql, [lineUserId]);
  return Number(r.rows[0]?.id);
}

export async function upsertProfile(db: Pool, userId: number, nickname: string | null, photo: string | null) {
  const sql = `
    INSERT INTO user_profiles (user_id, nickname, photo_url)
    VALUES ($1, $2, $3)
    ON CONFLICT (user_id) DO UPDATE
      SET nickname = COALESCE(EXCLUDED.nickname, user_profiles.nickname),
          photo_url = COALESCE(EXCLUDED.photo_url, user_profiles.photo_url),
          updated_at = NOW()
    RETURNING user_id, nickname, photo_url
  `;
  const p = await db.query(sql, [userId, nickname, photo]);
  return p.rows[0];
}

export async function getUserWithProfile(db: Pool, userId: number) {
  const sql = `
    SELECT u.id, u.line_user_id,
           p.nickname, p.age, p.gender, p.occupation, p.photo_url, p.photo_masked_url, p.verified_age
    FROM users u
    LEFT JOIN user_profiles p ON p.user_id = u.id
    WHERE u.id = $1
  `;
  const r = await db.query(sql, [userId]);
  return r.rows[0] || null;
}
