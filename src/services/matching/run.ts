// src/services/matching/run.ts

import type { Pool } from "pg";
import { getEntriesForSlot, getHistoryEdges } from "./repository";
import { computeMatchesForSlot } from "./engine";
import { saveMatchesForSlot } from "./save";
import { assignTokensForSlot } from "./assign";

/**
 * 1つの slotDt に対するマッチング実行（DB読み込み → マッチング → 保存 → token付与）
 */
export async function runMatchingForSlot(db: Pool, slotDt: string) {
  console.log(`[runMatchingForSlot] slot = ${slotDt}`);

  // 1. エントリ取得
  const entries = await getEntriesForSlot(slotDt);
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
  const history = await getHistoryEdges();

  // 3. マッチング実行
  const { matched, unmatched } = computeMatchesForSlot(entries, history);

  console.log(
    `[runMatchingForSlot] matched=${matched.length} groups, unmatched=${unmatched.length}`
  );

  // 4. DB 保存（matched_groups / matched_group_members / match_history）
  if (matched.length > 0) {
    const first = entries[0];
    await saveMatchesForSlot(
      db,
      slotDt,
      first.location,
      first.type_mode,
      matched
    );

    // 5. token をセット
    await assignTokensForSlot(db, slotDt, first.location, first.type_mode);
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
import { getSlotsForDate } from "./repository";

export async function runDailyMatching(db: Pool, dateKey: string) {
  console.log(`[runDailyMatching] date=${dateKey}`);

  const slotList = await getSlotsForDate(dateKey);

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