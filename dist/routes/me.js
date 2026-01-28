"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// src/routes/me.ts
const express_1 = require("express");
const tokenService_1 = require("../auth/tokenService");
const router = (0, express_1.Router)();
router.get("/", async (req, res) => {
    try {
        const token = (0, tokenService_1.readBearer)(req);
        if (!token)
            return res.status(401).json({ error: "unauthenticated" });
        const verified = await (0, tokenService_1.verifyAccess)(token);
        const claims = verified?.payload ?? verified;
        const uid = claims?.uid;
        if (!uid)
            return res.status(401).json({ error: "unauthenticated" });
        const db = req.app.locals.db;
        if (!db) {
            console.error("[me:get] db_not_initialized");
            return res.status(500).json({ error: "server_error" });
        }
        const q = `
      SELECT
        u.id AS user_id,
        EXISTS (SELECT 1 FROM user_profiles p2 WHERE p2.user_id = u.id) AS has_profile,
        p.gender AS gender,

        -- 既存
        p.verified_age AS verified_age,

        -- ✅ 追加：KYC
        p.kyc_verified AS kyc_verified,
        p.kyc_verified_at AS kyc_verified_at
      FROM users u
      LEFT JOIN user_profiles p ON p.user_id = u.id
      WHERE u.id = $1 OR u.line_user_id = $2
      LIMIT 1
    `;
        const { rows } = await db.query(q, [uid, uid]);
        const row = rows[0];
        if (!row?.user_id)
            return res.status(401).json({ error: "unauthenticated" });
        const gender = row.gender === "male" || row.gender === "female" ? row.gender : null;
        // terms current
        const currentTermsRes = await db.query(`
      SELECT id, version
      FROM terms_documents
      WHERE effective_at <= now()
      ORDER BY effective_at DESC, id DESC
      LIMIT 1
      `);
        const current = currentTermsRes.rows[0] || null;
        let needsTermsAcceptance = false;
        let acceptedTermsVersion = null;
        let currentTermsVersion = current?.version ?? null;
        if (current) {
            const acc = await db.query(`
        SELECT td.version
        FROM user_terms_acceptances uta
        JOIN terms_documents td ON td.id = uta.terms_id
        WHERE uta.user_id = $1
          AND uta.terms_id = $2
        LIMIT 1
        `, [row.user_id, current.id]);
            const accepted = acc.rows[0] || null;
            acceptedTermsVersion = accepted?.version ?? null;
            needsTermsAcceptance = !accepted;
        }
        const hasProfile = !!row.has_profile;
        // 既存の返却（残したければ維持）
        const verifiedAge = typeof row.verified_age === "boolean" ? row.verified_age : null;
        // ✅ KYCは kyc_verified を正にする（NULLはfalse扱い）
        const kycVerified = Boolean(row.kyc_verified);
        const kycVerifiedAt = row.kyc_verified_at ?? null;
        // ✅ profileが無ければ「KYC以前にプロフィール登録が必要」なので needsKyc=false（ここは好み）
        // フロント側の導線に合わせるなら、hasProfile=false のときは needsKyc=false が自然
        const needsKyc = hasProfile && !kycVerified;
        return res.json({
            userId: Number(row.user_id),
            hasProfile,
            gender,
            // terms
            needsTermsAcceptance,
            currentTermsVersion,
            acceptedTermsVersion,
            // 既存
            verifiedAge,
            // ✅ KYC（統一）
            kycVerified,
            kycVerifiedAt,
            needsKyc,
        });
    }
    catch (e) {
        console.error("[me:get]", e?.message || e);
        return res.status(500).json({ error: "server_error" });
    }
});
exports.default = router;
