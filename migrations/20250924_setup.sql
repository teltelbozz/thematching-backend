-- ユーザーごとの直近の合コン設定を保存するテーブル（上書き式・1ユーザー1行）
CREATE TABLE IF NOT EXISTS user_match_setup (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  participation_style TEXT CHECK (participation_style IN ('solo', 'with_friend')),
  party_size INTEGER CHECK (party_size >= 1 AND party_size <= 4),
  desired_date DATE, -- 参加希望日（YYYY-MM-DD）
  type_mode TEXT CHECK (type_mode IN ('talk','play','either')),
  venue_pref TEXT CHECK (venue_pref IN ('cheap_izakaya','fancy_dining','bar_cafe')),
  cost_pref  TEXT CHECK (cost_pref  IN ('men_pay_all','split_even','follow_partner')),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 既存環境向けに、足りない列があれば追加（安全に何度流してもOK）
ALTER TABLE user_match_setup
  ADD COLUMN IF NOT EXISTS participation_style TEXT,
  ADD COLUMN IF NOT EXISTS party_size INTEGER,
  ADD COLUMN IF NOT EXISTS desired_date DATE,
  ADD COLUMN IF NOT EXISTS type_mode TEXT,
  ADD COLUMN IF NOT EXISTS venue_pref TEXT,
  ADD COLUMN IF NOT EXISTS cost_pref  TEXT;