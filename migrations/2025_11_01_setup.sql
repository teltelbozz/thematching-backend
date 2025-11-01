-- migrations/2025_11_01_setup.sql
-- 合コン条件（第一条件）保存用

CREATE TABLE IF NOT EXISTS user_setup (
  id              BIGSERIAL PRIMARY KEY,
  user_id         BIGINT NOT NULL,
  week_key        TEXT NOT NULL, -- 例: 2025-W44（週単位のキー。将来の集計・クエリ最適化用）
  type_mode       TEXT NOT NULL CHECK (type_mode IN ('wine_talk','wine_and_others')),
  location        TEXT NOT NULL DEFAULT 'shibuya_shinjuku',
  cost_pref       TEXT NOT NULL CHECK (cost_pref IN ('men_pay_all','split_even','follow_partner')),
  venue_pref      TEXT NULL,     -- v2.6は固定: NULLで運用。将来のために確保
  submitted_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_setup_userid_submitted
  ON user_setup(user_id, submitted_at DESC);

-- スロットはTIMESTAMPTZ（JST前提で解釈して保存）
CREATE TABLE IF NOT EXISTS user_setup_slots (
  id              BIGSERIAL PRIMARY KEY,
  user_setup_id   BIGINT NOT NULL REFERENCES user_setup(id) ON DELETE CASCADE,
  slot_dt         TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_setup_slots_setupid
  ON user_setup_slots(user_setup_id);

CREATE INDEX IF NOT EXISTS idx_user_setup_slots_slotdt
  ON user_setup_slots(slot_dt);

-- 週単位に1レコードへ寄せたい場合はユニーク制約（同一週・同一ユーザで最新を上書き運用）
-- ALTER TABLE user_setup ADD CONSTRAINT uq_user_week UNIQUE(user_id, week_key);