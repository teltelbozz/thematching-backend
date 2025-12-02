// src/services/matching/matching.ts
import { Pool } from 'pg';
import { createMatchedGroup } from './createGroup';
import { addHistory } from './history';
import { SCORE_THRESHOLD } from './score';
import { groupAgeScore } from './score';
import { violatesRematch } from './history';

export type RunMatchingParams = {
  db: Pool;
  slotDt: string; // e.g. "2025-11-14T21:00:00+09:00"
};

export type RunMatchingResult = {
  slotDt: string;
  totalCandidates: number;
  chosenGroups: number;
  unmatched: number;
  groups: Array<{
    score: number;
    female: number[];
    male: number[];
    groupId: number;
    token: string;
  }>;
};

/**
 * バッチのメイン処理
 */
export async function runMatchingForSlot(params: RunMatchingParams): Promise<RunMatchingResult> {
  const { db, slotDt } = params;

  // =====================================================
  // 1. この slotDt に関連するユーザー（エントリ済み）を取得
  // =====================================================
  const entrySql = `
    SELECT
      us.user_id,
      up.gender,
      up.age,
      us.type_mode,
      us.location
    FROM user_setup us
    JOIN user_setup_slots sl ON sl.user_setup_id = us.id
    JOIN user_profiles up ON up.user_id = us.user_id
    WHERE sl.slot_dt = $1
  `;

  const entryRes = await db.query(entrySql, [slotDt]);
  const rows = entryRes.rows;

  // 男女分け
  const females = rows.filter(r => r.gender === 'female');
  const males   = rows.filter(r => r.gender === 'male');

  // 男女とも 2 名未満 → マッチング不可
  if (females.length < 2 || males.length < 2) {
    return {
      slotDt,
      totalCandidates: 0,
      chosenGroups: 0,
      unmatched: females.length + males.length,
      groups: [],
    };
  }

  // =====================================================
  // 2. 女性2名組 / 男性2名組 の全通りを作成
  // =====================================================
  function pairs<T>(arr: T[]): [T, T][] {
    const out: [T, T][] = [];
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        out.push([arr[i], arr[j]]);
      }
    }
    return out;
  }

  const fPairs = pairs(females);
  const mPairs = pairs(males);

  // =====================================================
  // 3. 履歴読み込み（男女1対1禁止 / 同性は許容）
  // =====================================================
  const historySql = `
    SELECT user_id_female, user_id_male
    FROM match_history
  `;
  const historyRes = await db.query(historySql);
  const history: Set<string> = new Set(
    historyRes.rows.map(r => `${r.user_id_female}-${r.user_id_male}`)
  );

  // =====================================================
  // 4. スコア計算（年齢ロジックのみ）
  // =====================================================
  type Candidate = {
    fp: number[];    // 女性2名
    mp: number[];    // 男性2名
    score: number;
    tie: number;     // tie-break：女性年齢中央値
  };

  const candidates: Candidate[] = [];

  for (const fp of fPairs as any[]) {
    for (const mp of mPairs as any[]) {

      // 再マッチ禁止（男女の1:1 組み合わせすべて確認）
      if (violatesRematch(fp.map(f => f.user_id), mp.map(m => m.user_id), history)) {
        continue;
      }

      // スコア計算
      const score = groupAgeScore(
        fp.map(f => ({ id: f.user_id, age: Number(f.age) })),
        mp.map(m => ({ id: m.user_id, age: Number(m.age) }))
      );

      if (score >= SCORE_THRESHOLD) {
        const ages = fp.map(f => Number(f.age)).sort((a,b)=>a-b);
        const medianAge = ages[1]; // 2人組なので2番目

        candidates.push({
          fp: fp.map(f => f.user_id),
          mp: mp.map(m => m.user_id),
          score,
          tie: medianAge,
        });
      }
    }
  }

  // =====================================================
  // 5. スコア降順 → tie（女性中央値）昇順
  // =====================================================
  candidates.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    return a.tie - b.tie;
  });

  // =====================================================
  // 6. Greedyに非重複グループを確定
  // =====================================================
  const used = new Set<number>();
  const chosen: Candidate[] = [];

  for (const c of candidates) {
    const users = [...c.fp, ...c.mp];

    // 4人すべて未使用なら採択
    if (users.every(uid => !used.has(uid))) {
      chosen.push(c);
      users.forEach(uid => used.add(uid));
    }
  }

  // =====================================================
  // 7. グループを DB に保存 (createMatchedGroup)
  // =====================================================
  const results: RunMatchingResult["groups"] = [];

  for (const c of chosen) {
    const group = await createMatchedGroup({
      db,
      slotDt,
      location: 'shibuya_shinjuku',
      typeMode: 'wine_talk', // type_mode は女性側に合わせるなど後続仕様
      fPair: c.fp,
      mPair: c.mp,
    });

    // 男女1対1 の履歴を登録
    await addHistory(db, c.fp, c.mp, slotDt);

    results.push({
      score: c.score,
      female: c.fp,
      male: c.mp,
      groupId: group.id,
      token: group.token,
    });
  }

  // =====================================================
  // 8. 未成立数
  // =====================================================
  const allUserIds = rows.map(r => r.user_id);
  const unmatched = allUserIds.filter(uid => !used.has(uid));

  return {
    slotDt,
    totalCandidates: candidates.length,
    chosenGroups: chosen.length,
    unmatched: unmatched.length,
    groups: results,
  };
}