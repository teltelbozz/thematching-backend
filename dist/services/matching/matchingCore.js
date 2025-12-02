"use strict";
// src/services/matching/matchingCore.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeMatchesForSlot = computeMatchesForSlot;
const score_1 = require("./score");
function computeMatchesForSlot(entries, history, scoreThreshold = 0.75) {
    const females = entries.filter((e) => e.gender === "female").map((e) => e.user_id);
    const males = entries.filter((e) => e.gender === "male").map((e) => e.user_id);
    if (females.length < 2 || males.length < 2) {
        return { matched: [], unmatched: females.concat(males) };
    }
    const userInfo = {};
    for (const e of entries)
        userInfo[e.user_id] = { age: e.age };
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
    for (const fp of femalePairs) {
        for (const mp of malePairs) {
            if ((0, score_1.violatesRematch)(fp, mp, history))
                continue;
            const score = (0, score_1.groupAgeScore)(fp, mp, userInfo);
            if (score >= scoreThreshold) {
                const tie = Math.max(userInfo[fp[0]].age, userInfo[fp[1]].age);
                candidates.push({ female: fp, male: mp, score, tie });
            }
        }
    }
    candidates.sort((a, b) => {
        if (a.score !== b.score)
            return b.score - a.score;
        return a.tie - b.tie;
    });
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
