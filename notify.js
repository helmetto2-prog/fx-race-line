// 任意メッセージ＋画像をLINEへブロードキャスト（workflow_dispatch「LINE Notify」用）
// 入力欄は1行テキストで改行が消えるため、文中の「\n」を本物の改行に変換する。
// ※URLは前後に改行かスペースを置くこと（直後に日本語が続くとリンクが壊れてスマホで開けない）
//
// 画像送信（NOTIFY_IMAGES）:
//   カンマ / 空白 / 改行 区切りで https の画像URLを並べる。並べた順にトークへ届く。
//   「本画像|サムネ画像」と縦棒で書くとサムネを分けられる（省略時は同じURL）。
//   例) https://.../00.jpg|https://.../00_s.jpg, https://.../01.jpg|https://.../01_s.jpg
//   LINEの制限: 1リクエスト5メッセージまで・JPEG/PNG・10MB以下 → 5枚ずつに分けて順番に送る。
const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const text = (process.env.NOTIFY_MESSAGE || "").replace(/\n/g, "\n").trim();
const images = (process.env.NOTIFY_IMAGES || "")
  .split(/[\s,]+/)
  .map((s) => s.trim())
  .filter((s) => /^https:\/\//.test(s))
  .map((s) => {
    const [orig, prev] = s.split("|");
    return { type: "image", originalContentUrl: orig, previewImageUrl: prev || orig };
  });

const post = async (messages) => {
  const res = await fetch("https://api.line.me/v2/bot/message/broadcast", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ messages }),
  });
  const body = await res.text();
  console.log("LINE broadcast:", res.status, body);
  if (!res.ok) process.exit(1);
};

(async () => {
  if (!token) { console.log("LINE_CHANNEL_ACCESS_TOKEN 未設定"); process.exit(1); }
  if (!text && images.length === 0) { console.log("本文も画像も無し"); process.exit(1); }
  if (text) await post([{ type: "text", text }]);
  for (let i = 0; i < images.length; i += 5) {
    await post(images.slice(i, i + 5));
  }
  console.log(`送信完了: 本文${text ? 1 : 0}通 / 画像${images.length}枚`);
})();
