// notify.js の試し（偽物の fetch で、どこへ何が送られるかだけを見る）
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
  const r = spawnSync("node", ["-r", path.join(__dirname, "mock.js"), "notify.js"], {
    env: { PATH: process.env.PATH, MOCK_LOG: log, LINE_CHANNEL_ACCESS_TOKEN: "LINE_TOKEN", ...env }, encoding: "utf8",
  });
  const calls = fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  let res;
  try { res = check(calls, r); } catch (e) { res = String(e); }
  const leak = /LINE_TOKEN|csec|BEGIN PRIVATE/.test(r.stdout + r.stderr);
  const ok = res === true && !leak;
  if (!ok) ng++;
  console.log(`${ok ? "OK" : "NG"} ${name}${ok ? "" : " → " + res + (leak ? "（鍵がログに出た）" : "")}`);
  if (!ok) console.log(r.stdout, r.stderr, JSON.stringify(calls, null, 1));
};
const kinds = (calls) => calls.map((c) => c.url.includes("auth.works") ? "T" : c.url.includes("worksapis") ? `W:${c.body.content.type}` : `L:${c.body.messages.map((m) => m.type[0]).join("")}`).join(" ");
const eq = (a, b) => a === b || `「${a}」≠「${b}」`;

// 1. 鍵なし＝今までどおり LINE（本文1通・画像は5枚ずつ）
run("鍵なし→LINEだけ", { NOTIFY_MESSAGE: "テスト\n2行目", NOTIFY_IMAGES: IMG }, (c, r) => {
  if (r.status !== 0) return "終了コード " + r.status;
  if (c[0].body.to !== "U9ca3bbfdcde67012c023af08e8e1569d") return "LINEの宛先";
  if (c[0].body.messages[0].text !== "テスト\n2行目") return "本文";
  if (c[1].body.messages[0].previewImageUrl !== "https://example.com/a_s.jpg") return "サムネ";
  return eq(kinds(c), "L:t L:iii");
});
// 2. 鍵が4つだけ＝LINE
run("鍵が4つ→LINEだけ", { ...LW, NOTIFY_MESSAGE: "x" }, (c) => eq(kinds(c), "L:t"));
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
    return eq(kinds(c), "T W:text W:image W:image W:image");
  });
}
// 4. LW_TO で宛先を変えられる
run("LW_TOあり", { ...LW, LW_PRIVATE_KEY: pem, LW_TO: "test@midori-zoen", NOTIFY_MESSAGE: "x" }, (c) => eq(c[1].url.split("/users/")[1], "test%40midori-zoen/messages"));
// 5. トークン失敗＝全部 LINE へ
run("トークン失敗→全部LINE", { ...LW, LW_PRIVATE_KEY: pem, MOCK_MODE: "tokenfail", NOTIFY_MESSAGE: "x", NOTIFY_IMAGES: IMG }, (c, r) => r.status === 0 ? eq(kinds(c), "T L:t L:iii") : "終了コード");
// 6. 本文で失敗＝全部 LINE へ
run("本文で失敗→全部LINE", { ...LW, LW_PRIVATE_KEY: pem, MOCK_MODE: "textfail", NOTIFY_MESSAGE: "x", NOTIFY_IMAGES: IMG }, (c) => eq(kinds(c), "T W:text L:t L:iii"));
// 7. 2枚目の画像で失敗＝残り2枚だけ LINE へ（本文は二重に送らない）
run("画像2枚目で失敗→残りだけLINE", { ...LW, LW_PRIVATE_KEY: pem, MOCK_MODE: "img2fail", NOTIFY_MESSAGE: "x", NOTIFY_IMAGES: IMG }, (c) => eq(kinds(c), "T W:text W:image W:image L:ii"));
// 8. 壊れた鍵＝LINE へ
run("壊れた鍵→LINE", { ...LW, LW_PRIVATE_KEY: "abc", NOTIFY_MESSAGE: "x" }, (c, r) => r.status === 0 ? eq(kinds(c), "L:t") : "終了コード");
// 9. 本文も画像も無し＝終了コード1・何も送らない
run("空→送らない", { ...LW, LW_PRIVATE_KEY: pem }, (c, r) => r.status === 1 ? eq(kinds(c), "") : "終了コード " + r.status);
// 10. 画像だけ
run("画像だけ→LINE WORKS", { ...LW, LW_PRIVATE_KEY: pem, NOTIFY_IMAGES: "https://example.com/a.jpg" }, (c) => eq(kinds(c), "T W:image"));

console.log(`\n${n}件中 NG ${ng}件`);
process.exit(ng ? 1 : 0);
