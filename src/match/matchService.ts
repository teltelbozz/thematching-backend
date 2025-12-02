// src/match/matchService.ts
import type { Pool } from "pg";
import { runMatching } from "./matchEngine"; // Step4で作ったロジック

export interface MatchJobResult {
  slot_dt: string;
  location: string;
  type_mode: string;
  created_groups: number;
  matched_user_ids: number[];
  unmatched_user_ids: number[];
}

/**
 * 翌日スロットのマッチングを実行する。
 * 
 * 1. 翌日分の user_setup / user_setup_slots を抽出
 * 2. slot_dt × location × type_mode ごとにマッチング
 * 3. matched_groups / matched_group_members / match_history を更新
 */
export async function runDailyMatching(db: Pool): Promise<MatchJobResult[]> {
  // バッチ実行日の JST 今日
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const yyyy = jst.getUTCFullYear();
  const mm = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(jst.getUTCDate()).padStart(2, "0");
  const todayJST = `${yyyy}-${mm}-${dd}`;

  // 翌日
  const nextDay = new Date(jst.getTime() + 24 * 60 * 60 * 1000);
  const y2 = nextDay.getUTCFullYear();
  const m2 = String(nextDay.getUTCMonth() + 1).padStart(2, "0");
  const d2 = String(nextDay.getUTCDate()).padStart(2, "0");
  const tomorrow = `${y2}-${m2}-${d2}`;

  console.log("[matchService] tomorrow =", tomorrow);

  // 翌日の slot_dt をすべて取得（19:00,21:00 など）
  const slotRes = await db.query(
    `
      SELECT DISTINCT slot_dt
      FROM user_setup_slots
      WHERE slot_dt::date = $1::date
      ORDER BY slot_dt
    `,
    [tomorrow]
  );

  if (slotRes.rows.length === 0) {
    console.log("[matchService] no slots found");
    return [];
  }

  const results: MatchJobResult[] = [];

  // スロットごとに実行
  for (const row of slotRes.rows) {
    const slot_dt: string = row.slot_dt;

    // slot_dt × location × type_mode ごとにユーザー取得
    const peopleRes = await db.query(
      `
        SELECT 
          us.user_id,
          us.type_mode,
          us.location,
          up.gender,
          up.age
        FROM user_setup us
        JOIN user_setup_slots sl ON sl.user_setup_id = us.id
        JOIN user_profiles up ON up.user_id = us.user_id
        WHERE sl.slot_dt = $1
      `,
      [slot_dt]
    );

    if (peopleRes.rows.length === 0) continue;

    // location × type_mode ごとにグループ化
    const map = new Map<string, any[]>();
    for (const u of peopleRes.rows) {
      const key = `${u.location}|${u.type_mode}`;
      const arr = map.get(key) || [];
      arr.push(u);
      map.set(key, arr);
    }

    for (const [key, users] of map.entries()) {
      const [location, type_mode] = key.split("|");

      // マッチングロジック実行
      const { groups, unmatched } = runMatching(users);

      console.log(
        `[matchService] slot=${slot_dt} loc=${location} type=${type_mode} ⇒ groups: ${groups.length}`
      );

      // 保存
      const createdIds: number[] = [];

      for (const g of groups) {
        // matched_groups
        const mgRes = await db.query(
          `
            INSERT INTO matched_groups (slot_dt, location, type_mode, status)
            VALUES ($1, $2, $3, 'pending')
            RETURNING id
          `,
          [slot_dt, location, type_mode]
        );

        const groupId = mgRes.rows[0].id;
        createdIds.push(groupId);

        // メンバー登録
        for (const f of g.female_ids) {
          await db.query(
            `INSERT INTO matched_group_members (group_id, user_id, gender)
             VALUES ($1, $2, 'female')`,
            [groupId, f]
          );
        }
        for (const m of g.male_ids) {
          await db.query(
            `INSERT INTO matched_group_members (group_id, user_id, gender)
             VALUES ($1, $2, 'male')`,
            [groupId, m]
          );
        }

        // 履歴登録（再マッチ禁止用）
        for (const f of g.female_ids) {
          for (const m of g.male_ids) {
            await db.query(
              `INSERT INTO match_history (user_id_female, user_id_male, slot_dt)
               VALUES ($1, $2, $3)
               ON CONFLICT DO NOTHING`,
              [f, m, slot_dt]
            );
          }
        }
      }

      results.push({
        slot_dt,
        location,
        type_mode,
        created_groups: createdIds.length,
        matched_user_ids: groups.flatMap((g) => [...g.female_ids, ...g.male_ids]),
        unmatched_user_ids: unmatched.map((u) => u.user_id)
      });
    }
  }

  return results;
}