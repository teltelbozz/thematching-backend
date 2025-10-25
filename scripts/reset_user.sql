-- scripts/reset_user.sql
-- 使い方（最低限 line_id を渡してください）
--   psql "$DATABASE_URL" -v line_id='Uxxxxxxxxxxxxxxxxxxxxxxxxxxxx' -f scripts/reset_user.sql
--
-- ドライラン（実際には削除せず件数だけ確認）:
--   psql "$DATABASE_URL" -v line_id='Uxxxxxxxx...' -v dry_run=1 -f scripts/reset_user.sql
--
-- 注意:
-- - このスクリプトは `users` / `user_profiles` を想定しています。
-- - 追加テーブルがある場合は、下の「OPTIONAL: 追加テーブル」の DO ブロック内に追記してください。

\set ON_ERROR_STOP 1
\echo '--- reset_user.sql start ---'

-- 必須パラメータ: line_id
\if :{?line_id}
\else
  \echo 'ERROR: You must pass -v line_id=...'
  \quit 1
\endif

BEGIN;

-- 対象ユーザーの id を一時テーブルに集約
DROP TABLE IF EXISTS tmp_targets;
CREATE TEMP TABLE tmp_targets (id bigint PRIMARY KEY);

INSERT INTO tmp_targets (id)
SELECT id
FROM users
WHERE line_user_id = :'line_id';

-- 安全確認：該当ユーザーがいないなら中断
DO $$
BEGIN
  IF (SELECT COUNT(*) FROM tmp_targets) = 0 THEN
    RAISE EXCEPTION 'No users found for line_user_id=%', :'line_id';
  END IF;
END$$;

-- 件数の確認
\echo 'Target user ids:'
TABLE tmp_targets;

-- 依存テーブル（存在すれば）から削除していく
-- 1) プロフィール
DELETE FROM user_profiles
WHERE user_id IN (SELECT id FROM tmp_targets);
\echo 'deleted from user_profiles: ' :ROW_COUNT

-- 2) OPTIONAL: 追加テーブルがあればここで安全に削除
--   - 存在確認 → 動的 DELETE を実行
DO $$
DECLARE
  sql text;
BEGIN
  -- 例: マッチング、チャット、決済ログ等がある場合のサンプル
  -- テーブルがなければスキップされます。

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='matches') THEN
    sql := 'DELETE FROM public.matches WHERE user_id IN (SELECT id FROM tmp_targets) OR partner_id IN (SELECT id FROM tmp_targets)';
    EXECUTE sql;
    RAISE NOTICE 'deleted from matches: %', ROW_COUNT;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='chats') THEN
    sql := 'DELETE FROM public.chats WHERE sender_id IN (SELECT id FROM tmp_targets) OR receiver_id IN (SELECT id FROM tmp_targets)';
    EXECUTE sql;
    RAISE NOTICE 'deleted from chats: %', ROW_COUNT;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='payments') THEN
    sql := 'DELETE FROM public.payments WHERE user_id IN (SELECT id FROM tmp_targets)';
    EXECUTE sql;
    RAISE NOTICE 'deleted from payments: %', ROW_COUNT;
  END IF;

  -- 必要に応じて、他の従属テーブルをここに追記してください。
END$$;

-- 3) ユーザ本体
DELETE FROM users
WHERE id IN (SELECT id FROM tmp_targets);
\echo 'deleted from users: ' :ROW_COUNT

-- dry-run の場合はロールバック、それ以外はコミット
\if :{?dry_run}
  \if :dry_run
    ROLLBACK;
    \echo '--- DRY RUN (rolled back) ---'
  \else
    COMMIT;
    \echo '--- committed ---'
  \endif
\else
  COMMIT;
  \echo '--- committed ---'
\endif

\echo '--- reset_user.sql done ---'