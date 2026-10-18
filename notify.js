// 任意メッセージ＋画像を義樹さんへ送る（workflow_dispatch / repository_dispatch「LINE Notify」用）
// 2026-10-13 義樹さん指示：broadcast（友だち全員）→ push（義樹さんだけ）に変更。
//   協力者日報で業者さん（いろは苑 北川さん）が同じ公式アカウントを友だち追加したため、まとん・へるさんの通知が業者さんにも届いていた。
//   宛先は LINE_TO（環境変数）があればそれ、無ければ義樹さんの userId。
// 2026-10-18 義樹さん指示：義樹さん宛ての知らせは LINE WORKS の「みどり造園ボット」へ移す。
//   LINE の公式アカウント（みどり造園 協力者日報）は業者さん専用にする（月200通の枠を業者さんの日報に残すため）。
//   ・LW_CLIENT_ID / LW_CLIENT_SECRET / LW_SERVICE_ACCOUNT / LW_PRIVATE_KEY / LW_BOT_ID が全部そろっていれば LINE WORKS へ送る。
//     宛先は LW_TO（無ければ義樹さんの LINE WORKS ID）。鍵は有給アプリの GAS と同じボットの物（GitHub Secrets に入れる）。
//   ・そろっていない時、または LINE WORKS で失敗した時だけ、今までの LINE（push）へ回す＝予備の道。
//   ・鍵・トークンはログに出さない。
// 入力欄は1行テキストで改行が消えるため、文中の「\n」を本物の改行に変換する。
// ※URLは前後に改行かスペースを置くこと（直後に日本語が続くとリンクが壊れてスマホで開けない）
//
// 画像送信（NOTIFY_IMAGES）:
//   カンマ / 空白 / 改行 区切りで https の画像URLを並べる。並べた順にトークへ届く。
//   「本画像|サムネ画像」と縦棒で書くとサムネを分けられる（省略時は同じURL）。
//   例) https://.../00.jpg|https://.../00_s.jpg, https://.../01.jpg|https://.../01_s.jpg
//   LINEの制限: 1リクエスト5メッセージまで・JPEG/PNG・10MB以下 → 5枚ずつに分けて順番に送る。
//   LINE WORKS: 1枚ずつ image で送る（previewImageUrl / originalContentUrl）。
const crypto = require("crypto");

const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const to = (process.env.LINE_TO || "U9ca3bbfdcde67012c023af08e8e1569d").trim();
const text = (process.env.NOTIFY_MESSAGE || "").replace(/\n/g, "\n").trim();
const images = (process.env.NOTIFY_IMAGES || "")
  .split(/[\s,]+/)
  .map((s) => s.trim())
  .filter((s) => /^https:\/\//.test(s))
  .map((s) => {
    const [orig, prev] = s.split("|");
    return { orig, prev: prev || orig };
  });

const env = (k) => (process.env[k] || "").trim();
const LW = {
  clientId: env("LW_CLIENT_ID"),
  clientSecret: env("LW_CLIENT_SECRET"),
  serviceAccount: env("LW_SERVICE_ACCOUNT"),
  privateKey: process.env.LW_PRIVATE_KEY || "",
  botId: env("LW_BOT_ID"),
  to: env("LW_TO") || "yoshiki@midori-zoen",
};
const lwReady = !!(LW.clientId && LW.clientSecret && LW.serviceAccount && LW.privateKey.trim() && LW.botId);

// ---------- LINE（予備の道・2026-10-13 からの push そのまま） ----------
const linePost = async (messages) => {
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ to, messages }),
  });
  const body = await res.text();
  console.log("LINE push:", res.status, body);
  if (!res.ok) process.exit(1);
};
const sendLine = async (t, imgs) => {
  if (!token) { console.log("LINE_CHANNEL_ACCESS_TOKEN 未設定"); process.exit(1); }
  const lineImages = imgs.map((m) => ({ type: "image", originalContentUrl: m.orig, previewImageUrl: m.prev }));
  if (t) await linePost([{ type: "text", text: t }]);
  for (let i = 0; i < lineImages.length; i += 5) {
    await linePost(lineImages.slice(i, i + 5));
  }
  console.log(`送信完了（LINE）: 本文${t ? 1 : 0}通 / 画像${imgs.length}枚`);
};

// ---------- LINE WORKS（本番の道） ----------
const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
// GAS 側の normalizeKey_ と同じ：1行に詰まった鍵や「\n」と書かれた鍵も PEM に戻す
const normalizeKey = (k) => {
  k = k.replace(/\\n/g, "\n").trim();
  if (k.includes("\n")) return k;
  const body = k.replace("-----BEGIN PRIVATE KEY-----", "").replace("-----END PRIVATE KEY-----", "").replace(/\s+/g, "");
  return "-----BEGIN PRIVATE KEY-----\n" + body.match(/.{1,64}/g).join("\n") + "\n-----END PRIVATE KEY-----";
};
const lwToken = async () => {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({ iss: LW.clientId, sub: LW.serviceAccount, iat: now, exp: now + 3600 }));
  const sig = crypto.createSign("RSA-SHA256").update(`${head}.${claim}`).sign(normalizeKey(LW.privateKey));
  const res = await fetch("https://auth.worksmobile.com/oauth2/v2.0/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      assertion: `${head}.${claim}.${b64url(sig)}`,
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      client_id: LW.clientId,
      client_secret: LW.clientSecret,
      scope: "bot",
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (!j.access_token) throw new Error(`token ${res.status} ${j.code || j.error || ""} ${j.description || j.error_description || ""}`.trim());
  return j.access_token;
};
const lwPost = async (at, content) => {
  const url = `https://www.worksapis.com/v1.0/bots/${encodeURIComponent(LW.botId)}/users/${encodeURIComponent(LW.to)}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${at}` },
    body: JSON.stringify({ content }),
  });
  const body = await res.text();
  console.log("LINE WORKS:", res.status, content.type, body.slice(0, 200));
  if (!res.ok) throw new Error(`send ${res.status} ${body.slice(0, 200)}`);
};
// 送れた所までを返す（途中で失敗したら、残りだけを LINE へ回すため）
const sendLW = async (done) => {
  const at = await lwToken();
  if (text && !done.text) { await lwPost(at, { type: "text", text }); done.text = true; }
  for (; done.img < images.length; done.img++) {
    const m = images[done.img];
    await lwPost(at, { type: "image", previewImageUrl: m.prev, originalContentUrl: m.orig });
  }
  console.log(`送信完了（LINE WORKS）: 本文${text ? 1 : 0}通 / 画像${images.length}枚`);
};

(async () => {
  if (!text && images.length === 0) { console.log("本文も画像も無し"); process.exit(1); }
  if (lwReady) {
    const done = { text: false, img: 0 };
    try {
      await sendLW(done);
      return;
    } catch (e) {
      console.log("LINE WORKS 失敗 → LINE へ回す:", String(e.message || e).slice(0, 300));
      // 送れた分は LINE で二重に送らない
      if (done.text) { console.log("（本文は LINE WORKS に届いた・残りの画像だけ LINE へ）"); }
      const restText = done.text ? "" : text;
      const restImages = images.slice(done.img);
      if (!restText && restImages.length === 0) return;
      return sendLine(restText, restImages);
    }
  }
  await sendLine(text, images);
})();

