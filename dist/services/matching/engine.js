"use strict";
// src/services/matching/engine.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculatePairScore = calculatePairScore;
exports.groupAgeScore = groupAgeScore;
exports.violatesRematch = violatesRematch;
exports.computeMatchesForSlot = computeMatchesForSlot;
// ----------------------------
// 1) ペアスコア（Python と同等）
// ----------------------------
function calculatePairScore(fAge, mAge) {
    const diff = mAge - fAge;
    if (diff <= -3)
        return 1.0; // 男性が3歳以上年下 → 1.0
    if (diff <= 2)
        return 1.0; // ±2歳差 → 1.0
    // 男性 3〜5歳上 → 1.00〜1.05 のボーナス
    if (diff <= 5) {
        return 1.0 + ((5 - diff) / 4) * 0.05;
    }
    // 6歳以上差
    if (fAge < 30 && mAge < 30) {
        // 20代同士は緩和
        return Math.max(0, 1.0 - diff / 30.0);
    }
    return Math.max(0, 1.0 - diff / 10.0);
}
// ----------------------------
// 2) グループスコア（2×2 の4ペア平均）
// ----------------------------
function groupAgeScore(f, m, info) {
    const pairs = [
        [f[0], m[0]],
        [f[0], m[1]],
        [f[1], m[0]],
        [f[1], m[1]],
    ];
    let total = 0;
    for (const [ff, mm] of pairs) {
        total += calculatePairScore(info[ff].age, info[mm].age);
    }
    return total / 4;
}
// ----------------------------
// 3) 再マッチ禁止（案4: 男女ペアのみ）
// ----------------------------
function violatesRematch(fPair, mPair, history) {
    for (const f of fPair) {
        for (const m of mPair) {
            const a = Math.min(f, m);
            const b = Math.max(f, m);
            const key = `${a}-${b}`;
            if (history.has(key))
                return true;
        }
    }
    return false;
}
// ----------------------------
// 4) マッチング本体
// ----------------------------
function computeMatchesForSlot(entries, history, scoreThreshold = 0.75) {
    const females = entries
        .filter((e) => e.gender === "female")
        .map((e) => e.user_id);
    const males = entries
        .filter((e) => e.gender === "male")
        .map((e) => e.user_id);
    if (females.length < 2 || males.length < 2) {
        return { matched: [], unmatched: females.concat(males) };
    }
    const info = {};
    for (const e of entries) {
        info[e.user_id] = { age: e.age };
    }
    const fPairs = [];
    const mPairs = [];
    for (let i = 0; i < females.length; i++) {
        for (let j = i + 1; j < females.length; j++) {
            fPairs.push([females[i], females[j]]);
        }
    }
    for (let i = 0; i < males.length; i++) {
        for (let j = i + 1; j < males.length; j++) {
            mPairs.push([males[i], males[j]]);
        }
    }
    const candidates = [];
    for (const fp of fPairs) {
        for (const mp of mPairs) {
            if (violatesRematch(fp, mp, history))
                continue;
            const score = groupAgeScore(fp, mp, info);
            if (score < scoreThreshold)
                continue;
            const ages = fp.map((id) => info[id].age).sort((a, b) => a - b);
            candidates.push({
                female: fp,
                male: mp,
                score,
                tie: ages[1], // 2人なので「高い方」
            });
        }
    }
    // score DESC, tie ASC
    candidates.sort((a, b) => a.score !== b.score ? b.score - a.score : a.tie - b.tie);
    const used = new Set();
    const chosen = [];
    for (const c of candidates) {
        const ids = [...c.female, ...c.male];
        if (ids.some((id) => used.has(id)))
            continue;
        chosen.push(c);
        ids.forEach((id) => used.add(id));
    }
    const allIds = [...females, ...males];
    const unmatched = allIds.filter((id) => !used.has(id));
    return { matched: chosen, unmatched };
}
