"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const http_1 = __importDefault(require("http"));
const app_1 = __importDefault(require("./app"));
const PORT = Number(process.env.PORT || 3000);
const server = http_1.default.createServer(app_1.default);
server.listen(PORT, () => {
    console.log(`[server] listening on http://localhost:${PORT}`);
    console.log(`[server] FRONT_ORIGIN=${process.env.FRONT_ORIGIN}`);
    console.log(`[server] DEV_FAKE_AUTH=${process.env.DEV_FAKE_AUTH === '1' ? 'ON' : 'OFF'}`);
});
