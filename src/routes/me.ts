// src/routes/me.ts
import { Router } from "express";
import type { Pool } from "pg";
import { readBearer, verifyAccess } from "../auth/tokenService";

const router = Router();

/**
 * GET /api/me
 * - userId: ユーザーID
 * - hasProfile: プロフィール登録済みか
 * - gender: 'male' | 'female' | null
 * - needsTermsAcceptance: 最新規約への同意が必要か（A案：誘導用）
 * - currentTermsVersion: 現在有効な規約バージョン（存在しない場合 null）
 * - acceptedTermsVersion: 同意済みの規約バージョン（未同意なら null）
 */
router.get("/", async (req, res) => {
  try {
    const token = readBearer(req);
    if (!token) return res.status(401).json({ error: "unauthenticated" });

    const verified = await verifyAccess(token);
    const claims = (verified as any)?.payload ?? verified;
    const uid = claims?.uid;
    if (!uid) return res.status(401).json({ error: "unauthenticated" });

    const db = req.app.locals.db as Pool | undefined;
    if (!db) {
      console.error("[me:get] db_not_initialized");
      return res.status(500).json({ error: "server_error" });
    }

    // user_profilesにidカラムがない（主キーはuser_id）
    const q = `
      SELECT
        u.id AS user_id,
        EXISTS (SELECT 1 FROM user_profiles p2 WHERE p2.user_id = u.id) AS has_profile,
        p.gender AS gender
      FROM users u
      LEFT JOIN user_profiles p ON p.user_id = u.id
      WHERE u.id = $1 OR u.line_user_id = $2
      LIMIT 1
    `;
    const { rows } = await db.query(q, [uid, uid]);
    const row = rows[0];
    if (!row?.user_id) return res.status(401).json({ error: "unauthenticated" });

    const gender =
      row.gender === "male" || row.gender === "female" ? row.gender : null;

    // ===== 追加：規約（current）と同意状況 =====
    // current（effective_at <= now の最新）
    const currentTermsRes = await db.query(
      `
      SELECT id, version
      FROM terms_documents
      WHERE effective_at <= now()
      ORDER BY effective_at DESC, id DESC
      LIMIT 1
      `
    );
    const current = currentTermsRes.rows[0] || null;

    let needsTermsAcceptance = false;
    let acceptedTermsVersion: string | null = null;
    let currentTermsVersion: string | null = current?.version ?? null;

    if (current) {
      const acc = await db.query(
        `
        SELECT td.version
        FROM user_terms_acceptances uta
        JOIN terms_documents td ON td.id = uta.terms_id
        WHERE uta.user_id = $1
          AND uta.terms_id = $2
        LIMIT 1
        `,
        [row.user_id, current.id]
      );
      const accepted = acc.rows[0] || null;
      acceptedTermsVersion = accepted?.version ?? null;
      needsTermsAcceptance = !accepted;
    }

    return res.json({
      userId: row.user_id as number,
      hasProfile: !!row.has_profile,
      gender,
      needsTermsAcceptance,
      currentTermsVersion,
      acceptedTermsVersion,
    });
  } catch (e: any) {
    console.error("[me:get]", e?.message || e);
    return res.status(500).json({ error: "server_error" });
  }
});

export default router;