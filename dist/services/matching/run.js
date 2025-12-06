"use strict";
// src/services/matching/run.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.runMatchingForSlot = runMatchingForSlot;
exports.runDailyMatching = runDailyMatching;
const repository_1 = require("./repository");
const engine_1 = require("./engine");
const save_1 = require("./save");
const assign_1 = require("./assign");
/**
 * 1つの slotDt に対するマッチング実行（DB読み込み → マッチング → 保存 → token付与）
 */
async function runMatchingForSlot(db, slotDt) {
    console.log(`[runMatchingForSlot] slot = ${slotDt}`);
    // 1. エントリ取得
    const entries = await (0, repository_1.getEntriesForSlot)(slotDt);
    if (entries.length === 0) {
        console.log(`[runMatchingForSlot] no entries for ${slotDt}`);
        return {
            slot: slotDt,
            matchedGroups: 0,
            unmatched: 0,
            detail: [],
        };
    }
    // 2. 再マッチ禁止履歴の取得
    const history = await (0, repository_1.getHistoryEdges)();
    // 3. マッチング実行
    const { matched, unmatched } = (0, engine_1.computeMatchesForSlot)(entries, history);
    console.log(`[runMatchingForSlot] matched=${matched.length} groups, unmatched=${unmatched.length}`);
    // 4. DB 保存（matched_groups / matched_group_members / match_history）
    if (matched.length > 0) {
        const first = entries[0];
        await (0, save_1.saveMatchesForSlot)(db, slotDt, first.location, first.type_mode, matched);
        // 5. token をセット
        await (0, assign_1.assignTokensForSlot)(db, slotDt, first.location, first.type_mode);
    }
    return {
        slot: slotDt,
        matchedGroups: matched.length,
        unmatched: unmatched.length,
        detail: matched,
    };
}
/**
 * 指定日の全スロットに対してマッチング実行（cron 用）
 */
const repository_2 = require("./repository");
async function runDailyMatching(db, dateKey) {
    console.log(`[runDailyMatching] date=${dateKey}`);
    const slotList = await (0, repository_2.getSlotsForDate)(dateKey);
    if (slotList.length === 0) {
        return {
            ok: true,
            date: dateKey,
            results: [],
        };
    }
    const results = [];
    for (const slot of slotList) {
        const r = await runMatchingForSlot(db, slot);
        results.push(r);
    }
    return {
        ok: true,
        date: dateKey,
        results,
    };
}
