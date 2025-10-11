-- ユーザプロフィールの拡張
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS age INTEGER,
  ADD COLUMN IF NOT EXISTS gender TEXT,
  ADD COLUMN IF NOT EXISTS occupation TEXT,
  ADD COLUMN IF NOT EXISTS photo_masked_url TEXT,
  ADD COLUMN IF NOT EXISTS verified_age BOOLEAN DEFAULT false NOT NULL;

-- 決済の有無（ダミー用）：ユーザ単位で“登録済みフラグ”のみ
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS payment_method_set BOOLEAN DEFAULT false NOT NULL;