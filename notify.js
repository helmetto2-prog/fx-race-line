// 任意メッセージをLINEへブロードキャスト（workflow_dispatch「LINE Notify」用）
const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const text = process.env.NOTIFY_MESSAGE || "テスト通知";
(async () => {
  if (!token) { console.log("LINE_CHANNEL_ACCESS_TOKEN 未設定"); process.exit(1); }
  const res = await fetch("https://api.line.me/v2/bot/message/broadcast", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ messages: [{ type: "text", text }] }),
  });
  console.log("LINE broadcast:", res.status, await res.text());
  if (!res.ok) process.exit(1);
})();
