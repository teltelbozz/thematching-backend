"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// src/routes/terms.ts
const express_1 = require("express");
const tokenService_1 = require("../auth/tokenService");
const router = (0, express_1.Router)();
function normalizeClaims(v) {
    if (v && typeof v === "object" && "payload" in v)
        return v.payload;
    return v;
}
function normalizeUidNumber(v) {
    if (typeof v === "number" && Number.isFinite(v))
        return v;
    if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)))
        return Number(v);
    return null;
}
/**
 * アクセストークン内 claims の uid が:
 *  - 数値 … そのまま返す
 *  - 文字列（LINEの sub 想定 = "U..."）… users.line_user_id から id を解決
 *    - 見つからなければ INSERT して id を払い出す（フォールバック）
 */
async function resolveUserIdFromClaims(claims, db) {
    const raw = claims?.uid;
    const asNum = normalizeUidNumber(raw);
    if (asNum != null)
        return asNum;
    if (typeof raw === "string" && raw.trim()) {
        const sub = raw.trim();
        const r1 = await db.query("SELECT id FROM users WHERE line_user_id = $1 LIMIT 1", [sub]);
        if (r1.rows[0])
            return r1.rows[0].id;
        const r2 = await db.query("INSERT INTO users (line_user_id) VALUES ($1) RETURNING id", [sub]);
        return r2.rows[0]?.id ?? null;
    }
    return null;
}
/**
 * 現在有効な利用規約（effective_at <= now の最新）を取得
 */
async function getCurrentTerms(db) {
    const r = await db.query(`
    SELECT id, version, title, body_md, effective_at
    FROM terms_documents
    WHERE effective_at <= now()
    ORDER BY effective_at DESC, id DESC
    LIMIT 1
    `);
    return r.rows[0] || null;
}
/**
 * GET /api/terms/current
 * - 画面内表示用：本文も返す
 * - 認証なしでOK（A案：誘導のみ。誰でも取得可能）
 */
router.get("/current", async (req, res) => {
    try {
        const db = req.app.locals.db;
        if (!db) {
            console.error("[terms:current] db_not_initialized");
            return res.status(500).json({ error: "server_error" });
        }
        const terms = await getCurrentTerms(db);
        return res.json({
            ok: true,
            terms: terms
                ? {
                    id: Number(terms.id),
                    version: terms.version,
                    title: terms.title,
                    body_md: terms.body_md,
                    effective_at: terms.effective_at,
                }
                : null,
        });
    }
    catch (e) {
        console.error("[terms:current]", e?.message || e);
        return res.status(500).json({ error: "server_error" });
    }
});
/**
 * POST /api/terms/accept
 * body: { termsId?: number, version?: string }
 *
 * - 原則「current」を同意対象にする（termsId/versionが無い場合）
 * - 同意は user_terms_acceptances に保存
 */
router.post("/accept", async (req, res) => {
    try {
        const token = (0, tokenService_1.readBearer)(req);
        if (!token)
            return res.status(401).json({ error: "unauthenticated" });
        const verified = await (0, tokenService_1.verifyAccess)(token);
        const claims = normalizeClaims(verified);
        const db = req.app.locals.db;
        if (!db) {
            console.error("[terms:accept] db_not_initialized");
            return res.status(500).json({ error: "server_error" });
        }
        const userId = await resolveUserIdFromClaims(claims, db);
        if (userId == null)
            return res.status(401).json({ error: "unauthenticated" });
        const body = req.body || {};
        const termsIdRaw = body.termsId;
        const versionRaw = body.version;
        let terms = null;
        if (termsIdRaw != null && Number.isFinite(Number(termsIdRaw))) {
            const r = await db.query(`SELECT id, version, title, body_md, effective_at
         FROM terms_documents
         WHERE id = $1
         LIMIT 1`, [Number(termsIdRaw)]);
            terms = r.rows[0] || null;
        }
        else if (typeof versionRaw === "string" && versionRaw.trim()) {
            const r = await db.query(`SELECT id, version, title, body_md, effective_at
         FROM terms_documents
         WHERE version = $1
         LIMIT 1`, [versionRaw.trim()]);
            terms = r.rows[0] || null;
        }
        else {
            terms = await getCurrentTerms(db);
        }
        if (!terms) {
            return res.status(404).json({ error: "terms_not_found" });
        }
        // INSERT（同意済みなら何もしない）
        await db.query(`
      INSERT INTO user_terms_acceptances (user_id, terms_id, accepted_at, user_agent, ip)
      VALUES ($1, $2, now(), $3, $4)
      ON CONFLICT (user_id, terms_id) DO NOTHING
      `, [
            userId,
            Number(terms.id),
            req.header("user-agent") || null,
            req.headers["x-forwarded-for"] || req.ip || null,
        ]);
        return res.json({
            ok: true,
            accepted: {
                user_id: userId,
                terms_id: Number(terms.id),
                version: terms.version,
            },
        });
    }
    catch (e) {
        console.error("[terms:accept]", e?.message || e);
        return res.status(500).json({ error: "server_error" });
    }
});
exports.default = router;
