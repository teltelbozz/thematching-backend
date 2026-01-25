// src/lib/linePush.ts
type LinePushMessage = { type: "text"; text: string };

export async function pushLineText(
  lineChannelAccessToken: string,
  to: string,
  text: string
) {
  const body = {
    to,
    messages: [{ type: "text", text } satisfies LinePushMessage],
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
    (err as any).status = r.status;
    throw err;
  }
}