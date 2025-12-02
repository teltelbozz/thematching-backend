-- ------------------------------------------------------
--  matched_groups（グループ本体）
-- ------------------------------------------------------
CREATE TABLE IF NOT EXISTS matched_groups (
  id              BIGSERIAL PRIMARY KEY,

  -- マッチしたスロット（日時）
  slot_dt         TIMESTAMPTZ NOT NULL,

  -- エリア（例: shibuya_shinjuku）
  location        TEXT NOT NULL,

  -- 会のタイプ
  type_mode       TEXT NOT NULL CHECK (type_mode IN ('wine_talk','wine_and_others')),

  -- グループページにアクセスするための一時トークン
  token           TEXT NOT NULL UNIQUE,

  -- 店予約ステータス
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','reserved','completed')),

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_matched_groups_slotdt
  ON matched_groups(slot_dt);

CREATE INDEX IF NOT EXISTS idx_matched_groups_status
  ON matched_groups(status);


-- ------------------------------------------------------
--  matched_group_members（4人の参加者）
-- ------------------------------------------------------
CREATE TABLE IF NOT EXISTS matched_group_members (
  group_id        BIGINT NOT NULL REFERENCES matched_groups(id) ON DELETE CASCADE,
  user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gender          TEXT NOT NULL CHECK (gender IN ('male','female')),

  PRIMARY KEY (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_matched_group_members_group_id
  ON matched_group_members(group_id);

CREATE INDEX IF NOT EXISTS idx_matched_group_members_user_id
  ON matched_group_members(user_id);