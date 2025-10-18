## 目的
- 変更の概要

## 変更点
- 例）`backend/src/routes/profile.ts` の GET/PUT 修正
- 例）`frontend/src/liff.ts` のログイン後遷移処理の見直し

## 影響範囲チェック（必須）
- [ ] ルーティング整合：`backend/src/app.ts` と一致（`/api/auth`, `/api/profile`）
- [ ] CORS/Cookie：`credentials:'include'` 済み、`SameSite/secure/path` 設定の意図を記載
- [ ] LIFF ログイン：`whenAuthReady()` 待ち→ `/profile` or `/setup` の遷移確認
- [ ] `vercel.json` or プロジェクト設定：rewrite/headers の差分があれば説明
- [ ] DEV_FAKE_AUTH=1 でのローカル動作確認（curl のサンプルを記載）
- [ ] DB を使うルートの例外対応（`app.locals.db` が未設定時のハンドリング）

## 動作確認
- スクショ/Network タブのログ要点

## ロールバック方法
- `git revert` or `git checkout vX.Y` 手順明記
