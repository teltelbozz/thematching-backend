import { Router } from 'express';
import type { Pool } from 'pg';
import { readBearer, verifyAccess } from '../auth/tokenService';

const router = Router();

function normUid(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/**
 * GET /api/setup
 * 直近に保存した合コン設定を取得（なければ null）
 */
router.get('/', async (req, res) => {
  try {
    const token = readBearer(req);
    if (!token) return res.status(401).json({ error: 'unauthenticated' });
    const { payload } = await verifyAccess(token);
    const uid = normUid((payload as any).uid);
    if (uid == null) return res.status(401).json({ error: 'unauthenticated' });

    const db = req.app.locals.db as Pool;
    const r = await db.query(
      `SELECT user_id, participation_style, party_size, desired_date,
              type_mode, venue_pref, cost_pref
         FROM user_match_setup
        WHERE user_id = $1`,
      [uid]
    );
    return res.json({ setup: r.rows[0] ?? null });
  } catch (e: any) {
    console.error('[setup:get]', e?.message || e);
    return res.status(500).json({ error: 'server_error' });
  }
});

/**
 * PUT /api/setup
 * 合コン設定を保存（上書き・UPSERT）
 * Body:
 * {
 *  "participation_style": "solo" | "with_friend",
 *  "party_size": 2,
 *  "desired_date": "2025-10-10",
 *  "type_mode": "talk" | "play" | "either",
 *  "venue_pref": "cheap_izakaya" | "fancy_dining" | "bar_cafe",
 *  "cost_pref": "men_pay_all" | "split_even" | "follow_partner"
 * }
 */
router.put('/', async (req, res) => {
  try {
    const token = readBearer(req);
    if (!token) return res.status(401).json({ error: 'unauthenticated' });
    const { payload } = await verifyAccess(token);
    const uid = normUid((payload as any).uid);
    if (uid == null) return res.status(401).json({ error: 'unauthenticated' });

    const {
      participation_style,
      party_size,
      desired_date,  // "YYYY-MM-DD"
      type_mode,
      venue_pref,
      cost_pref,
    } = req.body || {};

    // ざっくりバリデーション（必要に応じて強化）
    if (participation_style && !['solo', 'with_friend'].includes(participation_style))
      return res.status(400).json({ error: 'invalid_participation_style' });

    if (party_size != null && !(Number.isInteger(party_size) && party_size >= 1 && party_size <= 4))
      return res.status(400).json({ error: 'invalid_party_size' });

    if (desired_date && typeof desired_date !== 'string')
      return res.status(400).json({ error: 'invalid_desired_date' });

    if (type_mode && !['talk', 'play', 'either'].includes(type_mode))
      return res.status(400).json({ error: 'invalid_type_mode' });

    if (venue_pref && !['cheap_izakaya', 'fancy_dining', 'bar_cafe'].includes(venue_pref))
      return res.status(400).json({ error: 'invalid_venue_pref' });

    if (cost_pref && !['men_pay_all', 'split_even', 'follow_partner'].includes(cost_pref))
      return res.status(400).json({ error: 'invalid_cost_pref' });

    const db = req.app.locals.db as Pool;

    await db.query(
      `INSERT INTO user_match_setup (
          user_id, participation_style, party_size, desired_date,
          type_mode, venue_pref, cost_pref
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (user_id) DO UPDATE SET
          participation_style = COALESCE(EXCLUDED.participation_style, user_match_setup.participation_style),
          party_size          = COALESCE(EXCLUDED.party_size,          user_match_setup.party_size),
          desired_date        = COALESCE(EXCLUDED.desired_date,        user_match_setup.desired_date),
          type_mode           = COALESCE(EXCLUDED.type_mode,           user_match_setup.type_mode),
          venue_pref          = COALESCE(EXCLUDED.venue_pref,          user_match_setup.venue_pref),
          cost_pref           = COALESCE(EXCLUDED.cost_pref,           user_match_setup.cost_pref),
          updated_at = NOW()`,
      [
        uid,
        participation_style ?? null,
        party_size ?? null,
        desired_date ?? null,
        type_mode ?? null,
        venue_pref ?? null,
        cost_pref ?? null,
      ]
    );

    const r = await db.query(
      `SELECT user_id, participation_style, party_size, desired_date,
              type_mode, venue_pref, cost_pref
         FROM user_match_setup
        WHERE user_id = $1`,
      [uid]
    );
    return res.json({ setup: r.rows[0] });
  } catch (e: any) {
    console.error('[setup:put]', e?.message || e);
    return res.status(500).json({ error: 'server_error' });
  }
});

export default router;