-- A. matched_groups（グループ本体）
CREATE TABLE IF NOT EXISTS matched_groups (
  id              BIGSERIAL PRIMARY KEY,
  slot_dt         TIMESTAMPTZ NOT NULL,
  location        TEXT NOT NULL,
  type_mode       TEXT NOT NULL CHECK (type_mode IN ('wine_talk','wine_and_others')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_matched_groups_slot
  ON matched_groups(slot_dt);

-- B. matched_group_members（構成メンバー）
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