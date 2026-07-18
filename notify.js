// 任意メッセージをLINEへブロードキャスト（workflow_dispatch「LINE Notify」用）
// 入力欄は1行テキストで改行が消えるため、文中の「\n」を本物の改行に変換する。
// ※URLは前後に改行かスペースを置くこと（直後に日本語が続くとリンクが壊れてスマホで開けない）
const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const text = (process.env.NOTIFY_MESSAGE || "テスト通知").replace(/\\n/g, "\n");
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
