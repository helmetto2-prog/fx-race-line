// FXレース：為替データ取得→戦績更新→LINE配信
// Node 18+ (グローバル fetch を使用)

const fs = require("fs");
const path = require("path");

const HISTORY_PATH = path.join(__dirname, "data", "history.json");

const PAIR_DEFS = [
  { gate: 1, pair: "ドル円", code: "USD/JPY" },
  { gate: 2, pair: "ユーロ円", code: "EUR/JPY" },
  { gate: 3, pair: "ポンド円", code: "GBP/JPY" },
  { gate: 4, pair: "豪ドル円", code: "AUD/JPY" },
  { gate: 5, pair: "NZドル円", code: "NZD/JPY" },
  { gate: 6, pair: "スイスフラン円", code: "CHF/JPY" },
  { gate: 7, pair: "ユーロドル", code: "EUR/USD" },
  { gate: 8, pair: "ポンドドル", code: "GBP/USD" },
];

function todayStr(d = new Date()) {
  return d.toISOString().slice(0, 10);
}
function daysAgoStr(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return todayStr(d);
}

// USDベースで JPY/EUR/GBP/AUD/NZD/CHF のレートを取得し、8ペアに変換する
async function fetchRatesForDate(dateStr) {
  const url = `https://api.frankfurter.app/${dateStr}?base=USD&symbols=JPY,EUR,GBP,AUD,NZD,CHF`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`frankfurter.app fetch failed: ${res.status}`);
  const json = await res.json();
  const r = json.rates;
  return {
    date: json.date,
    "USD/JPY": r.JPY,
    "EUR/JPY": r.JPY / r.EUR,
    "GBP/JPY": r.JPY / r.GBP,
    "AUD/JPY": r.JPY / r.AUD,
    "NZD/JPY": r.JPY / r.NZD,
    "CHF/JPY": r.JPY / r.CHF,
    "EUR/USD": 1 / r.EUR,
    "GBP/USD": 1 / r.GBP,
  };
}

function loadHistory() {
  if (!fs.existsSync(HISTORY_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(HISTORY_PATH, "utf8"));
  } catch (e) {
    return [];
  }
}
function saveHistory(hist) {
  fs.mkdirSync(path.dirname(HISTORY_PATH), { recursive: true });
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(hist, null, 2));
}

function computeStats(history) {
  const stats = {};
  PAIR_DEFS.forEach((p) => {
    stats[p.code] = { ...p, races: 0, wins: 0, top2: 0, contMatch: 0, contTotal: 0, prevChange: null };
  });
  history.forEach((day) => {
    const ranked = [...day.pairs].sort((a, b) => b.change - a.change);
    ranked.forEach((e, idx) => {
      const s = stats[e.code];
      if (!s) return;
      s.races++;
      if (idx === 0) s.wins++;
      if (idx <= 1) s.top2++;
      if (s.prevChange !== null) {
        s.contTotal++;
        const sameSign = (e.change >= 0 && s.prevChange >= 0) || (e.change < 0 && s.prevChange < 0);
        if (sameSign) s.contMatch++;
      }
      s.prevChange = e.change;
    });
  });
  return Object.values(stats);
}

function buildMessage(dateStr, rankedToday, prevDay, statsList) {
  const lines = [];
  lines.push(`🏇 FXレース 朝6時発走（${dateStr}）`);
  lines.push("");
  lines.push("【本日の着順】");
  rankedToday.forEach((e, i) => {
    const sign = e.change > 0 ? "+" : "";
    lines.push(`${i + 1}着 ${e.pair}（${e.code}） ${sign}${e.change.toFixed(2)}%`);
  });

  if (prevDay) {
    const prevRanked = [...prevDay.pairs].sort((a, b) => b.change - a.change);
    const prevWinner = prevRanked[0];
    const todayIdx = rankedToday.findIndex((e) => e.code === prevWinner.code);
    const todayEntry = rankedToday[todayIdx];
    const continued = todayEntry.change > 0;
    lines.push("");
    lines.push("【前日比較】");
    lines.push(
      `前回1着の${prevWinner.pair}は本日${todayIdx + 1}着（${continued ? "継続" : "反転"}）`
    );
  }

  if (statsList && statsList.some((s) => s.races > 0)) {
    const sorted = [...statsList].sort((a, b) => b.top2 / (b.races || 1) - a.top2 / (a.races || 1));
    const top = sorted[0];
    lines.push("");
    lines.push(
      `【戦績（${sorted[0].races}日分蓄積）】連対率トップ：${top.pair}（${Math.round(
        (top.top2 / (top.races || 1)) * 100
      )}%）`
    );
  }

  lines.push("");
  lines.push("※実際の値動きにもとづく参考情報です。投資は自己判断でお願いします。");
  return lines.join("\n");
}

async function sendToLine(text) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) {
    console.log("LINE_CHANNEL_ACCESS_TOKEN が未設定のため、LINE送信をスキップします。");
    console.log(text);
    return;
  }
  const res = await fetch("https://api.line.me/v2/bot/message/broadcast", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      messages: [{ type: "text", text }],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LINE送信失敗: ${res.status} ${body}`);
  }
  console.log("LINEへ送信しました。");
}

async function main() {
  const today = todayStr();
  const yesterday = daysAgoStr(1);

  const [todayRates, prevRates] = await Promise.all([
    fetchRatesForDate(today),
    fetchRatesForDate(yesterday),
  ]);

  const entries = PAIR_DEFS.map((p) => {
    const rate = todayRates[p.code];
    const prevRate = prevRates[p.code];
    const change = ((rate - prevRate) / prevRate) * 100;
    return { gate: p.gate, pair: p.pair, code: p.code, rate: rate.toFixed(4), change };
  });

  const history = loadHistory();
  const prevDay = history.length > 0 ? history[history.length - 1] : null;

  const dayRecord = { date: today, pairs: entries };
  const existingIdx = history.findIndex((h) => h.date === today);
  if (existingIdx >= 0) history[existingIdx] = dayRecord;
  else history.push(dayRecord);
  history.sort((a, b) => a.date.localeCompare(b.date));
  // 直近180日分だけ保持（肥大化防止）
  const trimmed = history.slice(-180);
  saveHistory(trimmed);

  const rankedToday = [...entries].sort((a, b) => b.change - a.change);
  const statsList = computeStats(trimmed);

  const message = buildMessage(today, rankedToday, prevDay, statsList);
  console.log(message);
  await sendToLine(message);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
