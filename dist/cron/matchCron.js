"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeMatchCron = executeMatchCron;
const matching_1 = require("../services/matching");
const enqueueLineNotifications_1 = require("../services/notifications/enqueueLineNotifications");
const dispatchLineNotifications_1 = require("../services/notifications/dispatchLineNotifications");
// JST 日付を YYYY-MM-DD 形式で取得
function getJstDateKey(offsetDays = 1) {
    const now = new Date(Date.now() + 9 * 3600 * 1000); // JST
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays);
    const yyyy = target.getFullYear();
    const mm = String(target.getMonth() + 1).padStart(2, "0");
    const dd = String(target.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`; // 例: "2025-12-05"
}
// slotDt 表示用（Dateパースが怪しい時に落ちないようにするだけ）
function safeJstLabel(slotDt) {
    try {
        // DBによって "YYYY-MM-DD HH:mm:ss+00" 形式などが来ることがある
        // その場合 new Date() が環境依存になり得るので、失敗しても文字列で返す
        const d = new Date(slotDt);
        if (Number.isNaN(d.getTime()))
            return slotDt;
        return d.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
    }
    catch {
        return slotDt;
    }
}
/**
 * メイン関数
 *  - 翌日分の slot_dt を抽出
 *  - 各 slot_dt でマッチング実行
 *  - DB に保存
 *  - token を付与
 */
async function executeMatchCron(pool) {
    const dateKey = getJstDateKey(1); // 翌日
    console.log(`[cron] target date = ${dateKey}`);
    // ① 翌日の slot_dt を取得（string として返る）
    const slotList = await (0, matching_1.getSlotsForDate)(dateKey);
    console.log(`[cron] slots =`, slotList);
    if (slotList.length === 0) {
        return {
            ok: true,
            message: `no slots for ${dateKey}`,
            date: dateKey,
            slotCount: 0,
            results: [],
        };
    }
    const results = [];
    // 履歴は1回だけ読む（※slot毎に変えたいならここを中に移動）
    const history = await (0, matching_1.getHistoryEdges)();
    console.log(`[cron] history edges = ${history.size}`);
    for (const slotDt of slotList) {
        console.log(`\n[cron] ===== slot ${slotDt} (JST=${safeJstLabel(slotDt)}) =====`);
        try {
            // ② エントリユーザ取得（B案: active slot / active setup のみ返る想定）
            const entries = await (0, matching_1.getEntriesForSlot)(slotDt);
            console.log(`[cron] entries count = ${entries.length}`);
            // ★改善：entries=0 の slot も “処理済み” に倒す（重くならないため）
            //  - getSlotsForDate が active slot を返している以上、ここで entries=0 が起きることはあり得る
            //    (例: parent setup が processed にされた / profiles欠損 / 途中データ不整合 etc)
            //  - slotだけ残り続けると cron 対象に残り続けるので、slot単位で processed に倒す
            if (entries.length === 0) {
                console.log(`[cron] no entries for slot=${slotDt} -> mark slot processed`);
                const client = await pool.connect();
                try {
                    await client.query(`
            UPDATE user_setup_slots
            SET status = 'processed'
            WHERE slot_dt = $1
              AND status = 'active'
            `, [slotDt]);
                }
                finally {
                    client.release();
                }
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
                console.warn(`[cron] inconsistent location/type_mode for slot=${slotDt}`, { locations, types });
                // 不整合なslotも “処理済み” に倒したいかは議論余地があるので、
                // ここではデグレ回避のため「現状通り：処理せず結果にerrorだけ」。
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
            const { matched, unmatched } = (0, matching_1.computeMatchesForSlot)(entries, history);
            console.log(`[cron] matched groups=${matched.length}, unmatched users=${unmatched.length}`);
            // ⑤ DB 保存（B案: slot単位 processed もここで実施される）
            await (0, matching_1.saveMatchesForSlot)(pool, slotDt, location, typeMode, matched);
            // ⑥ token 付与
            await (0, matching_1.assignTokensForSlot)(pool, slotDt, location, typeMode);
            // ★追加：通知キューに積む
            const enqueueResult = await (0, enqueueLineNotifications_1.enqueueLineNotificationsForSlot)(pool, slotDt);
            console.log(`[cron] line enqueue inserted=${enqueueResult.inserted ?? 0} slot=${slotDt}`);
            // ★追加：即時dispatch（ベストエフォート）
            try {
                const dispatchResult = await (0, dispatchLineNotifications_1.dispatchLineNotifications)(pool, { limit: 10 });
                const sentCount = dispatchResult.processed.filter((p) => p.status === "sent").length;
                const failedCount = dispatchResult.processed.filter((p) => p.status === "failed").length;
                console.log(`[cron] immediate line dispatch slot=${slotDt} picked=${dispatchResult.picked} sent=${sentCount} failed=${failedCount}`);
            }
            catch (e) {
                console.warn(`[cron] immediate line dispatch failed (best effort) slot=${slotDt}:`, e?.message || e);
            }
            results.push({
                slotDt,
                matchedCount: matched.length,
                unmatchedCount: unmatched.length,
                entriesCount: entries.length,
            });
        }
        catch (e) {
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
exports.default = executeMatchCron;
