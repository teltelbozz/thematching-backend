-- ユーザーの合コン参加プリファレンス（1人/友達と 等）
CREATE TABLE IF NOT EXISTS user_match_prefs (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  participation_style TEXT CHECK (participation_style IN ('solo','with_friend')),
  party_size INTEGER CHECK (party_size >= 1) DEFAULT 1, -- with_friend の時 2 など
  type_mode TEXT CHECK (type_mode IN ('talk','play','either')),
  venue_pref TEXT CHECK (venue_pref IN ('cheap_izakaya','fancy_dining','bar_cafe')),
  cost_pref  TEXT CHECK (cost_pref IN ('men_pay_all','split_even','follow_partner')),
  saved_dates DATE[],  -- 任意: 保存しておく希望日配列
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 需要が多い日(=人気日)を返すための簡易ビュー（直近30日）
-- ここでは slots の同日件数で人気度を算出（必要に応じて users の saved_dates などにも変更可）
CREATE OR REPLACE VIEW popular_days AS
SELECT
  DATE(date_time AT TIME ZONE 'UTC') AS day,
  COUNT(*) AS slot_count
FROM party_slots
WHERE date_time >= NOW() - INTERVAL '1 day' AND date_time < NOW() + INTERVAL '30 day'
GROUP BY 1
ORDER BY 2 DESC, 1 ASC;