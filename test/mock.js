// 試し用：本物の LINE / LINE WORKS へは送らない偽物の fetch（notify.js の前に -r で読む）
const fs = require("fs");
const log = process.env.MOCK_LOG;
const mode = process.env.MOCK_MODE || "ok";
let lwSends = 0;
globalThis.fetch = async (url, opt = {}) => {
  let body = opt.body;
  if (body instanceof URLSearchParams) body = Object.fromEntries(body);
  else if (typeof body === "string") { try { body = JSON.parse(body); } catch {} }
  fs.appendFileSync(log, JSON.stringify({ url, auth: (opt.headers || {}).Authorization || "", body }) + "\n");
  const r = (status, obj) => ({ ok: status < 300, status, text: async () => (obj == null ? "" : JSON.stringify(obj)), json: async () => obj });
  if (url.startsWith("https://auth.worksmobile.com/")) {
    if (mode === "tokenfail") return r(400, { code: "invalid_client", description: "bad" });
    return r(200, { access_token: "AT_TEST", expires_in: 86400 });
  }
  if (url.startsWith("https://www.worksapis.com/")) {
    lwSends++;
    if (mode === "textfail" && lwSends === 1) return r(400, { code: "INVALID_PARAMETER", description: "userId does not exist." });
    if (mode === "img2fail" && lwSends === 3) return r(500, { code: "SERVER_ERROR" });
    return r(201, null);
  }
  if (url === "https://api.line.me/v2/bot/message/push") return r(200, { sentMessages: [] });
  return r(404, { message: "unknown" });
};
