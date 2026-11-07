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
// 2026-11-07 義樹さん指示「アドレスをリンクにしないでボタンに」「案内もボタンにしてね」：
//   本文の中のアドレスは字で出さずに抜き出し、押すと何が開くか分かる名前のボタン（button_template）にする。
//   ボタンの名前の決め方（上から順に）：
//     ① 本文に [ボタンの名前](https://…) と書いてあればその名前
//     ② 「〇〇を開く→ https://…」のように、矢印の前が「を開く・を見る・を読む・を聞く」で終わる短い言葉ならそれ
//     ③ よく送るページは決まりの名前（KY絵本その71を見る・人類創世28年目を読む など＝下の BUTTON_RULES）
//     ④ 矢印の前の短い言葉＋「を開く」 ⑤ ページの題名（<title>）＋「を開く」 ⑥ 「ページを開く」
//   ボタンは1通に10個・名前は20字まで・いっしょに出す本文は1000字まで（LINE WORKS の決まり）。
//   本文が長い時は前の方を今までどおりの字の知らせで送り、最後の1000字にボタンを付ける。11個目からは「つづき」の1通に。
//   ボタンの形で断られた時だけ、今までどおりアドレスの字で送る（ログに「ボタンの形で送れず」と出る）。
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
  console.log("LINE WORKS:", res.status, content.type, content.type === "text" ? `${content.text.length}字` : content.type === "button_template" ? `${content.contentText.length}字・ボタン${content.actions.length}個` : "", body.slice(0, 200));
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

// ── アドレス → 名前つきボタン ──────────────────────────────
const BTN_MAX = 10;          // 1通のボタンの数
const LABEL_MAX = 20;        // ボタンの名前の字数
const BTN_TEXT_MAX = 1000;   // ボタンといっしょに出す本文の字数
const MD_RE = /\[([^\]\n]{1,40})\]\((https?:\/\/[^\s)]+)\)/g;
const URL_RE = /https?:\/\/[^\s<>「」『』（）()、。]+/g;
const VERB_RE = /(を開く|を見る|を読む|を聞く|をひらく|をみる|をよむ|をきく)$/;
const chars = (s) => Array.from(s);
const cut = (s, n = LABEL_MAX) => chars(s).slice(0, n).join("");
const clean = (s) => s.replace(/[\p{Extended_Pictographic}️‍]/gu, "").replace(/\s+/g, " ")
  .replace(/^[\s▶・\-—:：]+/, "").replace(/[\s→⇒:：\-—]+$/, "").trim();
// よく送るページの決まりの名前（y＝本文の前の方にある「N年目」の数）
const BUTTON_RULES = [
  [/tanpatsu-news\/ky-ehon-bangai(\d+)\.html/, (m) => `KY絵本 番外編${m[1]}を見る`],
  [/tanpatsu-news\/ky-ehon(\d+)\.html/, (m) => `KY絵本その${m[1]}を見る`],
  [/tanpatsu-news\/ky-ehon-matome\.html/, () => "KY絵本の全巻もくじを見る"],
  [/tanpatsu-news\/ky-ehon-chui\.html/, () => "KY絵本の注意書きを読む"],
  [/tanpatsu-news\/ky-app\//, () => "KY絵本アプリを開く"],
  [/tanpatsu-news\/jinrui\/app\//, () => "人類創世アプリを開く"],
  [/tanpatsu-news\/jinrui\/annai\/[^/]*\.mp4/, () => "村の案内動画を見る"],
  [/tanpatsu-news\/jinrui\/douga\//, (m, y) => y ? `人類創世${y}年目のアニメを見る` : "人類創世のアニメを見る"],
  [/tanpatsu-news\/jinrui\/koe\//, () => "人類創世の村人の声を聞く"],
  [/tanpatsu-news\/jinrui\/nen\/(\d+)\//, (m) => `人類創世${m[1]}年目を読む`],
  [/tanpatsu-news\/jinrui\/?(#.*)?$/, (m, y) => y ? `人類創世${y}年目を読む` : "人類創世を読む"],
  [/tanpatsu-news\/toushi\//, () => "投資部屋を見る"],
  [/tanpatsu-news\/ninku\//, () => "人工計算アプリを開く"],
  [/tanpatsu-news\/?$/, () => "単発ニュースの棚を見る"],
  [/zoennews\/kabu\/?$/, () => "今日の株式ニュースを読む"],
  [/zoennews\/?$/, () => "今日の造園ニュースを読む"],
  [/shokubutsu-zukan\//, () => "植物図鑑を開く"],
  [/sakana-zukan\//, () => "さかな図鑑を開く"],
  [/ranking-hiroba\//, () => "ランキング広場を見る"],
  [/github\.com\/[^/]+\/[^/]+\/actions\/runs\//, () => "実行の記録を見る"],
  [/(drive|docs)\.google\.com\//, () => "Driveのファイルを開く"],
];
const pageTitle = async (uri) => {
  try {
    const res = await fetch(uri, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return "";
    const m = (await res.text()).slice(0, 60000).match(/<title[^>]*>([^<]{1,200})<\/title>/i);
    return m ? clean(m[1].replace(/&amp;/g, "&").replace(/&[a-z]+;|&#\d+;/g, " ")) : "";
  } catch { return ""; }
};
// 本文からアドレスを抜いて { body, buttons:[{label, uri}] } にする
const toButtons = async (t) => {
  const buttons = [];
  const seen = new Set();
  const add = (uri, label) => { if (!seen.has(uri)) { seen.add(uri); buttons.push({ label, uri }); } };
  const out = [];
  let ctx = "";   // 前のアドレスから今のアドレスまでの本文（「N年目」を探す所）
  for (const line of t.split("\n")) {
    let s = line.replace(MD_RE, (m0, name, uri) => { add(uri, cut(clean(name)) || "ページを開く"); return ""; });
    let rest = "";
    let last = 0;
    for (const m of s.matchAll(URL_RE)) {
      const uri = m[0].replace(/[.,!?！？]+$/, "");
      let before = s.slice(last, m.index);
      ctx += before;
      const arrow = before.match(/([^。！!？?▶、\n]*?)\s*(→|⇒|：|:)\s*$/);
      const near = arrow ? clean(arrow[1]) : "";
      const y = (ctx.match(/(\d+)年目/g) || []).pop()?.replace("年目", "") || "";
      let label = "";
      if (near && chars(near).length <= LABEL_MAX && VERB_RE.test(near)) {
        label = near;
        before = before.slice(0, before.length - arrow[0].length);   // 名前に使った言葉と矢印は本文から外す
      } else {
        const rule = BUTTON_RULES.find(([re]) => re.test(uri));
        if (rule) label = rule[1](uri.match(rule[0]), y);
        else if (near && chars(near).length <= LABEL_MAX - 3) label = near + "を開く";
        else {
          const tt = await pageTitle(uri);
          label = tt ? cut(tt, LABEL_MAX - 3) + "を開く" : "ページを開く";
        }
        if (arrow) before = before.replace(/\s*(→|⇒)\s*$/, "");
      }
      rest += before;
      add(uri, cut(label));
      last = m.index + m[0].length;
      ctx = "";
    }
    rest += s.slice(last);
    ctx += s.slice(last) + "\n";
    if (rest.trim() || !line.trim()) out.push(rest.replace(/\s+$/, ""));
  }
  return { body: out.join("\n").replace(/\n{3,}/g, "\n\n").trim(), buttons };
};
// ボタンの形で送る。断られたら今までどおりアドレスの字で送る。返り値＝送った通数
const lwButtons = async (at, body, buttons) => {
  let n = 0;
  for (let i = 0; i < buttons.length; i += BTN_MAX) {
    const group = buttons.slice(i, i + BTN_MAX);
    const contentText = i === 0 ? (body || "下のボタンから開けます") : "（ボタンのつづき）";
    try {
      await lwPost(at, { type: "button_template", contentText, actions: group.map((b) => ({ type: "uri", label: b.label, uri: b.uri })) });
      n++;
    } catch (e) {
      console.log(`ボタンの形で送れず → アドレスの字で送る: ${String(e.message || e).slice(0, 200)}`);
      const plain = (i === 0 && body ? body + "\n" : "") + buttons.slice(i).map((b) => `${b.label}\n${b.uri}`).join("\n");
      for (const p of splitText(plain, TEXT_MAX)) n += await lwText(at, p);
      break;
    }
  }
  return n;
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
    const { body, buttons } = text ? await toButtons(text) : { body: "", buttons: [] };
    if (buttons.length) console.log(`ボタン${buttons.length}個：${buttons.map((b) => b.label).join("／")}`);
    const parts = body ? splitText(body, TEXT_MAX) : [];
    let tail = "";
    if (buttons.length && parts.length) {
      // 最後の1000字にボタンを付ける。前の方は今までどおり字の知らせで
      const lastParts = splitText(parts.pop(), BTN_TEXT_MAX);
      tail = lastParts.pop();
      parts.push(...lastParts);
    }
    for (const p of parts) sent += await lwText(at, p);
    if (buttons.length) sent += await lwButtons(at, tail, buttons);
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
