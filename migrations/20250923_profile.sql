-- user_profiles の拡張（なければ作成）
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  nickname TEXT,
  age INTEGER,
  gender TEXT,
  occupation TEXT,
  photo_url TEXT,
  photo_masked_url TEXT,
  verified_age BOOLEAN DEFAULT false NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 追加カラム（既存環境用）
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS nickname TEXT,
  ADD COLUMN IF NOT EXISTS age INTEGER,
  ADD COLUMN IF NOT EXISTS gender TEXT,
  ADD COLUMN IF NOT EXISTS occupation TEXT,
  ADD COLUMN IF NOT EXISTS photo_url TEXT,
  ADD COLUMN IF NOT EXISTS photo_masked_url TEXT,
  ADD COLUMN IF NOT EXISTS verified_age BOOLEAN DEFAULT false NOT NULL;

-- 決済ダミーフラグ（未追加なら）
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS payment_method_set BOOLEAN DEFAULT false NOT NULL;