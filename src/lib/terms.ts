// src/lib/terms.ts
import type { Pool } from "pg";

export type TermsDoc = {
  id: number;
  version: string;
  title: string;
  body_md: string;
  effective_at: string;
};

export function getCurrentTermsVersion(): string | null {
  const v = (process.env.TERMS_CURRENT_VERSION || "").trim();
  return v ? v : null;
}

export async function getCurrentTerms(db: Pool): Promise<TermsDoc | null> {
  const version = getCurrentTermsVersion();
  if (!version) return null;

  const { rows } = await db.query(
    `
    SELECT id, version, title, body_md, effective_at
    FROM terms_documents
    WHERE version = $1
    LIMIT 1
    `,
    [version]
  );

  if (!rows[0]) return null;

  const r: any = rows[0];
  return {
    id: Number(r.id),
    version: String(r.version),
    title: String(r.title),
    body_md: String(r.body_md),
    effective_at: r.effective_at,
  };
}

export async function hasAcceptedTerms(
  db: Pool,
  userId: number,
  termsId: number
): Promise<boolean> {
  const { rows } = await db.query(
    `
    SELECT 1
    FROM user_terms_acceptances
    WHERE user_id = $1 AND terms_id = $2
    LIMIT 1
    `,
    [userId, termsId]
  );
  return !!rows[0];
}

/**
 * 同意が必要なら { required: true, version } を返す
 * terms自体が未設定/未登録なら required=false（運用ミスで止めない）
 */
export async function checkTermsRequirement(db: Pool, userId: number): Promise<{
  required: boolean;
  version: string | null;
  title?: string;
  effective_at?: string;
  accepted: boolean;
}> {
  const current = await getCurrentTerms(db);
  if (!current) {
    return { required: false, version: null, accepted: true };
  }

  const accepted = await hasAcceptedTerms(db, userId, current.id);
  return {
    required: !accepted,
    version: current.version,
    title: current.title,
    effective_at: current.effective_at,
    accepted,
  };
}

/**
 * 規約未同意なら 412 を返す、という使い方のためのヘルパ
 */
export async function requireTermsAcceptedOr412(
  db: Pool,
  userId: number,
  res: any
): Promise<boolean> {
  const st = await checkTermsRequirement(db, userId);
  if (!st.required) return true;

  res.status(412).json({
    error: "terms_required",
    terms: {
      required: true,
      version: st.version,
      title: st.title,
      effective_at: st.effective_at,
    },
  });
  return false;
}