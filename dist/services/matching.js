"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSlotsForDate = getSlotsForDate;
exports.getEntriesForSlot = getEntriesForSlot;
exports.getHistoryEdges = getHistoryEdges;
exports.calculatePairScore = calculatePairScore;
exports.groupAgeScore = groupAgeScore;
exports.violatesRematch = violatesRematch;
exports.computeMatchesForSlot = computeMatchesForSlot;
exports.saveMatchesForSlot = saveMatchesForSlot;
exports.assignTokensForSlot = assignTokensForSlot;
// src/services/matching.ts
const db_1 = __importDefault(require("../db"));
/**
 * 指定日（yyyy-mm-dd）の slot_dt を全件取得
 * 例：
 *   "2025-11-14" → 2025-11-14T19:00:00+09:00 / 21:00:00+09:00 の2件
 */
async function getSlotsForDate(date) {
    const { rows } = await db_1.default.query(`
    SELECT DISTINCT slot_dt
    FROM user_setup_slots
    WHERE slot_dt::date = $1::date
    ORDER BY slot_dt
    `, [date]);
    return rows.map((r) => r.slot_dt);
}
async function getEntriesForSlot(slotDt) {
    const { rows } = await db_1.default.query(`
    SELECT
      u.id AS user_id,
      p.gender AS gender,
      p.age AS age,
      s.type_mode AS type_mode,
      s.location AS location
    FROM user_setup s
    JOIN user_setup_slots sl
      ON sl.user_setup_id = s.id
    JOIN users u
      ON s.user_id = u.id
    JOIN user_profiles p
      ON p.user_id = u.id
    WHERE sl.slot_dt = $1
    ORDER BY u.id
    `, [slotDt]);
    // gender を TS 型に収める
    return rows.map((r) => ({
        user_id: r.user_id,
        gender: r.gender === 'male' || r.gender === 'female' ? r.gender : 'male', // fallback male
        age: Number(r.age),
        type_mode: r.type_mode,
        location: r.location,
    }));
}
async function getHistoryEdges() {
    const { rows } = await db_1.default.query(`
    SELECT user_id_female, user_id_male
    FROM match_history
    `);
    const set = new Set();
    for (const r of rows) {
        const a = Number(r.user_id_female);
        const b = Number(r.user_id_male);
        const key = `${Math.min(a, b)}-${Math.max(a, b)}`;
        set.add(key);
    }
    return set;
}
// ----------------------------------------------
//  Step 2: Matching Logic (TypeScript版・完成版)
// ----------------------------------------------
/**
 * 年齢ペアスコア（Pythonロジックと完全一致）
 */
function calculatePairScore(femaleAge, maleAge) {
    const diff = maleAge - femaleAge; // 男性 - 女性
    // 1) 男性が3歳以上年下 → 優遇も減点もせず 1.0 固定
    if (diff <= -3)
        return 1.0;
    // 2) ±2歳差 → 1.0
    if (diff <= 2)
        return 1.0;
    // 3) 男性が3〜5歳年上 → 線形ボーナス（3:+0.05, 4:+0.03, 5:+0.01）
    if (diff <= 5) {
        return 1.0 + ((5 - diff) / 4) * 0.05; // 1.00〜1.05
    }
    // 4) 男性が6歳以上年上
    if (femaleAge < 30 && maleAge < 30) {
        return Math.max(0, 1.0 - diff / 30.0);
    }
    else {
        return Math.max(0, 1.0 - diff / 10.0);
    }
}
/**
 * 2×2 グループスコア（Pythonの group_age_score() と完全一致）
 */
function groupAgeScore(female, male, userInfo) {
    const pairs = [
        [female[0], male[0]],
        [female[0], male[1]],
        [female[1], male[0]],
        [female[1], male[1]],
    ];
    let total = 0;
    for (const [f, m] of pairs) {
        total += calculatePairScore(userInfo[f].age, userInfo[m].age);
    }
    return total / 4;
}
/**
 * 再マッチ禁止（案4：男女ペアのみ禁止）
 * history は "min-max" の無向エッジ（男女ペア）として管理
 */
function violatesRematch(femalePair, malePair, history) {
    for (const f of femalePair) {
        for (const m of malePair) {
            const a = Math.min(f, m);
            const b = Math.max(f, m);
            const key = `${a}-${b}`;
            if (history.has(key)) {
                return true;
            }
        }
    }
    return false;
}
/**
 * 指定1スロット（slot_dt）に対するマッチング実行
 * Step A の getEntriesForSlot() の結果を渡して実行する
 */
function computeMatchesForSlot(entries, history, scoreThreshold = 0.75) {
    // ---------------------
    // 0. 入力正規化
    // ---------------------
    const females = entries
        .filter((e) => e.gender === "female")
        .map((e) => e.user_id);
    const males = entries
        .filter((e) => e.gender === "male")
        .map((e) => e.user_id);
    if (females.length < 2 || males.length < 2) {
        return { matched: [], unmatched: females.concat(males) };
    }
    // userInfo: user_id → { age }
    const userInfo = {};
    for (const e of entries) {
        userInfo[e.user_id] = { age: e.age };
    }
    // ---------------------
    // 1. 全組み合わせを生成（C(F,2) × C(M,2)）
    // ---------------------
    const femalePairs = [];
    const malePairs = [];
    for (let i = 0; i < females.length; i++) {
        for (let j = i + 1; j < females.length; j++) {
            femalePairs.push([females[i], females[j]]);
        }
    }
    for (let i = 0; i < males.length; i++) {
        for (let j = i + 1; j < males.length; j++) {
            malePairs.push([males[i], males[j]]);
        }
    }
    const candidates = [];
    // ---------------------
    // 2. スコア計算 + 閾値判定 + 再マッチ禁止
    // ---------------------
    for (const fp of femalePairs) {
        for (const mp of malePairs) {
            if (violatesRematch(fp, mp, history)) {
                continue;
            }
            const score = groupAgeScore(fp, mp, userInfo);
            if (score >= scoreThreshold) {
                // tie-break = 女性年齢の「高い方」（低いほうが優先されるので昇順にする）
                const fa1 = userInfo[fp[0]].age;
                const fa2 = userInfo[fp[1]].age;
                const tie = Math.max(fa1, fa2);
                candidates.push({ female: fp, male: mp, score, tie });
            }
        }
    }
    // ---------------------
    // 3. ソート（score DESC, tie ASC）
    // ---------------------
    candidates.sort((a, b) => {
        if (a.score !== b.score)
            return b.score - a.score;
        return a.tie - b.tie;
    });
    // ---------------------
    // 4. Greedy selection（非重複で採用）
    // ---------------------
    const used = new Set();
    const chosen = [];
    for (const c of candidates) {
        const ids = [...c.female, ...c.male];
        if (ids.some((id) => used.has(id)))
            continue;
        chosen.push(c);
        ids.forEach((id) => used.add(id));
    }
    const allIds = females.concat(males);
    const unmatched = allIds.filter((id) => !used.has(id));
    return { matched: chosen, unmatched };
}
/**
 * computeMatchesForSlot() の結果を書き込む
 *
 * @param db        pg.Pool
 * @param slotDt    "2025-11-14T19:00:00+09:00" など
 * @param location  "shibuya_shinjuku"
 * @param typeMode  "wine_talk" | "wine_and_others"
 * @param matched   computeMatchesForSlot().matched
 */
async function saveMatchesForSlot(db, slotDt, location, typeMode, matched) {
    if (matched.length === 0) {
        console.log(`No groups to save for slot ${slotDt}`);
        return;
    }
    const client = await db.connect();
    try {
        await client.query("BEGIN");
        for (const group of matched) {
            // --------------------------------------------------------
            // 1. matched_groups の INSERT
            // --------------------------------------------------------
            const insertGroup = `
        INSERT INTO matched_groups (slot_dt, location, type_mode, status)
        VALUES ($1, $2, $3, 'pending')
        RETURNING id
      `;
            const grpRes = await client.query(insertGroup, [
                slotDt,
                location,
                typeMode,
            ]);
            const groupId = grpRes.rows[0].id;
            // --------------------------------------------------------
            // 2. matched_group_members の INSERT（女性2 + 男性2）
            // gender は小文字で "female" / "male"
            // --------------------------------------------------------
            const insertMember = `
        INSERT INTO matched_group_members (group_id, user_id, gender)
        VALUES ($1, $2, $3)
      `;
            // 女性
            await client.query(insertMember, [
                groupId,
                group.female[0],
                "female",
            ]);
            await client.query(insertMember, [
                groupId,
                group.female[1],
                "female",
            ]);
            // 男性
            await client.query(insertMember, [groupId, group.male[0], "male"]);
            await client.query(insertMember, [groupId, group.male[1], "male"]);
            // --------------------------------------------------------
            // 3. match_history の INSERT（案4: 男女ペアのみ）
            // 無向なので min-max で保存
            // user_id_female < user_id_male になるよう正規化
            // --------------------------------------------------------
            const insertHistory = `
        INSERT INTO match_history (user_id_female, user_id_male, slot_dt)
        VALUES ($1, $2, $3)
        ON CONFLICT DO NOTHING
      `;
            for (const f of group.female) {
                for (const m of group.male) {
                    const female = Math.min(f, m);
                    const male = Math.max(f, m);
                    await client.query(insertHistory, [female, male, slotDt]);
                }
            }
        }
        await client.query("COMMIT");
        console.log(`Saved ${matched.length} matched groups for slot ${slotDt} (${location}, ${typeMode})`);
    }
    catch (err) {
        await client.query("ROLLBACK");
        console.error("[saveMatchesForSlot] error:", err);
        throw err;
    }
    finally {
        client.release();
    }
}
// ----------------------------------------------------
// Step 4: matched_groups.token の生成
// ----------------------------------------------------
const crypto_1 = __importDefault(require("crypto"));
/**
 * 指定した slot の matched_groups で、
 * token が null のレコードにランダム token を付与する。
 *
 * @param db        pg.Pool
 * @param slotDt    "2025-11-14T19:00:00+09:00"
 * @param location  "shibuya_shinjuku"
 * @param typeMode  "wine_talk" | "wine_and_others"
 */
async function assignTokensForSlot(db, slotDt, location, typeMode) {
    const client = await db.connect();
    try {
        // 1. 対象の group_id を取得（token が NULL のもの）
        const sel = `
      SELECT id FROM matched_groups
      WHERE slot_dt = $1
        AND location = $2
        AND type_mode = $3
        AND token IS NULL
      ORDER BY id
    `;
        const res = await client.query(sel, [slotDt, location, typeMode]);
        const ids = res.rows.map((r) => r.id);
        if (ids.length === 0) {
            console.log("[assignTokensForSlot] No groups to assign token.");
            return;
        }
        console.log(`[assignTokensForSlot] target groups:`, ids);
        // 2. token を生成して UPDATE
        for (const id of ids) {
            const token = generateGroupToken();
            const upd = `
        UPDATE matched_groups
        SET token = $1
        WHERE id = $2
        RETURNING token
      `;
            const ures = await client.query(upd, [token, id]);
            console.log(`  → group_id=${id} token=${ures.rows[0].token}`);
        }
        console.log("[assignTokensForSlot] done.");
    }
    catch (err) {
        console.error("[assignTokensForSlot] error:", err);
        throw err;
    }
    finally {
        client.release();
    }
}
/**
 * tok_{ランダム文字列}
 * 例: tok_SQx8dpD3j29skla
 */
function generateGroupToken() {
    const rand = crypto_1.default.randomBytes(8).toString("base64url"); // 衝突ほぼ無し
    return `tok_${rand}`;
}
