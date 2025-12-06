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
  const dd = String(target.getDate()).padStart(2, "0");

  return `${yyyy}-${mm}-${dd}`; // 例: "2025-12-05"
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
      slotCount: 0,
      results: [] as {
        slotDt: string;
        matchedCount: number;
        unmatchedCount: number;
        entriesCount?: number;
        error?: string;
      }[],
    };
  }

  const results: {
    slotDt: string;
    matchedCount: number;
    unmatchedCount: number;
    entriesCount?: number;
    error?: string;
  }[] = [];

  // 履歴は1回だけ読む（※slot毎に変えたいならここを中に移動）
  const history = await getHistoryEdges();
  console.log(`[cron] history edges = ${history.size}`);

  for (const slotDt of slotList) {
    const jstLabel = new Date(slotDt).toLocaleString("ja-JP", {
      timeZone: "Asia/Tokyo",
    });
    console.log(`\n[cron] ===== slot ${slotDt} (JST=${jstLabel}) =====`);

    try {
      // ② エントリユーザ取得
      const entries = await getEntriesForSlot(slotDt);
      console.log(`[cron] entries count = ${entries.length}`);

      if (entries.length === 0) {
        console.log(`[cron] no entries for slot=${slotDt}`);
        results.push({
          slotDt,
          matchedCount: 0,
          unmatchedCount: 0,
          entriesCount: 0,
        });
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
        results.push({
          slotDt,
          matchedCount: 0,
          unmatchedCount: entries.length,
          entriesCount: entries.length,
          error: "inconsistent location/type_mode",
        });
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
        entriesCount: entries.length,
      });
    } catch (e: any) {
      console.error(`[cron] error on slot=${slotDt}`, e);
      results.push({
        slotDt,
        matchedCount: 0,
        unmatchedCount: 0,
        error: e?.message || "unknown error",
      });
      // 次の slot に継続
      continue;
    }
  }

  return {
    ok: true,
    date: dateKey,
    slotCount: slotList.length,
    results,
  };
}

export default executeMatchCron;