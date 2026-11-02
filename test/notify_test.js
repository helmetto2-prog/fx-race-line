// notify.js の試し（偽物の fetch で、どこへ何が送られるかだけを見る）
// 2026-11-02：LINE への予備をやめた＝どの場合も api.line.me へは1通も行かないこと・失敗は終了コード1
const { spawnSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" });
const oneLine = pem.replace(/\n/g, "");          // 1行に詰めた形（GAS のスクリプトプロパティと同じ）
const escaped = pem.replace(/\n/g, "\\n");       // 「\n」と書いた形
const LW = { LW_CLIENT_ID: "cid", LW_CLIENT_SECRET: "csec", LW_SERVICE_ACCOUNT: "sa@x", LW_BOT_ID: "123" };
const IMG = "https://example.com/a.jpg|https://example.com/a_s.jpg, https://example.com/b.jpg https://example.com/c.jpg";
let ng = 0, n = 0;
const run = (name, env, check) => {
  n++;
  const log = path.join(__dirname, `log_${n}.jsonl`);
  if (fs.existsSync(log)) fs.unlinkSync(log);
  fs.writeFileSync(log, "");
  // LINE の鍵が Actions に残っていても使わないことを見るため、わざと渡しておく
  const r = spawnSync("node", ["-r", path.join(__dirname, "mock.js"), "notify.js"], {
    env: { PATH: process.env.PATH, MOCK_LOG: log, LINE_CHANNEL_ACCESS_TOKEN: "LINE_TOKEN", ...env }, encoding: "utf8",
  });
  const calls = fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  let res;
  try { res = check(calls, r); } catch (e) { res = String(e); }
  if (res === true && calls.some((c) => c.url.includes("api.line.me"))) res = "LINE へ送った";
  const leak = /LINE_TOKEN|csec|BEGIN PRIVATE/.test(r.stdout + r.stderr);
  const ok = res === true && !leak;
  if (!ok) ng++;
  console.log(`${ok ? "OK" : "NG"} ${name}${ok ? "" : " → " + res + (leak ? "（鍵がログに出た）" : "")}`);
  if (!ok) console.log(r.stdout, r.stderr, JSON.stringify(calls, null, 1));
};
const kinds = (calls) => calls.map((c) => c.url.includes("auth.works") ? "T" : c.url.includes("worksapis") ? `W:${c.body.content.type}` : `L:${c.body.messages.map((m) => m.type[0]).join("")}`).join(" ");
const eq = (a, b) => a === b || `「${a}」≠「${b}」`;
const fail = (r) => r.status === 1 && /LINE へは回さない/.test(r.stdout);
const texts = (c) => c.filter((x) => x.url.includes("worksapis") && x.body.content.type === "text").map((x) => x.body.content.text);

// 1. 鍵なし＝送らない（LINE へも回さない）
run("鍵なし→送らない", { NOTIFY_MESSAGE: "テスト\n2行目", NOTIFY_IMAGES: IMG }, (c, r) => fail(r) ? eq(kinds(c), "") : "終了コード " + r.status);
// 2. 鍵が4つだけ＝送らない・足りない鍵の名前だけログに出る
run("鍵が4つ→送らない", { ...LW, NOTIFY_MESSAGE: "x" }, (c, r) => !fail(r) ? "終了コード " + r.status : !/LW_PRIVATE_KEY/.test(r.stdout) ? "足りない鍵の名前" : eq(kinds(c), ""));
// 3. 鍵そろい・成功＝LINE WORKS だけ・JWT の署名が正しい・宛先は義樹さん
for (const [nm, key] of [["PEM", pem], ["1行", oneLine], ["\\n書き", escaped]]) {
  run(`鍵そろい(${nm})→LINE WORKSだけ`, { ...LW, LW_PRIVATE_KEY: key, NOTIFY_MESSAGE: "テスト", NOTIFY_IMAGES: IMG }, (c, r) => {
    if (r.status !== 0) return "終了コード " + r.status;
    const t = c[0].body;
    if (t.grant_type !== "urn:ietf:params:oauth:grant-type:jwt-bearer" || t.scope !== "bot" || t.client_id !== "cid") return "トークンの頼み方";
    const [h, p, s] = t.assertion.split(".");
    const okSig = crypto.createVerify("RSA-SHA256").update(`${h}.${p}`).verify(publicKey, Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64"));
    if (!okSig) return "署名";
    const claim = JSON.parse(Buffer.from(p, "base64").toString());
    if (claim.iss !== "cid" || claim.sub !== "sa@x" || claim.exp - claim.iat !== 3600) return "JWTの中身";
    if (c[1].url !== "https://www.worksapis.com/v1.0/bots/123/users/yoshiki%40midori-zoen/messages") return "送り先 " + c[1].url;
    if (c[1].auth !== "Bearer AT_TEST") return "認証";
    if (c[2].body.content.previewImageUrl !== "https://example.com/a_s.jpg" || c[2].body.content.originalContentUrl !== "https://example.com/a.jpg") return "画像";
    if (!/送信完了（LINE WORKS）: 本文1通 \/ 画像3枚/.test(r.stdout)) return "完了の行";
    return eq(kinds(c), "T W:text W:image W:image W:image");
  });
}
// 4. LW_TO で宛先を変えられる
run("LW_TOあり", { ...LW, LW_PRIVATE_KEY: pem, LW_TO: "test@midori-zoen", NOTIFY_MESSAGE: "x" }, (c) => eq(c[1].url.split("/users/")[1], "test%40midori-zoen/messages"));
// 5. トークン失敗＝送らない
run("トークン失敗→送らない", { ...LW, LW_PRIVATE_KEY: pem, MOCK_MODE: "tokenfail", NOTIFY_MESSAGE: "x", NOTIFY_IMAGES: IMG }, (c, r) => fail(r) ? eq(kinds(c), "T") : "終了コード " + r.status);
// 6. 本文で失敗＝そこで止める（画像も送らない）
run("本文で失敗→止める", { ...LW, LW_PRIVATE_KEY: pem, MOCK_MODE: "textfail", NOTIFY_MESSAGE: "x", NOTIFY_IMAGES: IMG }, (c, r) => fail(r) ? eq(kinds(c), "T W:text") : "終了コード " + r.status);
// 7. 2枚目の画像で失敗＝そこで止める・届いた分がログに出る
run("画像2枚目で失敗→止める", { ...LW, LW_PRIVATE_KEY: pem, MOCK_MODE: "img2fail", NOTIFY_MESSAGE: "x", NOTIFY_IMAGES: IMG }, (c, r) => !fail(r) ? "終了コード " + r.status : !/本文1通 \/ 画像1枚/.test(r.stdout) ? "届いた分の行" : eq(kinds(c), "T W:text W:image W:image"));
// 8. 壊れた鍵＝送らない
run("壊れた鍵→送らない", { ...LW, LW_PRIVATE_KEY: "abc", NOTIFY_MESSAGE: "x" }, (c, r) => fail(r) ? eq(kinds(c), "") : "終了コード " + r.status);
// 9. 本文も画像も無し＝終了コード1・何も送らない
run("空→送らない", { ...LW, LW_PRIVATE_KEY: pem }, (c, r) => r.status === 1 ? eq(kinds(c), "") : "終了コード " + r.status);
// 10. 画像だけ
run("画像だけ→LINE WORKS", { ...LW, LW_PRIVATE_KEY: pem, NOTIFY_IMAGES: "https://example.com/a.jpg" }, (c) => eq(kinds(c), "T W:image"));
// 11. 長い本文（6:40 のまとめのような・3,000字ほど）＝1800字までに行の切れ目で分けて順に送る・中身は欠けない
const long = Array.from({ length: 120 }, (_, i) => `${i + 1}行目：まとんの知らせ（あいうえおかきくけこ）`).join("\n");
run("長い本文→分けて送る", { ...LW, LW_PRIVATE_KEY: pem, NOTIFY_MESSAGE: long }, (c, r) => {
  if (r.status !== 0) return "終了コード " + r.status;
  const t = texts(c);
  if (t.length < 2 || t.some((x) => x.length > 1800)) return "分け方 " + t.map((x) => x.length).join(",");
  if (t.some((x) => x.startsWith("\n") || x.endsWith("\n"))) return "行の切れ目";
  return eq(t.join("\n"), long);
});
// 12. 1行が長すぎる（改行なし 5,000字）＝行の途中で切る
const oneLong = "あ".repeat(5000);
run("改行なしの長文→途中で切る", { ...LW, LW_PRIVATE_KEY: pem, NOTIFY_MESSAGE: oneLong }, (c, r) => r.status !== 0 ? "終了コード " + r.status : eq(texts(c).map((x) => x.length).join(","), "1800,1800,1400"));
// 13. 上限が思ったより小さい（偽物で 700字）＝断られた1通を半分に分けて送り直す・中身は欠けない
run("上限が小さい→半分に分けて送り直す", { ...LW, LW_PRIVATE_KEY: pem, MOCK_MAX: "700", NOTIFY_MESSAGE: long }, (c, r) => {
  if (r.status !== 0) return "終了コード " + r.status;
  const ok = c.filter((x) => x.url.includes("worksapis") && x.body.content.text.length <= 700).map((x) => x.body.content.text);
  if (!/半分|分けて送り直す/.test(r.stdout)) return "送り直しの行";
  return eq(ok.join("\n"), long);
});
// 14. どうしても通らない（偽物で 10字）＝止める・LINE へは回さない
run("どうしても通らない→止める", { ...LW, LW_PRIVATE_KEY: pem, MOCK_MAX: "10", NOTIFY_MESSAGE: long }, (c, r) => fail(r) || "終了コード " + r.status);

console.log(`\n${n}件中 NG ${ng}件`);
process.exit(ng ? 1 : 0);
