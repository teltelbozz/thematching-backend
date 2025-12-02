// src/cron/matchCron.ts
import { Pool } from "pg";
import {
  getSlotsForDate,
  getEntriesForSlot,
  getHistoryEdges,
  computeMatchesForSlot,
  saveMatchesForSlot,
  assignTokensForSlot,
} from "../services/matching";

// JST 日付を YYYY-MM-DD 形式で取得
function getJstDateKey(offsetDays = 1): string {
  const now = new Date(Date.now() + 9 * 3600 * 1000); // JST
  const target = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + offsetDays
  );

  const yyyy = target.getFullYear();
  const mm = String(target.getMonth() + 1).padStart(2, "0");
  const dd = String(target.getDate() + 0).padStart(2, "0");

  return `${yyyy}-${mm}-${dd}`;
}

/**
 * メイン関数
 *  - 翌日分の slot_dt を抽出
 *  - 各 slot_dt でマッチング実行
 *  - DB に保存
 *  - token を付与
 */
export async function executeMatchCron(pool: Pool) {
  const dateKey = getJstDateKey(1); // 翌日
  console.log(`[cron] target date = ${dateKey}`);

  // ① 翌日の slot_dt を取得（string として返る）
  const slotList = await getSlotsForDate(dateKey);
  console.log(`[cron] slots =`, slotList);

  if (slotList.length === 0) {
    return {
      ok: true,
      message: `no slots for ${dateKey}`,
      date: dateKey,
    };
  }

  const results: {
    slotDt: string;
    matchedCount: number;
    unmatchedCount: number;
  }[] = [];

  // 履歴は1回だけ読む（※slot毎に変えたいならここを中に移動）
  const history = await getHistoryEdges();

  for (const slotDt of slotList) {
    console.log(`\n[cron] ===== slot ${slotDt} =====`);

    // ② エントリユーザ取得
    const entries = await getEntriesForSlot(slotDt);

    if (entries.length === 0) {
      console.log(`[cron] no entries for slot=${slotDt}`);
      results.push({ slotDt, matchedCount: 0, unmatchedCount: 0 });
      continue;
    }

    // ③ location & type_mode は entries から抽出（仕様上、単一前提）
    const locations = Array.from(new Set(entries.map((e) => e.location)));
    const types = Array.from(new Set(entries.map((e) => e.type_mode)));

    if (locations.length !== 1 || types.length !== 1) {
      console.warn(
        `[cron] inconsistent location/type_mode for slot=${slotDt}`,
        { locations, types }
      );
      continue;
    }

    const location = locations[0];
    const typeMode = types[0];

    // ④ マッチング実行（年齢 + history のみ）
    const { matched, unmatched } = computeMatchesForSlot(entries, history);
    console.log(
      `[cron] matched groups=${matched.length}, unmatched users=${unmatched.length}`
    );

    // ⑤ DB 保存
    await saveMatchesForSlot(pool, slotDt, location, typeMode, matched);

    // ⑥ token 付与
    await assignTokensForSlot(pool, slotDt, location, typeMode);

    results.push({
      slotDt,
      matchedCount: matched.length,
      unmatchedCount: unmatched.length,
    });
  }

  return {
    ok: true,
    date: dateKey,
    slotCount: slotList.length,
    results,
  };
}

export default executeMatchCron;