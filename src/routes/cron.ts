// src/routes/cron.ts
import { Router } from 'express';
import { Pool } from 'pg';
import { runMatchingForSlot } from '../services/matching/matching';

const router = Router();

/**
 * /cron/matching
 * - Vercel Cron から叩かれる
 */
router.post('/matching', async (req, res) => {
  // ① CRON_SECRET 認証
  const secret = process.env.CRON_SECRET;
  const auth = req.header('authorization') || '';

  if (!secret || auth !== `Bearer ${secret}`) {
    console.warn('[cron/matching] unauthorized request');
    return res.status(401).send('Unauthorized');
  }

  const db = req.app.locals.db as Pool;
  if (!db) return res.status(500).json({ error: 'db_not_initialized' });

  try {
    // ② 翌日の日付を JST ベースで計算
    const nowJst = new Date(Date.now() + 9 * 3600 * 1000);
    const tomorrow = new Date(
      nowJst.getFullYear(),
      nowJst.getMonth(),
      nowJst.getDate() + 1
    );

    const yyyy = tomorrow.getFullYear();
    const mm = String(tomorrow.getMonth() + 1).padStart(2, '0');
    const dd = String(tomorrow.getDate()).padStart(2, '0');
    const dateKey = `${yyyy}-${mm}-${dd}`; // "2025-11-14"

    // ③ 翌日分 slot_dt を全部取得
    const slotSql = `
      SELECT DISTINCT slot_dt
      FROM user_setup_slots
      WHERE slot_dt >= $1::date
        AND slot_dt <  ($1::date + INTERVAL '1 day')
      ORDER BY slot_dt
    `;
    const slotRes = await db.query(slotSql, [dateKey]);
    const slotList: string[] = slotRes.rows.map(r => r.slot_dt);

    if (slotList.length === 0) {
      return res.json({
        ok: true,
        message: `no slots for ${dateKey}`,
        date: dateKey,
      });
    }

    const results = [];
    for (const slot of slotList) {
      const r = await runMatchingForSlot({ db, slotDt: slot });
      results.push(r);
    }

    return res.json({
      ok: true,
      date: dateKey,
      slotCount: slotList.length,
      results,
    });
  } catch (e: any) {
    console.error('[cron/matching]', e);
    return res.status(500).json({ error: e?.message || 'server_error' });
  }
});

export default router;