-- ========================================
-- Table: user_match_prefs
-- 目的：合コンなどの希望条件を保存
-- ========================================

CREATE TABLE IF NOT EXISTS user_match_prefs (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,

  -- 基本条件
  purpose TEXT CHECK (purpose IN ('friend', 'dating', 'party', 'serious')),
  partner_age_min INT CHECK (partner_age_min >= 18 AND partner_age_min <= 80),
  partner_age_max INT CHECK (partner_age_max >= 18 AND partner_age_max <= 80),
  partner_gender TEXT CHECK (partner_gender IN ('male', 'female', 'any')),

  -- タグ系
  partner_personality_tags TEXT[],
  partner_atmosphere_tags TEXT[],
  partner_style_tags TEXT[],

  -- 日時・場所
  preferred_slots JSONB,
  areas TEXT[],
  venue_types TEXT[],

  -- 金銭・人数関連
  pay_policy TEXT CHECK (pay_policy IN ('male_pays', 'split', 'flex')),
  party_size INT CHECK (party_size BETWEEN 1 AND 4),
  allow_friends BOOLEAN,

  -- クーポン／課金
  use_intro_free BOOLEAN DEFAULT false,
  auto_subscribe_ack BOOLEAN DEFAULT false,

  -- 拡張用
  priority_weights JSONB,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 更新時刻自動更新トリガー
CREATE OR REPLACE FUNCTION set_updated_at_match_prefs()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_updated_at_match_prefs ON user_match_prefs;

CREATE TRIGGER trg_set_updated_at_match_prefs
BEFORE UPDATE ON user_match_prefs
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_match_prefs();