"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pushLineText = pushLineText;
async function pushLineText(lineChannelAccessToken, to, text) {
    const body = {
        to,
        messages: [{ type: "text", text }],
    };
    const r = await fetch("https://api.line.me/v2/bot/message/push", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${lineChannelAccessToken}`,
        },
        body: JSON.stringify(body),
    });
    if (!r.ok) {
        const t = await r.text().catch(() => "");
        const err = new Error(`line_push_failed:${r.status}:${t.slice(0, 2000)}`);
        err.status = r.status;
        throw err;
    }
}
