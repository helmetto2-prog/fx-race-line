// 任意メッセージ＋画像を義樹さんへ送る（workflow_dispatch / repository_dispatch「LINE Notify」用）
// 2026-10-13 義樹さん指示：broadcast（友だち全員）→ push（義樹さんだけ）に変更。
// 2026-10-18 義樹さん指示：義樹さん宛ての知らせは LINE WORKS の「みどり造園ボット」へ移す。
//   LINE の公式アカウント（みどり造園 協力者日報）は業者さん専用にする（月200通の枠を業者さんの日報に残すため）。
//   ・LW_CLIENT_ID / LW_CLIENT_SECRET / LW_SERVICE_ACCOUNT / LW_PRIVATE_KEY / LW_BOT_ID の5つで LINE WORKS へ送る。
//     宛先は LW_TO（無ければ義樹さんの LINE WORKS ID）。鍵は有給アプリの GAS と同じボットの物（GitHub Secrets に入れる）。
//   ・鍵・トークンはログに出さない。
// 2026-11-02 義樹さん指示「LINEはやめておいて。基本的にラインワークスのみでお願いします。私への連絡は」：
//   LINE への予備の道をやめた。鍵がそろっていない時・LINE WORKS で失敗した時は送らずに、
//   ログにわけを残して終了コード1（Actions の run が失敗になる）。
//   長い本文は LINE WORKS の字数の上限（content.text・2000字）で断られていた（10/31・11/1 の 6:40 のまとめ）ので、
//   行の切れ目で 1800字までに分けて順に送る。それでも長いと断られたら、その1通をさらに半分に分けて送り直す。
// 入力欄は1行テキストで改行が消えるため、文中の「\n」を本物の改行に変換する。
// ※URLは前後に改行かスペースを置くこと（直後に日本語が続くとリンクが壊れてスマホで開けない）
//
// 画像送信（NOTIFY_IMAGES）:
//   カンマ / 空白 / 改行 区切りで https の画像URLを並べる。並べた順にトークへ届く。
//   「本画像|サムネ画像」と縦棒で書くとサムネを分けられる（省略時は同じURL）。
//   例) https://.../00.jpg|https://.../00_s.jpg, https://.../01.jpg|https://.../01_s.jpg
//   LINE WORKS: 1枚ずつ image で送る（previewImageUrl / originalContentUrl）。
const crypto = require("crypto");

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
const lwMissing = [
  ["LW_CLIENT_ID", LW.clientId], ["LW_CLIENT_SECRET", LW.clientSecret], ["LW_SERVICE_ACCOUNT", LW.serviceAccount],
  ["LW_PRIVATE_KEY", LW.privateKey.trim()], ["LW_BOT_ID", LW.botId],
].filter(([, v]) => !v).map(([k]) => k);

const TEXT_MAX = 1800;   // LINE WORKS の上限 2000字より少し手前
const TEXT_MIN = 50;     // 半分に分けるのはここまで

// 行の切れ目で max 字までに分ける（1行が max より長い時だけ行の途中で切る）
const splitText = (t, max) => {
  const parts = [];
  let cur = "";
  for (const line of t.split("\n")) {
    const add = cur ? cur + "\n" + line : line;
    if (add.length <= max) { cur = add; continue; }
    if (cur) parts.push(cur);
    let rest = line;
    while (rest.length > max) { parts.push(rest.slice(0, max)); rest = rest.slice(max); }
    cur = rest;
  }
  if (cur) parts.push(cur);
  return parts;
};

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
  console.log("LINE WORKS:", res.status, content.type, content.type === "text" ? `${content.text.length}字` : "", body.slice(0, 200));
  if (!res.ok) {
    const e = new Error(`send ${res.status} ${body.slice(0, 200)}`);
    e.tooLong = /EXCEEDED_LENGTH_LIMIT/.test(body);
    throw e;
  }
};
// 本文1通：字数の上限で断られたら半分に分けて送り直す
const lwText = async (at, t) => {
  try {
    await lwPost(at, { type: "text", text: t });
    return 1;
  } catch (e) {
    if (!e.tooLong || t.length <= TEXT_MIN) throw e;
    const half = splitText(t, Math.ceil(t.length / 2));
    console.log(`（長すぎると断られた → ${half.length}つに分けて送り直す）`);
    let n = 0;
    for (const p of half) n += await lwText(at, p);
    return n;
  }
};

(async () => {
  if (!text && images.length === 0) { console.log("本文も画像も無し"); process.exit(1); }
  if (lwMissing.length) {
    console.log(`LINE WORKS の鍵がそろっていない（無い物：${lwMissing.join("・")}）→ 送らない（LINE へは回さない）`);
    process.exit(1);
  }
  let sent = 0, imgSent = 0;
  try {
    const at = await lwToken();
    if (text) for (const p of splitText(text, TEXT_MAX)) sent += await lwText(at, p);
    for (const m of images) {
      await lwPost(at, { type: "image", previewImageUrl: m.prev, originalContentUrl: m.orig });
      imgSent++;
    }
  } catch (e) {
    console.log(`LINE WORKS 失敗 → 送らない（LINE へは回さない）: ${String(e.message || e).slice(0, 300)}`);
    console.log(`（ここまでに届いた分：本文${sent}通 / 画像${imgSent}枚）`);
    process.exit(1);
  }
  console.log(`送信完了（LINE WORKS）: 本文${sent}通 / 画像${images.length}枚`);
})();
