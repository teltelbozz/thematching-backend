// src/routes/terms.ts
import { Router } from 'express';
import type { Pool } from 'pg';
import { readBearer, verifyAccess } from '../auth/tokenService';

const router = Router();

function normalizeClaims(v: any): any {
  if (v && typeof v === 'object' && 'payload' in v) return (v as any).payload;
  return v;
}

function normalizeUidNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/**
 * claims.uid が:
 *  - 数値 … users.id として扱う
 *  - 文字列（LINE sub = "U..."）… users.line_user_id から id 解決（なければ発行）
 */
async function resolveUserIdFromClaims(claims: any, db: Pool): Promise<number | null> {
  const raw = claims?.uid;

  const asNum = normalizeUidNumber(raw);
  if (asNum != null) return asNum;

  if (typeof raw === 'string' && raw.trim()) {
    const sub = raw.trim();
    const r1 = await db.query<{ id: number }>(
      'SELECT id FROM users WHERE line_user_id = $1 LIMIT 1',
      [sub],
    );
    if (r1.rows[0]) return r1.rows[0].id;

    const r2 = await db.query<{ id: number }>(
      'INSERT INTO users (line_user_id) VALUES ($1) RETURNING id',
      [sub],
    );
    return r2.rows[0]?.id ?? null;
  }
  return null;
}

function getDb(req: any): Pool {
  const db = req.app?.locals?.db as Pool | undefined;
  if (!db) throw new Error('db_not_initialized');
  return db;
}

/**
 * 現在有効な規約（latest effective_at <= now）を返す
 */
async function getCurrentTerms(db: Pool) {
  const r = await db.query(
    `
    SELECT id, version, title, body_md, effective_at
    FROM terms_documents
    WHERE effective_at <= now()
    ORDER BY effective_at DESC
    LIMIT 1
    `,
  );
  return r.rows[0] ?? null;
}

/**
 * GET /api/terms/current
 */
router.get('/current', async (req, res) => {
  try {
    const db = getDb(req);
    const terms = await getCurrentTerms(db);
    if (!terms) return res.status(404).json({ error: 'no_terms' });

    return res.json({ ok: true, terms });
  } catch (e: any) {
    console.error('[terms/current]', e);
    return res.status(500).json({ error: e?.message || 'server_error' });
  }
});

/**
 * GET /api/terms/status
 * - 現在termsに同意済みか
 */
router.get('/status', async (req, res) => {
  try {
    const token = readBearer(req);
    if (!token) return res.status(401).json({ error: 'unauthenticated' });

    const verified = await verifyAccess(token);
    const claims = normalizeClaims(verified);

    const db = getDb(req);
    const userId = await resolveUserIdFromClaims(claims, db);
    if (userId == null) return res.status(401).json({ error: 'unauthenticated' });

    const terms = await getCurrentTerms(db);
    if (!terms) {
      // 規約が無いなら “同意不要” 扱い（運用上ラク）
      return res.json({ ok: true, accepted: true });
    }

    const r = await db.query(
      `
      SELECT 1
      FROM user_terms_acceptances
      WHERE user_id = $1 AND terms_id = $2
      LIMIT 1
      `,
      [userId, terms.id],
    );

    return res.json({
      ok: true,
      accepted: r.rowCount > 0,
      currentVersion: terms.version,
      acceptedVersion: r.rowCount > 0 ? terms.version : null,
    });
  } catch (e: any) {
    console.error('[terms/status]', e);
    return res.status(500).json({ error: e?.message || 'server_error' });
  }
});

/**
 * POST /api/terms/accept
 * body: { termsId?: number, version?: string, userAgent?: string }
 */
router.post('/accept', async (req, res) => {
  try {
    const token = readBearer(req);
    if (!token) return res.status(401).json({ error: 'unauthenticated' });

    const verified = await verifyAccess(token);
    const claims = normalizeClaims(verified);

    const db = getDb(req);
    const userId = await resolveUserIdFromClaims(claims, db);
    if (userId == null) return res.status(401).json({ error: 'unauthenticated' });

    const { termsId, version, userAgent } = req.body || {};

    let terms: any = null;

    if (termsId && Number.isFinite(Number(termsId))) {
      const r = await db.query(
        `SELECT id, version FROM terms_documents WHERE id = $1 LIMIT 1`,
        [Number(termsId)],
      );
      terms = r.rows[0] ?? null;
    } else if (version && typeof version === 'string') {
      const r = await db.query(
        `SELECT id, version FROM terms_documents WHERE version = $1 LIMIT 1`,
        [version],
      );
      terms = r.rows[0] ?? null;
    } else {
      // 指定が無ければ current を同意対象とする
      terms = await getCurrentTerms(db);
    }

    if (!terms) return res.status(404).json({ error: 'terms_not_found' });

    await db.query(
      `
      INSERT INTO user_terms_acceptances (user_id, terms_id, accepted_at, user_agent)
      VALUES ($1, $2, now(), $3)
      ON CONFLICT (user_id, terms_id) DO UPDATE SET
        accepted_at = EXCLUDED.accepted_at,
        user_agent = COALESCE(EXCLUDED.user_agent, user_terms_acceptances.user_agent)
      `,
      [userId, terms.id, typeof userAgent === 'string' ? userAgent : null],
    );

    return res.json({
      ok: true,
      accepted: true,
      termsId: terms.id,
      version: terms.version,
    });
  } catch (e: any) {
    console.error('[terms/accept]', e);
    return res.status(500).json({ error: e?.message || 'server_error' });
  }
});

export default router;