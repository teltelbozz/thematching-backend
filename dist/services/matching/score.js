"use strict";
// 年齢スコアと groupAgeScore / violatesRematch
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculatePairScore = calculatePairScore;
exports.groupAgeScore = groupAgeScore;
exports.violatesRematch = violatesRematch;
function calculatePairScore(femaleAge, maleAge) {
    const diff = maleAge - femaleAge;
    if (diff <= -3)
        return 1.0;
    if (diff <= 2)
        return 1.0;
    if (diff <= 5)
        return 1.0 + ((5 - diff) / 4) * 0.05;
    if (femaleAge < 30 && maleAge < 30)
        return Math.max(0, 1 - diff / 30);
    return Math.max(0, 1 - diff / 10);
}
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
function violatesRematch(femalePair, malePair, history) {
    for (const f of femalePair) {
        for (const m of malePair) {
            const a = Math.min(f, m);
            const b = Math.max(f, m);
            const k = `${a}-${b}`;
            if (history.has(k))
                return true;
        }
    }
    return false;
}
