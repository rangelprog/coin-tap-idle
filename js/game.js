"use strict";

/* ============================================================
   Coin Tap Idle – Spiel-Logik
   Werbe-Integration: siehe AdBridge unten + README (AdMob/AdSense)
   ============================================================ */

window.sessionActive = false;

const SAVE_KEY = "coin-tap-idle-save-v1";
const TICK_MS = 100;
const OFFLINE_CAP_SECONDS = 8 * 3600; // max. 8h Offline-Ertrag
const BOOST_HOURS = 2;

const FMT = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });

const UPGRADES = [
  {
    id: "tap",
    name: "Tap Power",
    desc: "+1 Münze pro Tipp",
    baseCost: 15,
    costMult: 1.15,
    effect: (lvl) => ({ tapPower: lvl }),
  },
  {
    id: "auto",
    name: "Auto-Tapper",
    desc: "+1 Münze pro Sekunde",
    baseCost: 25,
    costMult: 1.18,
    effect: (lvl) => ({ autoCps: lvl }),
  },
  {
    id: "lucky",
    name: "Glückstreffer",
    desc: "+10% Chance auf Krit (max. 50%)",
    baseCost: 400,
    costMult: 2.0,
    effect: (lvl) => ({ critChance: Math.min(0.5, lvl * 0.1) }),
  },
  {
    id: "factory",
    name: "Münzfabrik",
    desc: "+10 Münzen pro Sekunde",
    baseCost: 800,
    costMult: 1.6,
    effect: (lvl) => ({ autoCps: lvl * 10 }),
  },
  {
    id: "gold",
    name: "Goldene Münze",
    desc: "+10% deines Auto-Ertrags pro Tipp (pro Stufe)",
    baseCost: 2500,
    costMult: 2.0,
    effect: () => ({}),
  },
  {
    id: "crit",
    name: "Krit-Schaden",
    desc: "+5× Krit-Multiplikator pro Stufe",
    baseCost: 3000,
    costMult: 2.5,
    effect: () => ({}),
  },
  {
    id: "offline",
    name: "Offline-Meister",
    desc: "+10% Offline-Ertrag pro Stufe (max. 100%)",
    baseCost: 4000,
    costMult: 2.2,
    effect: () => ({}),
  },
  {
    id: "mega",
    name: "Mega-Tapper",
    desc: "+100 Münzen pro Sekunde",
    baseCost: 10000,
    costMult: 1.8,
    effect: (lvl) => ({ autoCps: lvl * 100 }),
  },
];

const ACHIEVEMENTS = [
  { id: "first_tap", name: "Erster Tipp", desc: "Tippe 1× auf die Münze", reward: 50, gem: false, check: () => state.stats.taps >= 1 },
  { id: "taps_100", name: "Fleißig", desc: "100 Tipps", reward: 500, gem: false, check: () => state.stats.taps >= 100 },
  { id: "taps_1000", name: "Tipp-Maschine", desc: "1.000 Tipps", reward: 5000, gem: false, check: () => state.stats.taps >= 1000 },
  { id: "coins_10k", name: "Sparschwein", desc: "10.000 Münzen insgesamt verdient", reward: 2500, gem: false, check: () => state.totalEarned >= 10000 },
  { id: "coins_1m", name: "Millionär", desc: "1.000.000 Münzen insgesamt verdient", reward: 100000, gem: false, check: () => state.totalEarned >= 1e6 },
  { id: "cps_10", name: "Produktion", desc: "10 Münzen/Sek. (Basis)", reward: 1000, gem: false, check: () => state.autoCps >= 10 },
  { id: "cps_100", name: "Fabrikbesitzer", desc: "100 Münzen/Sek. (Basis)", reward: 20000, gem: false, check: () => state.autoCps >= 100 },
  { id: "upgrades_10", name: "Investor", desc: "10 Upgrades gekauft", reward: 5000, gem: false, check: () => state.stats.upgradesBought >= 10 },
  { id: "prestige_1", name: "Neustart", desc: "1. Prestige", reward: 1, gem: true, check: () => state.stats.prestiges >= 1 },
  { id: "gems_10", name: "Edelstein-Sammler", desc: "10 Edelsteine besitzen", reward: 2, gem: true, check: () => state.totalGemsEarned >= 10 },
];

/* ============================================================
   Event-Tracking für Offerwalls (Swagbucks, Freecash & Co.)
   Netzwerke (Tapjoy, ironSource, Fyber, AdGem, OfferToro …)
   verfolgen diese Events, um Offer-Ziele wie
   "Erreiche 10.000 Münzen" zu bestätigen.
   ============================================================ */

const EVENTS = {
  GAME_START: "game_start",
  FIRST_TAP: "first_tap",
  ACHIEVEMENT_UNLOCKED: "achievement_unlocked",
  UPGRADE_PURCHASED: "upgrade_purchased",
  DAILY_CLAIMED: "daily_claimed",
  BOOST_REDEEMED: "boost_redeemed",
  PRESTIGE_DONE: "prestige_done",
  ANTI_CHEAT_FLAG: "anti_cheat_flag",
  STATS_UPDATE: "stats_update",
};

const SESSION_ID = Math.random().toString(36).slice(2) + Date.now().toString(36);

const DEVICE_COOKIE = "cti_device_id";
const NAME_COOKIE = "cti_player_name";

function readCookie(name) {
  try {
    const match = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
    return match ? decodeURIComponent(match[1]) : "";
  } catch (err) {
    return "";
  }
}

function writeCookie(name, value, days) {
  try {
    const expires = new Date(Date.now() + days * 86400000).toUTCString();
    document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
  } catch (err) {
    console.warn("Cookie schreiben fehlgeschlagen:", err);
  }
}

function getPlayerId() {
  let id = "";
  try {
    id = localStorage.getItem("cti-player-id") || "";
  } catch (err) {
    /* localStorage nicht verfügbar */
  }
  if (!id) id = readCookie(DEVICE_COOKIE);
  if (!id) {
    id = "p" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }
  try {
    localStorage.setItem("cti-player-id", id);
  } catch (err) {
    /* ignorieren */
  }
  writeCookie(DEVICE_COOKIE, id, 365);
  return id;
}

function getPlayerName() {
  try {
    return localStorage.getItem("cti-player-name") || readCookie(NAME_COOKIE) || "Spieler-" + getPlayerId().slice(-4);
  } catch (err) {
    return "Spieler-" + getPlayerId().slice(-4);
  }
}

const EVENT_QUEUE = [];
const FLUSH_INTERVAL_MS = 30000; // Alle 30 Sekunden gebündelt absenden

function flushEventQueue() {
  if (EVENT_QUEUE.length === 0) return;
  const serverUrl = window.OFFERWALL_SERVER_URL;
  if (!serverUrl) {
    EVENT_QUEUE.length = 0;
    return;
  }

  const batch = EVENT_QUEUE.splice(0, EVENT_QUEUE.length);
  fetch(`${serverUrl}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(batch),
  }).catch((err) => {
    console.warn("Event-Batch konnte nicht gesendet werden:", err);
    if (EVENT_QUEUE.length < 100) {
      EVENT_QUEUE.unshift(...batch);
    }
  });
}

// Intervall für regelmäßiges Senden starten
setInterval(flushEventQueue, FLUSH_INTERVAL_MS);

function trackEvent(name, params) {
  const payload = Object.assign(
    {
      game: "coin_tap_idle",
      name,
      ts: Date.now(),
      session_id: SESSION_ID,
      player_id: getPlayerId(),
      player_name: getPlayerName(),
      anti_cheat_ok: !state.antiCheat.flagged,
    },
    params || {}
  );
  try {
    // Hook 1: Analytics/Attribution (z. B. AppsFlyer, Adjust)
    if (window.GameAnalytics && typeof window.GameAnalytics.trackEvent === "function") {
      window.GameAnalytics.trackEvent(name, payload);
    }
    // Hook 2: Offerwall-SDK (z. B. Tapjoy, ironSource, Fyber)
    if (window.OfferwallSDK && typeof window.OfferwallSDK.trackEvent === "function") {
      window.OfferwallSDK.trackEvent(name, payload);
    }
  } catch (err) {
    console.warn("Event-Tracking fehlgeschlagen:", err);
  }
  console.debug("[event]", name, payload);
  
  // Statt game_start blind in die Queue zu werfen:
  if (name === "game_start") {
    // Direkt einzeln abschicken, damit der Worker sofort die Session anlegt!
    const serverUrl = window.OFFERWALL_SERVER_URL;
    if (serverUrl) {
      fetch(`${serverUrl}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload), // Einzelnes Objekt statt Array!
      }).catch((err) => console.warn("game_start Direktversand fehlgeschlagen:", err));
    }
  } else {
    // Alle anderen Events (wie stats_update) wandern normal in die Queue
    EVENT_QUEUE.push(payload);
    
    if (name === "achievement_unlocked" || name === "prestige_done") {
      flushEventQueue();
    }
  }
}

// Für Tests/Integration von außen erreichbar machen.
window.CoinTapIdle = {
  trackEvent,
  EVENTS,
  ACHIEVEMENTS,
  getAntiCheatReport: () => ({
    flagged: state.antiCheat.flagged,
    trackedTaps: state.antiCheat.taps.length,
    session_id: SESSION_ID,
  }),
  clearAntiCheatFlag: () => {
    state.antiCheat.flagged = false;
    save();
  },
};

const state = {
  coins: 0,
  totalEarned: 0,
  gems: 0,
  totalGemsEarned: 0,
  tapPower: 1,
  autoCps: 0,
  critChance: 0,
  critMult: 10,
  offlineRate: 0.5,
  upgrades: {},
  perks: {},
  boostUntil: 0,
  lastSeen: Date.now(),
  achievements: {},
  stats: { taps: 0, upgradesBought: 0, playSeconds: 0, maxCps: 0, prestiges: 0 },
  daily: { lastClaim: "", streak: 0 },
  minigames: { rainLast: 0, wheelLast: "" },
  antiCheat: { flagged: false, taps: [], lastTap: 0, lastCollect: 0, lastClock: 0 },
  combo: { count: 0, lastTapAt: 0, best: 0 },
  golden: { nextAt: 0, active: false, expiresAt: 0 },
  quests: { date: "", list: [] },
  dailyStats: { date: "", taps: 0, earned: 0, upgrades: 0, questsDone: 0, minigames: 0, prestiges: 0, gemsEarned: 0, claimed: false },
};

const PERKS = [
  { id: "start_cash", name: "Startkapital", desc: "+100 Münzen nach jedem Prestige (pro Stufe)", baseCost: 1, maxLevel: 5 },
  { id: "tap_boost", name: "Starke Finger", desc: "+25% Tap Power (pro Stufe)", baseCost: 2, maxLevel: 5 },
  { id: "cps_boost", name: "Motivierte Arbeiter", desc: "+25% Auto-Ertrag (pro Stufe)", baseCost: 3, maxLevel: 5 },
  { id: "offline_boost", name: "Nachtarbeiter", desc: "+20% Offline-Ertrag (pro Stufe)", baseCost: 2, maxLevel: 5 },
];

/* ---------- Retention-Systeme ---------- */

const COMBO_WINDOW_MS = 2000;   // so lange bleibt die Combo aktiv
const COMBO_STEP = 25;          // alle 25 Tipps +1×
const COMBO_MAX_MULT = 5;

const GOLDEN_MIN_MS = 60 * 1000;
const GOLDEN_MAX_MS = 120 * 1000;
const GOLDEN_LIFETIME_MS = 15 * 1000;

const QUEST_DEFS = [
  { id: "taps", label: "Tippe 200×", target: 200, reward: 500 },
  { id: "upgrades", label: "Kaufe 3 Upgrades", target: 3, reward: 800 },
  { id: "rain", label: "Spiele 1× Münzregen", target: 1, reward: 1000 },
  { id: "wheel", label: "Drehe 1× das Glücksrad", target: 1, reward: 1000 },
  { id: "daily", label: "Hole die Tagesbelohnung", target: 1, reward: 300 },
  { id: "earn", label: "Verdiene 5.000 Münzen", target: 5000, reward: 600 },
];

/* ---------- Anti-Cheat (Client-Härtung) ----------
   Hinweis: Client-Schutz ist nur die erste Hürde. Echte
   Offerwall-Sicherheit braucht serverseitige Validierung –
   siehe docs/anti-cheat.md. */

const SAVE_SALT = "cti-7f3a9k2";

function checksum(str) {
  let h = 2166136261 >>> 0; // FNV-1a
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function flagAntiCheat(reason) {
  if (state.antiCheat.flagged) return;
  state.antiCheat.flagged = true;
  console.warn("[anti-cheat] Verdacht:", reason);
  try {
    showToast("⚠️ Ungewöhnliches Verhalten erkannt");
  } catch (err) {
    /* Toast evtl. noch nicht bereit */
  }
  trackEvent(EVENTS.ANTI_CHEAT_FLAG, { reason });
}

function isBotLikeTap(now) {
  // Nur physikalisch unplausible Klicks blockieren (> 20 Tipps/Sek.).
  // Regelmäßiges, schnelles Tippen ist NORMAL und wird nie bestraft.
  if (now - state.antiCheat.lastTap < 50) return true;

  const taps = state.antiCheat.taps;
  // Neue Tipp-Serie beginnen, wenn eine Pause > 2s war.
  if (taps.length > 0 && now - taps[taps.length - 1] > 2000) {
    taps.length = 0;
  }
  taps.push(now);
  if (taps.length > 40) taps.shift();
  state.antiCheat.lastTap = now;
  return false;
}

function isClockManipulated(now) {
  if (state.antiCheat.lastClock && now < state.antiCheat.lastClock - 5000) {
    flagAntiCheat("Uhr zurückgedreht");
    return true;
  }
  return false;
}

/* ---------- Persistenz ---------- */

function save() {
  state.lastSeen = Date.now();
  state.antiCheat.lastClock = Date.now();
  try {
    const copy = Object.assign({}, state);
    delete copy._c;
    const json = JSON.stringify(copy);
    copy._c = checksum(json + SAVE_SALT);
    localStorage.setItem(SAVE_KEY, JSON.stringify(copy));
  } catch (err) {
    console.warn("Speichern fehlgeschlagen:", err);
  }
}

function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);

    // Prüfsumme: Manipulationen am Spielstand erkennen.
    const storedChecksum = saved._c;
    delete saved._c;
    const expected = checksum(JSON.stringify(saved) + SAVE_SALT);
    if (storedChecksum !== expected) {
      console.warn("[anti-cheat] Spielstand manipuliert – wird verworfen.");
      state.antiCheat.flagged = true;
      localStorage.removeItem(SAVE_KEY);
      return;
    }

    Object.assign(state, saved);
    // Fehlende Felder aus älteren Spielständen ergänzen
    state.stats = Object.assign({ taps: 0, upgradesBought: 0, playSeconds: 0, maxCps: 0, prestiges: 0 }, state.stats);
    state.daily = Object.assign({ lastClaim: "", streak: 0 }, state.daily);
    state.achievements = state.achievements || {};
    state.perks = state.perks || {};
    state.minigames = Object.assign({ rainLast: 0, wheelLast: "" }, state.minigames);
    state.antiCheat = Object.assign(
      { flagged: false, taps: [], lastTap: 0, lastCollect: 0, lastClock: Date.now() },
      state.antiCheat
    );
    // Flag gilt nur für die aktuelle Sitzung – nie dauerhaft speichern,
    // sonst bleiben echte Spieler nach einem Fehlalarm für immer blockiert.
    state.antiCheat.flagged = false;
    state.combo = Object.assign({ count: 0, lastTapAt: 0, best: 0 }, state.combo);
    state.golden = Object.assign({ nextAt: 0, active: false, expiresAt: 0 }, state.golden);
    state.quests = Object.assign({ date: "", list: [] }, state.quests);
    state.dailyStats = Object.assign(
      { date: "", taps: 0, earned: 0, upgrades: 0, questsDone: 0, minigames: 0, prestiges: 0, gemsEarned: 0, claimed: false },
      state.dailyStats
    );
    if (typeof state.totalGemsEarned !== "number") {
      state.totalGemsEarned = state.gems || 0;
    }
  } catch (err) {
    console.warn("Laden fehlgeschlagen:", err);
  }
}

function hardReset() {
  if (confirm("Wirklich alles zurücksetzen? Dein gesamter Fortschritt geht verloren.")) {
    localStorage.removeItem(SAVE_KEY);
    location.reload();
  }
}

/* ---------- Abgeleitete Werte ---------- */

function upgradeCost(def) {
  const lvl = state.upgrades[def.id] || 0;
  return Math.ceil(def.baseCost * Math.pow(def.costMult, lvl));
}

function perkLevel(id) {
  return state.perks[id] || 0;
}

function gemMultiplier() {
  return 1 + state.totalGemsEarned * 0.1;
}

function isBoostActive() {
  return Date.now() < state.boostUntil;
}

function effectiveMultiplier() {
  return gemMultiplier() * (isBoostActive() ? 2 : 1);
}

function effectiveTapPower() {
  return state.tapPower * effectiveMultiplier() * (1 + perkLevel("tap_boost") * 0.25);
}

function effectiveCps() {
  return state.autoCps * effectiveMultiplier() * (1 + perkLevel("cps_boost") * 0.25);
}

function pendingGems() {
  return Math.floor(Math.sqrt(state.totalEarned / 1000));
}

/* ---------- Belohnungs-Skalierung ----------
   Feste Belohnungen (Glücksrad, Tagesbelohnung, Erfolge …)
   wachsen mit Prestige-Stufe und gekauften Upgrades. */

function totalUpgradeLevels() {
  let sum = 0;
  for (const id in state.upgrades) {
    sum += state.upgrades[id] || 0;
  }
  return sum;
}

function rewardScale() {
  return gemMultiplier() * (1 + state.stats.prestiges * 0.5) * (1 + totalUpgradeLevels() * 0.1);
}

function scaledCoins(base) {
  return Math.max(1, Math.floor(base * rewardScale()));
}

/* ---------- Combo ---------- */

function comboMultiplier() {
  return Math.min(COMBO_MAX_MULT, 1 + Math.floor(state.combo.count / COMBO_STEP));
}

function registerTapCombo(now) {
  if (now - state.combo.lastTapAt <= COMBO_WINDOW_MS) {
    state.combo.count += 1;
  } else {
    state.combo.count = 1;
  }
  state.combo.lastTapAt = now;
  if (state.combo.count > state.combo.best) state.combo.best = state.combo.count;
}

function updateComboDecay(now) {
  if (state.combo.count > 0 && now - state.combo.lastTapAt > COMBO_WINDOW_MS) {
    state.combo.count = 0;
  }
}

/* ---------- Goldene Münze ---------- */

function scheduleNextGolden(now) {
  state.golden.nextAt = now + GOLDEN_MIN_MS + Math.random() * (GOLDEN_MAX_MS - GOLDEN_MIN_MS);
  state.golden.active = false;
  state.golden.expiresAt = 0;
}

function updateGolden(now) {
  const el = document.getElementById("golden-coin");
  if (!state.golden.active) {
    if (!state.golden.nextAt) scheduleNextGolden(now);
    if (now >= state.golden.nextAt) {
      state.golden.active = true;
      state.golden.expiresAt = now + GOLDEN_LIFETIME_MS;
      if (el) {
        el.hidden = false;
        el.style.left = `${10 + Math.random() * 70}%`;
        el.style.top = `${5 + Math.random() * 40}%`;
      }
    }
  } else if (now >= state.golden.expiresAt) {
    if (el) el.hidden = true;
    scheduleNextGolden(now);
  }
}

function collectGolden() {
  if (!state.golden.active) return;
  const base = Math.max(scaledCoins(1000), Math.floor(effectiveCps() * 60));
  addCoins(base);
  state.golden.active = false;
  const el = document.getElementById("golden-coin");
  if (el) el.hidden = true;
  scheduleNextGolden(Date.now());
  showToast(`🌟 Goldene Münze: +${FMT.format(base)} Münzen!`);
  render();
}

/* ---------- Tages-Quests ---------- */

function ensureQuests() {
  const today = todayKey();
  if (state.quests.date === today && state.quests.list.length > 0) return;
  const shuffled = QUEST_DEFS.slice().sort(() => Math.random() - 0.5);
  state.quests.date = today;
  state.quests.list = shuffled.slice(0, 3).map((def) => ({
    id: def.id,
    label: def.label,
    target: def.target,
    reward: def.reward,
    progress: 0,
    done: false,
  }));
}

function bumpQuest(id, amount) {
  ensureQuests();
  for (const q of state.quests.list) {
    if (q.id !== id || q.done) continue;
    q.progress += amount;
    if (q.progress >= q.target) {
      q.progress = q.target;
      q.done = true;
      ensureDailyStats();
      state.dailyStats.questsDone += 1;
      const reward = scaledCoins(q.reward);
      addCoins(reward);
      showToast(`✅ Quest geschafft: ${q.label} – +${FMT.format(reward)} Münzen`);
      save();
    }
  }
}

function renderQuests() {
  const list = document.getElementById("quest-list");
  if (!list) return;
  ensureQuests();
  list.innerHTML = "";

  for (const q of state.quests.list) {
    const pct = Math.min(100, Math.floor((q.progress / q.target) * 100));
    const card = document.createElement("div");
    card.className = q.done ? "quest done" : "quest";

    const head = document.createElement("div");
    head.className = "quest-head";
    const label = document.createElement("span");
    label.textContent = `${q.done ? "✅" : "📋"} ${q.label}`;
    const reward = document.createElement("span");
    reward.className = "quest-reward";
    reward.textContent = `+${FMT.format(scaledCoins(q.reward))} 🪙`;
    head.appendChild(label);
    head.appendChild(reward);

    const bar = document.createElement("div");
    bar.className = "quest-bar";
    const fill = document.createElement("div");
    fill.className = "quest-fill";
    fill.style.width = `${pct}%`;
    bar.appendChild(fill);

    const progress = document.createElement("div");
    progress.className = "quest-progress";
    progress.textContent = `${FMT.format(Math.min(q.progress, q.target))} / ${FMT.format(q.target)}`;

    card.appendChild(head);
    card.appendChild(bar);
    card.appendChild(progress);
    list.appendChild(card);
  }
}

/* ---------- Tagesbelohnung ---------- */

function dateKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function todayKey() {
  return dateKey(Date.now());
}

function yesterdayKey() {
  return dateKey(Date.now() - 86400000);
}

function canClaimDaily() {
  return state.daily.lastClaim !== todayKey();
}

function nextDailyStreak() {
  return state.daily.lastClaim === yesterdayKey() ? state.daily.streak + 1 : 1;
}

function dailyRewardForStreak(streak) {
  return 100 * Math.pow(2, Math.min(streak - 1, 7));
}

function claimDaily() {
  if (!canClaimDaily()) return;
  const streak = nextDailyStreak();
  const reward = scaledCoins(dailyRewardForStreak(streak));
  state.daily.streak = streak;
  state.daily.lastClaim = todayKey();
  trackEvent(EVENTS.DAILY_CLAIMED, { streak });
  bumpQuest("daily", 1);
  addCoins(reward);
  save();
  render();
  showToast(`🎁 Tagesbelohnung: ${FMT.format(reward)} Münzen (Tag ${streak})`);
}

/* ---------- Aktionen ---------- */

function addCoins(amount) {
  state.coins += amount;
  state.totalEarned += amount;
  ensureDailyStats();
  state.dailyStats.earned += amount;
  bumpQuest("earn", amount);
}

function tapCoin(event) {
  // Nur echte Nutzer-Eingaben zählen (kein dispatchEvent/JS-Bot).
  if (!event || !event.isTrusted) return;
  const now = Date.now();
  if (isBotLikeTap(now)) return;

  state.stats.taps += 1;
  if (state.stats.taps === 1) trackEvent(EVENTS.FIRST_TAP);
  registerTapCombo(now);
  bumpQuest("taps", 1);
  ensureDailyStats();
  state.dailyStats.taps += 1;

  const critRoll = Math.random() < state.critChance;
  const comboMult = comboMultiplier();
  const gain = (critRoll ? effectiveTapPower() * state.critMult : effectiveTapPower()) * comboMult;
  addCoins(gain);
  showFloatingGain(event, gain, critRoll);
  checkAchievements();
  render();
}

function buyUpgrade(id) {
  const def = UPGRADES.find((u) => u.id === id);
  if (!def) return;
  const cost = upgradeCost(def);
  if (state.coins < cost) return;
  state.coins -= cost;
  state.upgrades[id] = (state.upgrades[id] || 0) + 1;
  state.stats.upgradesBought += 1;
  trackEvent(EVENTS.UPGRADE_PURCHASED, { upgrade_id: id, level: state.upgrades[id] });
  bumpQuest("upgrades", 1);
  ensureDailyStats();
  state.dailyStats.upgrades += 1;
  applyUpgradeEffects();
  save();
  checkAchievements();
  render();
}

function applyUpgradeEffects() {
  // Basiswerte zurücksetzen und aus allen Upgrade-Stufen neu berechnen.
  state.tapPower = 1;
  state.autoCps = 0;
  state.critChance = 0;
  state.critMult = 10;
  state.offlineRate = 0.5;

  for (const def of UPGRADES) {
    const lvl = state.upgrades[def.id] || 0;
    if (lvl === 0) continue;
    const eff = def.effect(lvl);
    if (eff.tapPower) state.tapPower += eff.tapPower;
    if (eff.autoCps) state.autoCps += eff.autoCps;
    if (eff.critChance) state.critChance = Math.max(state.critChance, eff.critChance);
  }

  // Spezial-Upgrades (nicht über die Standard-Effekte abgedeckt)
  const goldLvl = state.upgrades.gold || 0;
  if (goldLvl > 0) state.tapPower += Math.floor(state.autoCps * 0.1 * goldLvl);

  const critLvl = state.upgrades.crit || 0;
  state.critMult += critLvl * 5;

  const offlineLvl = state.upgrades.offline || 0;
  state.offlineRate = Math.min(1, 0.5 + offlineLvl * 0.1);
}

function doPrestige() {
  const gems = pendingGems();
  if (gems < 1) return;
  state.totalGemsEarned += gems;
  state.gems += gems;
  state.stats.prestiges += 1;
  ensureDailyStats();
  state.dailyStats.prestiges += 1;
  state.dailyStats.gemsEarned += gems;
  trackEvent(EVENTS.PRESTIGE_DONE, { gems_gained: gems });
  state.coins = 0;
  state.totalEarned = 0;
  state.tapPower = 1;
  state.autoCps = 0;
  state.critChance = 0;
  state.critMult = 10;
  state.offlineRate = 0.5;
  state.upgrades = {};
  state.boostUntil = 0;
  const startCash = scaledCoins(perkLevel("start_cash") * 100);
  if (startCash > 0) state.coins += startCash;
  save();
  AdBridge.showInterstitial(); // Werbe-Slot: Interstitial nach Prestige
  checkAchievements();
  render();
  showToast(`💎 +${gems} Edelstein${gems === 1 ? "" : "e"}! Alles wird ${Math.round(gemMultiplier() * 100)}% wert.`);
}

/* ---------- Erfolge ---------- */

function checkAchievements() {
  for (const a of ACHIEVEMENTS) {
    if (state.achievements[a.id]) continue;
    if (!a.check()) continue;
    state.achievements[a.id] = true;
    trackEvent(EVENTS.ACHIEVEMENT_UNLOCKED, { achievement_id: a.id });
    if (a.gem) {
      state.gems += a.reward;
      ensureDailyStats();
      state.dailyStats.gemsEarned += a.reward;
      showToast(`🏆 ${a.name}: +${a.reward} 💎`);
    } else {
      const reward = scaledCoins(a.reward);
      addCoins(reward);
      showToast(`🏆 ${a.name}: +${FMT.format(reward)} Münzen`);
    }
  }
}

/* ---------- Werbung (AdBridge) ----------
   Für echtes Geld: AdMob (native App via Capacitor) oder AdSense (Web).
   Ersetze die Funktionen durch dein echtes SDK-Plugin.
   Siehe README für die vollständige Anleitung. */

const AdBridge = {
  showRewarded(onResult) {
    if (window.admob && typeof window.admob.showRewarded === "function") {
      // Echt: window.admob.showRewarded muss onResult(true/false) aufrufen,
      // wenn der Nutzer das Video zu Ende gesehen hat.
      window.admob.showRewarded(onResult);
    } else {
      // Demo-Modus: kein Ad-SDK verbunden -> Boost direkt freischalten.
      console.warn("AdMob nicht verbunden – Boost wird im Demo-Modus freigeschaltet.");
      onResult(true);
    }
  },
  showInterstitial() {
    if (window.admob && typeof window.admob.showInterstitial === "function") {
      window.admob.showInterstitial();
    } else {
      console.warn("AdMob nicht verbunden – Interstitial übersprungen (Demo-Modus).");
    }
  },
};

function requestBoost() {
  AdBridge.showRewarded((watched) => {
    if (watched) {
      state.boostUntil = Date.now() + BOOST_HOURS * 3600 * 1000;
      trackEvent(EVENTS.BOOST_REDEEMED);
      save();
      render();
      showToast(`🔥 2× Boost aktiv für ${BOOST_HOURS} Stunden!`);
    } else {
      showToast("Werbung nicht zu Ende gesehen – kein Boost.");
    }
  });
}

/* ---------- Rendering ---------- */

function render() {
  const coinEl = document.getElementById("coin-count");
  const cpsEl = document.getElementById("cps");
  const gemsEl = document.getElementById("gems");
  const tapGainEl = document.getElementById("tap-gain");
  const boostEl = document.getElementById("boost-indicator");
  const boostBtn = document.getElementById("boost-btn");
  const prestigeInfo = document.getElementById("prestige-info");
  const prestigeBtn = document.getElementById("prestige-btn");

  coinEl.textContent = FMT.format(Math.floor(state.coins));
  cpsEl.textContent = `${FMT.format(Math.floor(effectiveCps()))} Münzen/Sek.`;
  gemsEl.textContent = `💎 ${state.gems}`;
  const comboMult = comboMultiplier();
  tapGainEl.textContent = comboMult > 1
    ? `+${FMT.format(Math.floor(effectiveTapPower() * comboMult))} 🔥${comboMult}×`
    : `+${FMT.format(Math.floor(effectiveTapPower()))}`;

  const boostActive = isBoostActive();
  boostEl.hidden = !boostActive;
  if (boostActive) {
    const mins = Math.ceil((state.boostUntil - Date.now()) / 60000);
    boostEl.textContent = `🔥 2× Boost aktiv (${mins} Min.)`;
  }
  boostBtn.disabled = boostActive;

  renderUpgrades();
  renderDaily();
  renderQuests();
  renderDailySummary();
  renderAchievements();
  renderStats();
  renderPerks();
  renderMinigames();

  const gems = pendingGems();
  prestigeInfo.textContent =
    state.totalEarned < 1000
      ? "Verdiene insgesamt 1.000 Münzen für deinen ersten Edelstein."
      : `Insgesamt verdient: ${FMT.format(Math.floor(state.totalEarned))} Münzen. Jeder Edelstein gibt +10% auf alles.`;
  prestigeBtn.textContent = `💎 Prestige: +${gems} Edelstein${gems === 1 ? "" : "e"}`;
  prestigeBtn.disabled = gems < 1;
  renderPrestigeProgress(gems);
}

function renderUpgrades() {
  const list = document.getElementById("upgrade-list");
  list.innerHTML = "";

  for (const def of UPGRADES) {
    const lvl = state.upgrades[def.id] || 0;
    const cost = upgradeCost(def);
    const btn = document.createElement("button");
    btn.className = "upgrade";
    btn.disabled = state.coins < cost;
    btn.setAttribute("data-upgrade", def.id);

    const info = document.createElement("span");
    info.className = "info";

    const name = document.createElement("span");
    name.className = "name";
    name.textContent = `${def.name} (Stufe ${lvl})`;

    const desc = document.createElement("span");
    desc.className = "desc";
    desc.textContent = def.desc;

    info.appendChild(name);
    info.appendChild(desc);

    const costEl = document.createElement("span");
    costEl.className = "cost";
    costEl.textContent = `🪙 ${FMT.format(cost)}`;

    btn.appendChild(info);
    btn.appendChild(costEl);
    btn.addEventListener("click", () => buyUpgrade(def.id));
    list.appendChild(btn);
  }
}

function renderDaily() {
  const info = document.getElementById("daily-info");
  const btn = document.getElementById("daily-btn");
  const can = canClaimDaily();

  if (can) {
    const reward = scaledCoins(dailyRewardForStreak(nextDailyStreak()));
    info.textContent = `Heute abholbar: ${FMT.format(reward)} Münzen. Aktuelle Serie: ${state.daily.streak} Tag(e).`;
    btn.textContent = "🎁 Tagesbelohnung abholen";
    btn.disabled = false;
  } else {
    info.textContent = `Heute schon abgeholt. Serie: ${state.daily.streak} Tag(e). Komm morgen wieder!`;
    btn.textContent = "✅ Abgeholt";
    btn.disabled = true;
  }
}

function renderAchievements() {
  const list = document.getElementById("achievement-list");
  list.innerHTML = "";

  for (const a of ACHIEVEMENTS) {
    const unlocked = !!state.achievements[a.id];
    const card = document.createElement("div");
    card.className = unlocked ? "achievement unlocked" : "achievement";
    card.setAttribute("data-achievement", a.id);

    const info = document.createElement("span");
    info.className = "info";

    const name = document.createElement("span");
    name.className = "name";
    name.textContent = `${unlocked ? "🏆" : "🔒"} ${a.name}`;

    const desc = document.createElement("span");
    desc.className = "desc";
    desc.textContent = a.desc;

    info.appendChild(name);
    info.appendChild(desc);

    const reward = document.createElement("span");
    reward.className = "reward";
    reward.textContent = a.gem ? `+${a.reward} 💎` : `+${FMT.format(scaledCoins(a.reward))} 🪙`;

    card.appendChild(info);
    card.appendChild(reward);
    list.appendChild(card);
  }
}

function renderStats() {
  const grid = document.getElementById("stats-grid");
  const mins = Math.floor(state.stats.playSeconds / 60);
  const secs = state.stats.playSeconds % 60;
  const time = mins > 0 ? `${mins} Min. ${secs} Sek.` : `${secs} Sek.`;

  const items = [
    ["Tipps", FMT.format(state.stats.taps)],
    ["Upgrades gekauft", FMT.format(state.stats.upgradesBought)],
    ["Spielzeit", time],
    ["Max. Basis-CPS", FMT.format(state.stats.maxCps)],
    ["Prestiges", FMT.format(state.stats.prestiges)],
    ["Geräte-ID", getPlayerId().slice(0, 12)],
  ];

  grid.innerHTML = "";
  for (const [label, value] of items) {
    const cell = document.createElement("div");
    cell.className = "stat-cell";
    const l = document.createElement("span");
    l.className = "stat-label";
    l.textContent = label;
    const v = document.createElement("span");
    v.className = "stat-value";
    v.textContent = value;
    cell.appendChild(l);
    cell.appendChild(v);
    grid.appendChild(cell);
  }
}

/* ---------- Tagesabschluss (Daily Recap) ---------- */

function ensureDailyStats() {
  const today = todayKey();
  if (state.dailyStats.date !== today) {
    state.dailyStats = {
      date: today,
      taps: 0,
      earned: 0,
      upgrades: 0,
      questsDone: 0,
      minigames: 0,
      prestiges: 0,
      gemsEarned: 0,
      claimed: false,
    };
  }
}

function renderDailySummary() {
  ensureDailyStats();
  const info = document.getElementById("summary-info");
  const btn = document.getElementById("summary-btn");
  if (!info || !btn) return;

  if (state.dailyStats.claimed) {
    btn.disabled = true;
    btn.textContent = "✅ Abgeschlossen";
    info.textContent = "Dein Tagesabschluss ist abgeholt. Morgen gibt's einen neuen!";
  } else {
    btn.disabled = false;
    btn.textContent = "🌙 Bericht ansehen & Belohnung holen";
    info.textContent = `Heute bisher: ${FMT.format(state.dailyStats.taps)} Tipps · ${FMT.format(state.dailyStats.earned)} Münzen verdient`;
  }
}

function claimDailySummary() {
  ensureDailyStats();
  if (state.dailyStats.claimed) return;
  const d = state.dailyStats;

  const base = 1000;
  const tapBonus = d.taps * 2;
  const earnBonus = Math.floor(d.earned * 0.02);
  const upgradeBonus = d.upgrades * 250;
  const questBonus = d.questsDone * 500;
  const miniBonus = d.minigames * 300;
  const reward = scaledCoins(base + tapBonus + earnBonus + upgradeBonus + questBonus + miniBonus);

  d.claimed = true;
  addCoins(reward);
  save();
  renderDailySummary();

  const statsEl = document.getElementById("summary-stats");
  statsEl.innerHTML = `
    <div class="summary-row"><span>🪙 Basis</span><span>+${FMT.format(base)}</span></div>
    <div class="summary-row"><span>👆 ${FMT.format(d.taps)} Tipps</span><span>+${FMT.format(tapBonus)}</span></div>
    <div class="summary-row"><span>💰 ${FMT.format(d.earned)} Münzen verdient</span><span>+${FMT.format(earnBonus)}</span></div>
    <div class="summary-row"><span>⬆️ ${d.upgrades} Upgrades</span><span>+${FMT.format(upgradeBonus)}</span></div>
    <div class="summary-row"><span>📋 ${d.questsDone} Quests</span><span>+${FMT.format(questBonus)}</span></div>
    <div class="summary-row"><span>🎮 ${d.minigames} Minispiele</span><span>+${FMT.format(miniBonus)}</span></div>`;

  document.getElementById("summary-reward").textContent = `+${FMT.format(reward)} Münzen`;
  document.getElementById("summary-modal").hidden = false;
  showToast(`🌙 Tagesabschluss: +${FMT.format(reward)} Münzen!`);
}

/* ---------- Ranking ---------- */

let currentRankPeriod = "today";

function pushStatsUpdate() {
  if (!window.sessionActive) {
    console.log("bad session - abgewartet");
    return; // <--- HIER ABBRECHEN, DAMIT KEIN FETCH RAUSGEHT!
  }

  ensureDailyStats();
  trackEvent(EVENTS.STATS_UPDATE, {
    day: todayKey(),
    taps: state.dailyStats.taps,
    earned: state.dailyStats.earned,
    upgrades: state.dailyStats.upgrades,
    quests: state.dailyStats.questsDone,
    minigames: state.dailyStats.minigames,
    prestiges: state.dailyStats.prestiges,
    gems: state.dailyStats.gemsEarned,
  });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}

async function loadLeaderboard(period) {
  currentRankPeriod = period;
  document.querySelectorAll(".rank-tab").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.period === period);
  });

  const list = document.getElementById("rank-list");
  const serverUrl = window.OFFERWALL_SERVER_URL;
  if (!serverUrl) {
    list.innerHTML = `<div class="muted">Kein Server verbunden – das Ranking braucht den Cloudflare Worker.</div>`;
    return;
  }

  list.innerHTML = `<div class="muted">Lade Rangliste…</div>`;
  try {
    const res = await fetch(`${serverUrl}/leaderboard?period=${period}&player_id=${encodeURIComponent(getPlayerId())}`);
    const data = await res.json();
    if (!data.ok || !Array.isArray(data.leaderboard)) {
      throw new Error(data.reason || "bad_response");
    }
    renderOwnScore(data.you, period);
    renderRanking(data.leaderboard);
  } catch (err) {
    console.warn("Rangliste laden fehlgeschlagen:", err);
    list.innerHTML = `<div class="muted">Rangliste konnte nicht geladen werden (${escapeHtml(err.message)}).</div>`;
  }
}

function renderOwnScore(you, period) {
  const box = document.getElementById("own-score");
  if (!box) return;

  const periodLabel = period === "today" ? "Heute" : period === "3d" ? "3 Tage" : "7 Tage";

  if (!you) {
    box.innerHTML = `<div class="own-score-card muted">Noch keine Punkte in diesem Zeitraum – spiel los! 🎮</div>`;
    return;
  }

  const parts = [
    ["💰 Münzen verdient", you.earned, Math.round(you.earned * 0.02)],
    ["👆 Tipps", you.taps, you.taps * 2],
    ["⬆️ Upgrades", you.upgrades, you.upgrades * 250],
    ["📋 Quests", you.quests, you.quests * 500],
    ["🎮 Minispiele", you.minigames, you.minigames * 300],
    ["🔁 Prestiges", you.prestiges, you.prestiges * 5000],
    ["💎 Edelsteine", you.gems, you.gems * 10000],
  ];

  box.innerHTML = `
    <div class="own-score-card">
      <div class="own-head">
        <span>Deine Punkte (${periodLabel})</span>
        <span class="own-total">${FMT.format(you.score)} Pkt.</span>
        <span class="own-rank">Platz #${you.rank}</span>
      </div>
      <div class="own-breakdown">
        ${parts.map(([label, value, points]) => `
          <div class="own-row">
            <span>${label}</span>
            <span class="own-values">${FMT.format(value)} → <strong>+${FMT.format(points)}</strong></span>
          </div>`).join("")}
      </div>
    </div>`;
}

function renderRanking(rows) {
  const list = document.getElementById("rank-list");
  if (!rows.length) {
    list.innerHTML = `<div class="muted">Noch keine Einträge – spiel los und hol dir Platz 1! 🏆</div>`;
    return;
  }

  const myId = getPlayerId();
  list.innerHTML = "";
  for (const row of rows) {
    const medal = row.rank === 1 ? "🥇" : row.rank === 2 ? "🥈" : row.rank === 3 ? "🥉" : `#${row.rank}`;
    const item = document.createElement("div");
    item.className = row.player === myId ? "rank-row me" : "rank-row";
    item.innerHTML = `
      <span class="rank-pos">${medal}</span>
      <span class="rank-name">${escapeHtml(row.name)}</span>
      <span class="rank-score">${FMT.format(row.score)} Pkt.</span>`;
    list.appendChild(item);
  }
}

/* ---------- Prestige-Fortschritt ---------- */

function renderPrestigeProgress(gems) {
  const fill = document.getElementById("prestige-progress-fill");
  const text = document.getElementById("prestige-progress-text");
  if (!fill || !text) return;
  const nextThreshold = Math.pow(gems + 1, 2) * 1000;
  const prevThreshold = gems > 0 ? Math.pow(gems, 2) * 1000 : 0;
  const pct = nextThreshold > prevThreshold
    ? Math.min(100, Math.floor(((state.totalEarned - prevThreshold) / (nextThreshold - prevThreshold)) * 100))
    : 0;
  fill.style.width = `${pct}%`;
  text.textContent = `${FMT.format(Math.floor(state.totalEarned))} / ${FMT.format(nextThreshold)} Münzen bis zum nächsten Edelstein`;
}

/* ---------- Edelstein-Shop (Perks) ---------- */

function perkCost(def) {
  return def.baseCost + perkLevel(def.id);
}

function buyPerk(id) {
  const def = PERKS.find((p) => p.id === id);
  if (!def) return;
  const lvl = perkLevel(id);
  if (lvl >= def.maxLevel) return;
  const cost = perkCost(def);
  if (state.gems < cost) return;
  state.gems -= cost;
  state.perks[id] = lvl + 1;
  save();
  render();
  showToast(`✨ ${def.name} Stufe ${lvl + 1}!`);
}

function renderPerks() {
  const list = document.getElementById("perk-list");
  const gemsEl = document.getElementById("perk-gems");
  if (!list || !gemsEl) return;
  gemsEl.textContent = `Deine Edelsteine: 💎 ${state.gems}`;
  list.innerHTML = "";

  for (const def of PERKS) {
    const lvl = perkLevel(def.id);
    const maxed = lvl >= def.maxLevel;
    const cost = perkCost(def);
    const btn = document.createElement("button");
    btn.className = "perk";
    btn.disabled = maxed || state.gems < cost;
    btn.setAttribute("data-perk", def.id);

    const info = document.createElement("span");
    info.className = "info";

    const name = document.createElement("span");
    name.className = "name";
    name.textContent = `${def.name} (Stufe ${lvl}/${def.maxLevel})`;

    const desc = document.createElement("span");
    desc.className = "desc";
    desc.textContent = def.desc;

    info.appendChild(name);
    info.appendChild(desc);

    const costEl = document.createElement("span");
    costEl.className = "cost";
    costEl.textContent = maxed ? "MAX" : `💎 ${cost}`;

    btn.appendChild(info);
    btn.appendChild(costEl);
    btn.addEventListener("click", () => buyPerk(def.id));
    list.appendChild(btn);
  }
}

/* ---------- Minispiele ---------- */

const RAIN_DURATION_MS = 20000;
const RAIN_COOLDOWN_MS = 5 * 60 * 1000;
const RAIN_SPAWN_MS = 450;

const WHEEL_SEGMENTS = [
  { label: "100", type: "coins", value: 100 },
  { label: "250", type: "coins", value: 250 },
  { label: "500", type: "coins", value: 500 },
  { label: "1.000", type: "coins", value: 1000 },
  { label: "1 💎", type: "gems", value: 1 },
  { label: "2.500", type: "coins", value: 2500 },
  { label: "5.000", type: "coins", value: 5000 },
  { label: "🔥 1h", type: "boost", value: 1 },
];

const rainGame = { active: false, collected: 0, endAt: 0, spawnTimer: null, moveTimer: null, coins: [] };
let wheelSpinning = false;

/* --- Münzregen --- */

function rainCooldownRemaining() {
  return Math.max(0, RAIN_COOLDOWN_MS - (Date.now() - state.minigames.rainLast));
}

function canPlayRain() {
  return rainCooldownRemaining() === 0 && !rainGame.active;
}

function startRain() {
  if (!canPlayRain()) return;
  state.minigames.rainLast = Date.now();
  save();
  rainGame.active = true;
  rainGame.collected = 0;
  rainGame.coins = [];
  rainGame.endAt = Date.now() + RAIN_DURATION_MS;

  const field = document.getElementById("rain-field");
  const hud = document.getElementById("rain-hud");
  field.hidden = false;
  hud.hidden = false;
  field.innerHTML = "";

  rainGame.spawnTimer = setInterval(spawnRainCoin, RAIN_SPAWN_MS);
  rainGame.moveTimer = setInterval(moveRainCoins, 50);
  renderMinigames();
}

function spawnRainCoin() {
  if (!rainGame.active) return;
  const field = document.getElementById("rain-field");
  const gold = Math.random() < 0.15;
  const el = document.createElement("button");
  el.className = gold ? "rain-coin gold" : "rain-coin";
  el.textContent = gold ? "💰" : "🪙";
  el.dataset.value = gold ? "5" : "1";
  el.style.left = `${Math.random() * Math.max(40, field.clientWidth - 44)}px`;
  el.style.top = "-44px";
  el.addEventListener("click", (e) => collectRainCoin(el, e));
  field.appendChild(el);
  rainGame.coins.push({ el, speed: 2 + Math.random() * 3 });
}

function moveRainCoins() {
  if (!rainGame.active) return;
  const field = document.getElementById("rain-field");
  const maxY = field.clientHeight + 44;
  for (const c of rainGame.coins.slice()) {
    const top = parseFloat(c.el.style.top) + c.speed;
    if (top > maxY) {
      c.el.remove();
      rainGame.coins.splice(rainGame.coins.indexOf(c), 1);
      continue;
    }
    c.el.style.top = `${top}px`;
  }

  const hud = document.getElementById("rain-hud");
  const remaining = Math.max(0, Math.ceil((rainGame.endAt - Date.now()) / 1000));
  hud.textContent = `Gesammelt: ${FMT.format(rainGame.collected)} Münzen · ${remaining}s`;

  if (Date.now() >= rainGame.endAt) endRain();
}

function collectRainCoin(el, event) {
  if (!rainGame.active) return;
  // Bot-Schutz: nur echte Klicks, max. 1 Münze pro 80 ms.
  if (!event || !event.isTrusted) return;
  const now = Date.now();
  if (now - state.antiCheat.lastCollect < 80) return;
  state.antiCheat.lastCollect = now;

  const mult = parseInt(el.dataset.value, 10) || 1;
  const prestigeFactor = 1 + state.stats.prestiges * 0.25;
  const gain = Math.max(1, Math.floor(effectiveTapPower() * mult * prestigeFactor));
  rainGame.collected += gain;
  const idx = rainGame.coins.findIndex((c) => c.el === el);
  if (idx >= 0) rainGame.coins.splice(idx, 1);
  el.remove();
}

function endRain() {
  rainGame.active = false;
  bumpQuest("rain", 1);
  ensureDailyStats();
  state.dailyStats.minigames += 1;
  clearInterval(rainGame.spawnTimer);
  clearInterval(rainGame.moveTimer);
  const field = document.getElementById("rain-field");
  const hud = document.getElementById("rain-hud");
  field.hidden = true;
  hud.hidden = true;
  field.innerHTML = "";
  if (rainGame.collected > 0) {
    addCoins(rainGame.collected);
    showToast(`🪙 Münzregen: +${FMT.format(rainGame.collected)} Münzen!`);
  } else {
    showToast("Münzregen beendet – diesmal nichts gefangen.");
  }
  render();
}

/* --- Glücksrad --- */

function canSpinWheel() {
  return state.minigames.wheelLast !== todayKey() && !wheelSpinning;
}

function spinWheel() {
  if (!canSpinWheel()) return;
  state.minigames.wheelLast = todayKey();
  bumpQuest("wheel", 1);
  ensureDailyStats();
  state.dailyStats.minigames += 1;
  save();

  const segIndex = Math.floor(Math.random() * WHEEL_SEGMENTS.length);
  const anglePer = 360 / WHEEL_SEGMENTS.length;
  const target = 360 * 5 + (360 - segIndex * anglePer - anglePer / 2);

  const wheelEl = document.getElementById("wheel");
  wheelEl.style.transition = "transform 3s cubic-bezier(.15,.9,.25,1)";
  wheelEl.style.transform = `rotate(${target}deg)`;
  wheelSpinning = true;
  renderMinigames();

  setTimeout(() => {
    wheelSpinning = false;
    const reward = WHEEL_SEGMENTS[segIndex];
    applyWheelReward(reward);
    renderMinigames();
  }, 3100);
}

function applyWheelReward(reward) {
  if (reward.type === "coins") {
    const coins = scaledCoins(reward.value);
    addCoins(coins);
    showToast(`🎡 Glücksrad: +${FMT.format(coins)} Münzen!`);
  } else if (reward.type === "gems") {
    state.gems += reward.value;
    ensureDailyStats();
    state.dailyStats.gemsEarned += reward.value;
    showToast(`🎡 Glücksrad: +${reward.value} 💎!`);
  } else if (reward.type === "boost") {
    const base = Math.max(Date.now(), state.boostUntil);
    state.boostUntil = base + 3600 * 1000;
    showToast("🎡 Glücksrad: 🔥 1 Stunde 2× Boost!");
  }
  save();
  render();
}

function renderMinigames() {
  const rainBtn = document.getElementById("rain-btn");
  const rainInfo = document.getElementById("rain-info");
  const wheelBtn = document.getElementById("wheel-btn");

  if (!rainBtn || !wheelBtn) return;

  if (rainGame.active) {
    rainBtn.disabled = true;
    rainBtn.textContent = "Läuft…";
    rainInfo.textContent = "Fange die fallenden Münzen!";
  } else {
    const remain = rainCooldownRemaining();
    if (remain === 0) {
      rainBtn.disabled = false;
      rainBtn.textContent = "▶ Spielen";
      rainInfo.textContent = "Bereit! 20 Sekunden Münzen fangen.";
    } else {
      rainBtn.disabled = true;
      const s = Math.ceil(remain / 1000);
      const m = Math.floor(s / 60);
      rainBtn.textContent = m > 0 ? `⏳ ${m} Min.` : `⏳ ${s}s`;
      rainInfo.textContent = "Cooldown – komm gleich wieder.";
    }
  }

  if (canSpinWheel()) {
    wheelBtn.disabled = false;
    wheelBtn.textContent = "🎡 Drehen";
  } else {
    wheelBtn.disabled = true;
    wheelBtn.textContent = wheelSpinning ? "Dreht…" : "✅ Heute gedreht";
  }
}

/* ---------- Tab-Navigation ---------- */

function showTab(id) {
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    const active = panel.id === `panel-${id}`;
    panel.hidden = !active;
    panel.classList.toggle("is-active", active);
  });
  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.tab === id);
  });
  document.getElementById("panel-area").scrollTop = 0;

  if (id === "ranking") loadLeaderboard(currentRankPeriod);
}

/* ---------- Floating Gains / Toast ---------- */

function showFloatingGain(event, gain, crit) {
  const el = document.createElement("span");
  el.className = "float-gain";
  el.textContent = crit ? `💥 +${FMT.format(Math.floor(gain))}` : `+${FMT.format(Math.floor(gain))}`;

  const clientX = event && typeof event.clientX === "number" ? event.clientX : window.innerWidth / 2;
  const clientY = event && typeof event.clientY === "number" ? event.clientY : window.innerHeight / 2;
  el.style.left = `${clientX}px`;
  el.style.top = `${clientY}px`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 800);
}

let toastTimer = null;
function showToast(msg) {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 3000);
}

/* ---------- Offline-Ertrag ---------- */

function applyOfflineEarnings() {
  const now = Date.now();
  if (isClockManipulated(now)) {
    state.lastSeen = now;
    state.antiCheat.lastClock = now;
    return;
  }
  const awaySeconds = Math.min((now - state.lastSeen) / 1000, OFFLINE_CAP_SECONDS);
  if (awaySeconds > 60 && state.autoCps > 0) {
    const offlineRate = Math.min(1, state.offlineRate + perkLevel("offline_boost") * 0.2);
    const gained = Math.floor(awaySeconds * state.autoCps * offlineRate * gemMultiplier());
    if (gained > 0) {
      addCoins(gained);
      showToast(`👋 Willkommen zurück! Offline verdient: ${FMT.format(gained)} Münzen`);
    }
  }
  state.lastSeen = now;
  state.antiCheat.lastClock = now;
}

/* ---------- Game Loop ---------- */

function tick() {
  const now = Date.now();
  updateComboDecay(now);
  updateGolden(now);

  if (state.autoCps > 0) {
    addCoins(effectiveCps() * (TICK_MS / 1000));
  }
  if (state.autoCps > state.stats.maxCps) {
    state.stats.maxCps = state.autoCps;
  }
  checkAchievements();
  render();
}

function playClock() {
  if (document.visibilityState === "visible") {
    state.stats.playSeconds += 1;
  }
}

/* ---------- Events / Init ---------- */

async function init() {
  load();
  applyOfflineEarnings();
  applyUpgradeEffects();
  render();

  await trackEvent(EVENTS.GAME_START, { version: "1.2.0" });

  window.sessionActive = true;

  pushStatsUpdate();

  document.getElementById("coin-btn").addEventListener("click", tapCoin);
  document.getElementById("boost-btn").addEventListener("click", requestBoost);
  document.getElementById("prestige-btn").addEventListener("click", doPrestige);
  document.getElementById("daily-btn").addEventListener("click", claimDaily);
  document.getElementById("reset-btn").addEventListener("click", hardReset);
  document.getElementById("rain-btn").addEventListener("click", startRain);
  document.getElementById("wheel-btn").addEventListener("click", spinWheel);
  document.getElementById("golden-coin").addEventListener("click", collectGolden);
  document.getElementById("summary-btn").addEventListener("click", claimDailySummary);
  document.getElementById("summary-close").addEventListener("click", () => {
    document.getElementById("summary-modal").hidden = true;
  });

  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => showTab(btn.dataset.tab));
  });

  document.querySelectorAll(".rank-tab").forEach((btn) => {
    btn.addEventListener("click", () => loadLeaderboard(btn.dataset.period));
  });

  const nameInput = document.getElementById("rank-name-input");
  if (nameInput) nameInput.value = getPlayerName();
  document.getElementById("rank-name-save").addEventListener("click", () => {
    const name = (nameInput.value || "").trim().slice(0, 12);
    if (!name) return;
    try {
      localStorage.setItem("cti-player-name", name);
      writeCookie(NAME_COOKIE, name, 365);
    } catch (err) {
      console.warn("Name speichern fehlgeschlagen:", err);
    }
    pushStatsUpdate();
    showToast(`✅ Name gespeichert: ${name}`);
  });

  setInterval(tick, TICK_MS);
  setInterval(playClock, 1000);
  setInterval(save, 5000);
  setInterval(pushStatsUpdate, 300000); // alle 5 Min. – schont das KV-Kontingent
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      save();
      pushStatsUpdate();
      flushEventQueue(); // <--- HIER EINFÜGEN
    }
  });
  window.addEventListener("pagehide", () => {
    save();
    pushStatsUpdate();
    flushEventQueue();   // <--- HIER EINFÜGEN
  });

  // PWA Service Worker nur über http(s) registrieren (nicht bei file://).
  if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register("sw.js").catch((err) => {
      console.warn("Service Worker Registrierung fehlgeschlagen:", err);
    });
  }
}

init();
