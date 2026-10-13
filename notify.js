// 任意メッセージ＋画像をLINEへ送る（workflow_dispatch「LINE Notify」用）
// 2026-10-13 義樹さん指示：broadcast（友だち全員）→ push（義樹さんだけ）に変更。
//   協力者日報で業者さん（いろは苑 北川さん）が同じ公式アカウントを友だち追加したため、まとん・へるさんの通知が業者さんにも届いていた。
//   宛先は LINE_TO（環境変数）があればそれ、無ければ義樹さんの userId。
// 入力欄は1行テキストで改行が消えるため、文中の「\n」を本物の改行に変換する。
// ※URLは前後に改行かスペースを置くこと（直後に日本語が続くとリンクが壊れてスマホで開けない）
//
// 画像送信（NOTIFY_IMAGES）:
//   カンマ / 空白 / 改行 区切りで https の画像URLを並べる。並べた順にトークへ届く。
//   「本画像|サムネ画像」と縦棒で書くとサムネを分けられる（省略時は同じURL）。
//   例) https://.../00.jpg|https://.../00_s.jpg, https://.../01.jpg|https://.../01_s.jpg
//   LINEの制限: 1リクエスト5メッセージまで・JPEG/PNG・10MB以下 → 5枚ずつに分けて順番に送る。
const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const to = (process.env.LINE_TO || "U9ca3bbfdcde67012c023af08e8e1569d").trim();
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
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ to, messages }),
  });
  const body = await res.text();
  console.log("LINE push:", res.status, body);
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
