"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/app.ts
const express_1 = __importDefault(require("express"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const cors_1 = __importDefault(require("cors"));
const morgan_1 = __importDefault(require("morgan"));
const config_1 = __importDefault(require("./config"));
const me_1 = __importDefault(require("./routes/me"));
const matchPrefs_1 = __importDefault(require("./routes/matchPrefs"));
const setup_1 = __importDefault(require("./routes/setup"));
const requireAuth_1 = __importDefault(require("./middleware/requireAuth"));
const groups_1 = __importDefault(require("./routes/groups"));
const cron_1 = __importDefault(require("./routes/cron"));
const matchingResult_1 = __importDefault(require("./routes/matchingResult"));
const path_1 = __importDefault(require("path"));
const adminUsers_1 = __importDefault(require("./routes/adminUsers"));
const adminUserDetail_1 = __importDefault(require("./routes/adminUserDetail"));
const db_1 = require("./db");
const auth_1 = __importDefault(require("./routes/auth"));
const profile_1 = __importDefault(require("./routes/profile"));
const terms_1 = __importDefault(require("./routes/terms"));
// ★ 追加：Blob routes
const blob_1 = __importDefault(require("./routes/blob"));
// ★ グループページ
const groupPublic_1 = __importDefault(require("./routes/groupPublic"));
// ★ 管理画面：グループお知らせ更新
const adminGroupAnnouncement_1 = __importDefault(require("./routes/adminGroupAnnouncement"));
const adminGroups_1 = __importDefault(require("./routes/adminGroups"));
// ★ LINE通知キュー処理  
const cronLineDispatch_1 = __importDefault(require("./routes/cronLineDispatch"));
const app = (0, express_1.default)();
// Vercel/プロキシ越しでも Secure Cookie を有効化
app.set("trust proxy", 1);
// ★ DB
app.locals.db = db_1.pool;
app.use((0, morgan_1.default)("combined"));
app.use(express_1.default.json());
app.use((0, cookie_parser_1.default)());
app.use((0, cors_1.default)({
    origin: config_1.default.frontOrigin,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-cleanup-token"],
}));
app.get("/api/health", (_req, res) => {
    res.json({ ok: true, env: config_1.default.env, build: process.env.VERCEL_GIT_COMMIT_SHA });
});
app.use("/api/auth", auth_1.default);
app.use("/api/profile", profile_1.default);
// 規約
app.use("/api/terms", terms_1.default);
// ★ 追加：Blob（アップロード/クリーンアップ）
app.use("/api/blob", requireAuth_1.default, blob_1.default);
app.use("/api/me", me_1.default);
app.use("/api/match-prefs", matchPrefs_1.default);
app.use("/api/setup", requireAuth_1.default, setup_1.default);
app.use("/api/groups", groups_1.default); // ★フロントのAPI_BASEが /api 前提なら必須
app.use("/groups", groups_1.default); // ★既存互換（残したいなら）
app.use("/cron", cron_1.default);
app.use("/admin", matchingResult_1.default);
app.use("/admin", adminUsers_1.default);
app.use("/admin", adminUserDetail_1.default);
// dist/public を参照
app.use(express_1.default.static(path_1.default.join(__dirname, "public")));
// ★ グループページ（完全共有型）
app.use("/api/g", groupPublic_1.default);
app.use("/api/admin", adminGroupAnnouncement_1.default);
app.use("/admin", adminGroups_1.default);
//LINE通知キュー処理  
app.use("/cron", cron_1.default);
app.use("/cron", cronLineDispatch_1.default);
app.use("/api/cron", cron_1.default);
app.use("/api/cron", cronLineDispatch_1.default);
exports.default = app;
