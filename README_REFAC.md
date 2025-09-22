
# Backend (Refactored)

This is a refactor of your backend with:
- Centralized config (`src/config`)
- Token service (2-token model) in `src/auth/tokenService.ts`
- LINE id_token verification in `src/auth/lineVerify.ts`
- Repositories layer (`src/repositories/*`)
- Existing routes preserved

## Build & Run locally

```bash
cd backend
npm i
npm run dev
```

## Environment

- FRONT_ORIGIN
- LINE_ISSUER=https://access.line.me
- LINE_CHANNEL_ID=...
- DATABASE_URL=...
- ACCESS_SECRET=...
- REFRESH_SECRET=...
- ACCESS_TTL_SECONDS=600
- REFRESH_TTL_SECONDS=25200
- REFRESH_COOKIE_NAME=rt
- DEBUG_AUTH=0/1
- DEV_FAKE_AUTH=0/1
