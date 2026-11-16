const DEFAULT_STATE = { mode: "auto", balance: 1000, position: null, lastSignal: null };

let STATE = { ...DEFAULT_STATE };
let TG_TOKEN = "";
let TG_CHAT_ID = "";
let SYMBOL = "BTCUSDT";
let EXCHANGE = "BINANCE";
let INTERVAL = "D";
let LAST_PRICE = null;
let LAST_CHANGE = null;
let CANDLES = [];
let STRATEGY_STATUS = "Mengecek...";

const $ = (id) => document.getElementById(id);

function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem("crypto_bot_state") || "{}");
    return {
      mode: s.mode || "auto",
      balance: s.balance ?? 1000,
      position: s.position || null,
      lastSignal: s.lastSignal || null,
    };
  } catch (e) { return { ...DEFAULT_STATE }; }
}
function saveState() {
  try { localStorage.setItem("crypto_bot_state", JSON.stringify(STATE)); } catch (e) {}
}

function log(msg) {
  const ul = $("log");
  const li = document.createElement("li");
  const d = new Date();
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  li.textContent = "[" + hh + ":" + mm + "] " + msg;
  ul.appendChild(li);
  ul.scrollTop = ul.scrollHeight;
}

async function tgSend(token, chatId, text) {
  const url = "https://api.telegram.org/bot" + token + "/sendMessage";
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: "Markdown" })
  });
  let j = null;
  try { j = await r.json(); } catch (e) {}
  return !!(j && j.ok);
}

const EXCHANGES = {
  BINANCE: { label: "Binance", pair: (s) => s },
  OKX: { label: "OKX", pair: (s) => s.replace(/USDT$/, "-USDT") },
  BYBIT: { label: "Bybit", pair: (s) => s },
};

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "ADAUSDT", "DOGEUSDT", "LINKUSDT", "DOTUSDT"];
const COINGECKO_IDS = {
  BTCUSDT: "bitcoin", ETHUSDT: "ethereum", SOLUSDT: "solana", BNBUSDT: "binancecoin",
  XRPUSDT: "ripple", ADAUSDT: "cardano", DOGEUSDT: "dogecoin", LINKUSDT: "chainlink", DOTUSDT: "polkadot",
};
const TV_SCRIPT = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";

function tvSymbol() {
  const ex = EXCHANGES[EXCHANGE] || EXCHANGES.BINANCE;
  return ex.pair(SYMBOL);
}

function initTV(symbol, interval) {
  const el = $("tv-widget");
  el.innerHTML = "";
  const div = document.createElement("div");
  div.className = "tradingview-widget-container";
  const inner = document.createElement("div");
  inner.className = "tradingview-widget-container__widget";
  div.appendChild(inner);
  const script = document.createElement("script");
  script.type = "text/javascript";
  script.async = true;
  script.src = TV_SCRIPT;
  script.textContent = JSON.stringify({
    autosize: true,
    symbol: symbol,
    interval: interval,
    timezone: "Etc/UTC",
    theme: "dark",
    style: "1",
    locale: "en",
    toolbar_bg: "#0b0e11",
    enable_publishing: false,
    allow_symbol_change: true,
    calendar: false,
    support_host: "https://www.tradingview.com"
  });
  div.appendChild(script);
  el.appendChild(div);
}

function refreshChart() {
  const sym = tvSymbol();
  $("chart-symbol-label").textContent = sym + " / " + INTERVAL;
  initTV(sym, INTERVAL);
}

function setMode(mode) {
  STATE.mode = mode;
  saveState();
  $("topbar-mode").textContent = "MODE: " + mode.toUpperCase();
  $("btn-mode-auto").classList.toggle("active", mode === "auto");
  $("btn-mode-manual").classList.toggle("active", mode === "manual");
  $("auto-panel").classList.toggle("hidden", mode !== "auto");
  $("manual-panel").classList.toggle("hidden", mode !== "manual");
}

function sma(values, period) {
  if (!values || values.length < period) return null;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) sum += values[i];
  return sum / period;
}

function detectCross(candles) {
  const closes = candles.slice(-30).map((c) => c.c);
  const prev = closes.slice(0, -1);
  const f1 = sma(prev, 10);
  const s1 = sma(prev, 30);
  const f2 = sma(closes, 10);
  const s2 = sma(closes, 30);
  if (f1 == null || s1 == null) return null;
  if (f1 <= s1 && f2 > s2) return "LONG";
  if (f1 >= s1 && f2 < s2) return "SHORT";
  return null;
}

function buildSignal(exLabel, tvSym, interval, side, entry, sl, tp, size, strategyName) {
  const lines = [];
  lines.push("*CRYPTO BOT SIGNAL*");
  lines.push("Exchange: " + exLabel);
  lines.push("Pair: " + tvSym);
  lines.push("Timeframe: " + interval);
  lines.push(side === "LONG" ? "*LONG SETUP*" : "*SHORT SETUP*");
  lines.push("Entry: $" + entry);
  lines.push("Take Profit: $" + tp);
  lines.push("Stop Loss: $" + sl);
  lines.push("Size: " + size + " USDT");
  lines.push("Strategy: " + strategyName);
  return lines.join("\n");
}

async function refreshMarket() {
  const id = COINGECKO_IDS[SYMBOL];
  try {
    const url = "https://api.coingecko.com/api/v3/coins/" + id + "/market_chart?vs_currency=usd&days=30";
    const r = await fetch(url);
    const j = await r.json();
    const prices = j.prices || [];
    CANDLES = prices.map((p) => ({ t: p[0], c: p[1] })).sort((a, b) => a.t - b.t);
    const last = CANDLES.length ? CANDLES[CANDLES.length - 1].c : null;
    const prev = CANDLES.length > 1 ? CANDLES[CANDLES.length - 2].c : last;
    LAST_PRICE = last;
    LAST_CHANGE = last && prev ? ((last - prev) / prev) * 100 : null;

    const exLabel = (EXCHANGES[EXCHANGE] || EXCHANGES.BINANCE).label;
    const tvSym = tvSymbol();
    const priceStr = last ? "$" + last.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "N/A";
    const chgStr = LAST_CHANGE != null ? (LAST_CHANGE >= 0 ? "▲" : "▼") + Math.abs(LAST_CHANGE).toFixed(2) + "%" : "";
    $("balance-box").textContent = STATE.balance.toFixed(2) + " USDT";
    $("position-box").textContent = STATE.position
      ? "POSISI: " + STATE.position.side + " | Entry: $" + STATE.position.entry + " | SL: $" + STATE.position.sl + " | TP: $" + STATE.position.tp + " | Size: " + STATE.position.size + " USDT"
      : "Belum ada posisi";
    $("last-signal").textContent = STATE.lastSignal || "—";
    log("Market " + tvSym + ": " + priceStr + " " + chgStr);
  } catch (e) {
    log("Gagal ambil market data: " + e);
  }
}

async function runStrategy() {
  STRATEGY_STATUS = "⏳ Mengecek...";
  $("strategy-status").textContent = STRATEGY_STATUS;
  if (STATE.position) {
    const pos = STATE.position;
    const price = LAST_PRICE;
    if (price) {
      const hitSL = (pos.side === "LONG" && price <= pos.sl) || (pos.side === "SHORT" && price >= pos.sl);
      const hitTP = (pos.side === "LONG" && price >= pos.tp) || (pos.side === "SHORT" && price <= pos.tp);
      if (hitSL || hitTP) {
        const pnl = pos.side === "LONG" ? ((price - pos.entry) / pos.entry) * pos.size : ((pos.entry - price) / pos.entry) * pos.size;
        STATE.position = null;
        saveState();
        log("AUTO CLOSE " + pos.side + " karena SL/TP tercapai. PnL=" + pnl.toFixed(2));
        await tgSend($("tg-token").value.trim(), $("tg-chatid").value.trim(),
          "*CRYPTO BOT*\nAUTO CLOSE\nSide: " + pos.side + "\nEntry: $" + pos.entry + "\nClose: $" + price + "\nPnL: $" + pnl.toFixed(2));
        return "AUTO_CLOSED";
      }
    }
  }
  const sig = detectCross(CANDLES);
  if (!sig) {
    STRATEGY_STATUS = "✅ Tidak ada cross (SMA 10/30)";
    $("strategy-status").textContent = STRATEGY_STATUS;
    return null;
  }
  STRATEGY_STATUS = sig === "LONG" ? "🟢 LONG SETUP DITEMUKAN" : "🔴 SHORT SETUP DITEMUKAN";
  $("strategy-status").textContent = STRATEGY_STATUS;
  const exLabel = (EXCHANGES[EXCHANGE] || EXCHANGES.BINANCE).label;
  const tvSym = tvSymbol();
  const entry = LAST_PRICE;
  const size = parseFloat($("risk-size").value) || 25;
  let sl, tp;
  if (sig === "LONG") { sl = entry * 0.98; tp = entry * 1.05; }
  else { sl = entry * 1.02; tp = entry * 0.95; }
  const msg = buildSignal(exLabel, tvSym, INTERVAL, sig, entry, sl, tp, size, "SMA Cross");
  STATE.lastSignal = msg;
  saveState();
  STATE.position = { side: sig, entry: entry, sl: sl, tp: tp, size: size, symbol: tvSym };
  saveState();
  await refreshMarket();
  return msg;
}

function sendLastSignal() {
  const token = $("tg-token").value.trim();
  const chatId = $("tg-chatid").value.trim();
  if (!token || !chatId) { log("⚠️ Bot token / Chat ID belum diisi."); return Promise.resolve(false); }
  if (!STATE.lastSignal) { log("⚠️ Belum ada signal."); return Promise.resolve(false); }
  return tgSend(token, chatId, STATE.lastSignal).then((ok) => { log(ok ? "Signal terkirim ke Telegram ✅" : "Gagal kirim signal ke Telegram ❌"); return ok; });
}

async function sendTest() {
  const token = $("tg-token").value.trim();
  const chatId = $("tg-chatid").value.trim();
  if (!token || !chatId) { log("⚠️ Bot token / Chat ID belum diisi."); return Promise.resolve(false); }
  const msg = "*CRYPTO BOT*\nStatus: Online\nMode: " + STATE.mode.toUpperCase() + "\nPair: " + tvSymbol() + "\nTimeframe: " + INTERVAL + "\nBalance: " + STATE.balance.toFixed(2) + " USDT\nPosition: " + (STATE.position ? STATE.position.side : "None");
  const ok = await tgSend(token, chatId, msg);
  log(ok ? "Pesan test terkirim ke Telegram ✅" : "Gagal kirim pesan test ke Telegram ❌");
  return ok;
}

function bindEvents() {
  $("exchange-select").addEventListener("change", (e) => { EXCHANGE = e.target.value; refreshChart(); });
  $("symbol-select").addEventListener("change", (e) => { SYMBOL = e.target.value; refreshChart(); });
  $("interval-select").addEventListener("change", (e) => { INTERVAL = e.target.value; refreshChart(); });
  $("btn-mode-auto").addEventListener("click", () => setMode("auto"));
  $("btn-mode-manual").addEventListener("click", () => setMode("manual"));
  $("btn-strategy-run").addEventListener("click", () => runStrategy());
  $("btn-manual-run").addEventListener("click", () => runManual());
  $("btn-tg-test").addEventListener("click", () => sendTest());
  $("btn-tg-signal").addEventListener("click", () => sendLastSignal());
  $("btn-close-pos").addEventListener("click", closePosition);
}

function runManual() {
  const side = $("manual-side").value;
  const entry = parseFloat($("manual-entry").value);
  const sl = parseFloat($("manual-sl").value);
  const tp = parseFloat($("manual-tp").value);
  const size = parseFloat($("manual-size").value) || 25;
  if (!entry || !sl || !tp) { log("⚠️ Isi entry / SL / TP dulu."); return Promise.resolve(false); }
  const msg = buildSignal((EXCHANGES[EXCHANGE] || EXCHANGES.BINANCE).label, tvSymbol(), INTERVAL, side, entry, sl, tp, size, "Manual Setup");
  STATE.lastSignal = msg;
  saveState();
  STATE.position = { side: side, entry: entry, sl: sl, tp: tp, size: size, symbol: tvSymbol() };
  saveState();
  return tgSend($("tg-token").value.trim(), $("tg-chatid").value.trim(), msg).then((ok) => {
    log(ok ? "Manual signal terkirim ke Telegram ✅" : "Gagal kirim manual signal ke Telegram ❌");
    return ok;
  });
}

async function loadTrending() {
  try {
    const r = await fetch("https://api.coingecko.com/api/v3/search/trending");
    const j = await r.json();
    const coins = j.coins || [];
    const list = $("trending-list");
    list.innerHTML = "";
    for (const c of coins.slice(0, 10)) {
      let sym = null;
      for (const k of Object.keys(COINGECKO_IDS)) {
        if (COINGECKO_IDS[k] === c.item_id) { sym = k; break; }
      }
      const li = document.createElement("li");
      const left = document.createElement("span");
      left.className = "trending-name";
      left.textContent = (c.item_name || c.item_id) + " " + (c.item_symbol ? "(" + c.item_symbol + ")" : "");
      const btn = document.createElement("button");
      btn.className = "btn small";
      btn.textContent = "Trading";
      btn.addEventListener("click", async () => {
        if (sym) {
          SYMBOL = sym;
          saveState();
          refreshChart();
          await refreshMarket();
          const msg = await runStrategy();
          if (msg) {
            const ok = await tgSend($("tg-token").value.trim(), $("tg-chatid").value.trim(), msg);
            log(ok ? "Trending signal terkirim ke Telegram OK" : "Gagal kirim trending signal");
          }
        }
      });
      li.appendChild(left);
      li.appendChild(btn);
      list.appendChild(li);
    }
  } catch (e) { log("Gagal ambil trending coins: " + e); }
}

async function fetchWhales() {
  try {
    const r = await fetch("https://api.gateio.ws/api/v4/spot/trades?currency_pair=BTC_USDT&limit=100");
    const trades = await r.json();
    const whales = [];
    for (const tr of trades) {
      const p = parseFloat(tr.price || 0);
      const a = parseFloat(tr.amount || 0);
      const usd = p * a;
      const side = (tr.side || "").toLowerCase();
      if (usd >= 7000) {
        whales.push({ side: side, usd: usd, price: p, amount: a, time: tr.create_time });
      }
    }
    const list = $("whale-list");
    list.innerHTML = "";
    if (!whales.length) {
      const li = document.createElement("li");
      const sp = document.createElement("span");
      sp.className = "trending-name";
      sp.textContent = "Belum ada transaksi whale > 7000 USD.";
      li.appendChild(sp);
      list.appendChild(li);
      return;
    }
    for (const w of whales.slice(0, 10)) {
      const li = document.createElement("li");
      const sp = document.createElement("span");
      sp.className = "trending-name";
      sp.textContent = (w.side === "buy" ? "BUY" : "SELL") + " $" + w.usd.toFixed(0) + " @ $" + w.price.toFixed(1) + " (" + (w.time || "") + ")";
      li.appendChild(sp);
      list.appendChild(li);
    }
  } catch (e) { log("Gagal ambil whale data: " + e); }
}

async function closePosition() {
  if (!STATE.position) { log("Tidak ada posisi untuk ditutup."); return false; }
  const pos = STATE.position;
  const price = LAST_PRICE;
  const pnl = pos.side === "LONG" ? ((price - pos.entry) / pos.entry) * pos.size : ((pos.entry - price) / pos.entry) * pos.size;
  STATE.position = null;
  saveState();
  log("POSITION CLOSED " + pos.side + " pnl=" + pnl.toFixed(2));
  const ok = await tgSend($("tg-token").value.trim(), $("tg-chatid").value.trim(),
    "*CRYPTO BOT*\nPOSITION CLOSED\nSide: " + pos.side + "\nEntry: $" + pos.entry + "\nClose: $" + price + "\nPnL: $" + pnl.toFixed(2) + "\nSize: " + pos.size + " USDT");
  return ok;
}

async function loadRevival() {
  try {
    const r = await fetch("https://api.coingecko.com/api/v3/search/trending");
    const j = await r.json();
    const coins = j.coins || [];
    const list = $("revival-list");
    list.innerHTML = "";
    for (const c of coins.slice(0, 10)) {
      const li = document.createElement("li");
      const sp = document.createElement("span");
      sp.className = "trending-name";
      sp.textContent = (c.item_name || c.item_id) + " " + (c.item_symbol ? "(" + c.item_symbol + ")" : "") + " - revival watch";
      li.appendChild(sp);
      list.appendChild(li);
    }
  } catch (e) { log("Gagal ambil revival: " + e); }
}

async function loadApr() {
  const list = $("apr-list");
  list.innerHTML = "";
  const items = ["BTC - Staking APR ~3.5%", "ETH - Staking APR ~3.2%", "SOL - Staking APR ~6.5%"];
  for (const it of items) {
    const li = document.createElement("li");
    const sp = document.createElement("span");
    sp.className = "trending-name";
    sp.textContent = it;
    li.appendChild(sp);
    list.appendChild(li);
  }
}

async function loadPools() {
  const list = $("pools-list");
  list.innerHTML = "";
  const items = ["NEW POOL: ETH/USDT - liquidity added", "NEW POOL: SOL/USDT - liquidity added", "NEW POOL: BNB/USDT - liquidity added"];
  for (const it of items) {
    const li = document.createElement("li");
    const sp = document.createElement("span");
    sp.className = "trending-name";
    sp.textContent = it;
    li.appendChild(sp);
    list.appendChild(li);
  }
}

async function loadCats() {
  const list = $("cats-list");
  list.innerHTML = "";
  const items = ["DeFi", "Meme", "Layer2", "AI", "Gaming"];
  for (const it of items) {
    const li = document.createElement("li");
    const sp = document.createElement("span");
    sp.className = "trending-name";
    sp.textContent = it;
    li.appendChild(sp);
    list.appendChild(li);
  }
}

async function loadTools() {
  const list = $("tools-list");
  list.innerHTML = "";
  const items = ["RSI Scanner", "MACD Strategy", "S/R Zones", "Whale Radar", "Signal Generator"];
  for (const it of items) {
    const li = document.createElement("li");
    const sp = document.createElement("span");
    sp.className = "trending-name";
    sp.textContent = it;
    li.appendChild(sp);
    list.appendChild(li);
  }
}

function setupNav() {
  const navEl = document.getElementById("main-nav");
  if (!navEl) { return; }
  const btns = navEl.querySelectorAll(".nav-btn");
  btns.forEach((b) => {
    b.addEventListener("click", () => {
      const key = b.getAttribute("data-nav");
      document.querySelectorAll(".nav-btn").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      const map = {
        dashboard: "sec-dashboard",
        trending: "sec-trending",
        revival: "sec-revival",
        apr: "sec-apr",
        pools: "sec-pools",
        cats: "sec-cats",
        tools: "sec-tools"
      };
      const secId = map[key];
      document.querySelectorAll("[id^='sec-']").forEach((el) => {
        if (el.id === secId) { el.classList.remove("hidden"); }
        else { el.classList.add("hidden"); }
      });
    });
  });
}

async function init() {
  STATE = loadState();
  $("tg-token").value = localStorage.getItem("tg_token") || "";
  $("tg-chatid").value = localStorage.getItem("tg_chat_id") || "";
  setMode(STATE.mode);
  bindEvents();
  setupNav();
  refreshChart();
  await refreshMarket();
  await loadTrending();
  await fetchWhales();
  await loadRevival();
  await loadApr();
  await loadPools();
  await loadCats();
  await loadTools();
  if (STATE.mode === "auto") { await runStrategy(); }
  setInterval(refreshMarket, 30000);
  setInterval(() => { if (STATE.mode === "auto") runStrategy(); }, 60000);
  setInterval(loadTrending, 600000);
  setInterval(fetchWhales, 300000);
}

init();






