"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMatchedGroup = createMatchedGroup;
// src/services/matching/createGroup.ts
const crypto_1 = __importDefault(require("crypto"));
/**
 * URL-safe token を生成する関数
 * 24 bytes → base64url エンコード → 約 32 文字の token
 */
function generateToken() {
    return crypto_1.default.randomBytes(24).toString('base64url');
}
/**
 * マッチング確定グループを DB に保存し、token を返す。
 * - token の一意性チェック込み
 * - matched_groups + matched_group_members の2テーブルへ INSERT
 */
async function createMatchedGroup(params) {
    const { db, slotDt, location, typeMode, fPair, mPair } = params;
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        // 1) 一意 token を生成して衝突チェック
        let token = generateToken();
        {
            const r = await client.query(`SELECT 1 FROM matched_groups WHERE token = $1 LIMIT 1`, [token]);
            if (r.rowCount > 0) {
                // 万が一衝突したら作り直す（ほぼ発生しない）
                token = generateToken();
            }
        }
        // 2) matched_groups に INSERT
        const insertGroup = await client.query(`
      INSERT INTO matched_groups (slot_dt, location, type_mode, token)
      VALUES ($1, $2, $3, $4)
      RETURNING id, token
      `, [slotDt, location, typeMode, token]);
        const groupId = insertGroup.rows[0].id;
        const createdToken = insertGroup.rows[0].token;
        // 3) matched_group_members に 4名を INSERT
        const members = [
            ...fPair.map(uid => ({ uid, gender: 'female' })),
            ...mPair.map(uid => ({ uid, gender: 'male' })),
        ];
        for (const mem of members) {
            await client.query(`
        INSERT INTO matched_group_members (group_id, user_id, gender)
        VALUES ($1, $2, $3)
        `, [groupId, mem.uid, mem.gender]);
        }
        await client.query('COMMIT');
        return { id: groupId, token: createdToken };
    }
    catch (e) {
        await client.query('ROLLBACK');
        console.error('[createMatchedGroup] error:', e);
        throw e;
    }
    finally {
        client.release();
    }
}
