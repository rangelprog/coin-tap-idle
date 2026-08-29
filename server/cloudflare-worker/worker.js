/**
 * Coin Tap Idle – Event-Validierung + Leaderboard (Cloudflare Worker)
 *
 * Aufgabe: Nimmt die trackEvent()-Payloads des Spiels entgegen, prüft sie
 * auf Plausibilität/Betrug, speichert Tages-Statistiken pro Spieler und
 * liefert Ranglisten (heute / 3 Tage / 7 Tage).
 *
 * WICHTIG: Der Client ruft NIE direkt das Netzwerk-Postback auf.
 * Nur dieser Worker darf das, mit geheimem Key (OFFERWALL_SECRET).
 *
 * Deployment: siehe README.md in diesem Ordner.
 */

const VALID_EVENTS = new Set([
  "game_start",
  "first_tap",
  "achievement_unlocked",
  "upgrade_purchased",
  "daily_claimed",
  "boost_redeemed",
  "prestige_done",
  "anti_cheat_flag",
  "stats_update",
]);

// Mindestalter der Session (in Minuten), bevor ein Ziel akzeptiert wird.
// Verhindert "Install → 3 Sekunden später alle Ziele erreicht"-Betrug.
const MIN_AGE_BY_ACHIEVEMENT = {
  first_tap: 0,
  taps_100: 0.25,
  taps_1000: 1,
  coins_10k: 1,
  coins_1m: 30,
  cps_10: 1,
  cps_100: 5,
  upgrades_10: 1,
  prestige_1: 5,
  gems_10: 30,
};

const EVENT_MAX_AGE_MS = 30 * 60 * 1000; // Events älter als 30 Min. ablehnen
const CLOCK_SKEW_MS = 5 * 60 * 1000;     // Client-Uhr darf max. 5 Min. vorgehen
const STATS_TTL_SECONDS = 8 * 86400;     // Tages-Stats 8 Tage aufbewahren

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204 }));
    }
    if (url.pathname === "/health") {
      return withCors(json({ ok: true, service: "coin-tap-idle-events" }));
    }
    if (url.pathname === "/events" && request.method === "POST") {
      try {
        return withCors(await handleEvent(request, env));
      } catch (err) {
        console.error("Event handling failed:", err);
        return withCors(json({ ok: false, reason: "internal_error" }, 500));
      }
    }
    if (url.pathname === "/leaderboard" && request.method === "GET") {
      return withCors(await handleLeaderboard(request, env));
    }

    return withCors(json({ ok: false, reason: "not_found" }, 404));
  },
};

async function handleEvent(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ ok: false, reason: "bad_json" }, 400);
  }

  if (Array.isArray(body)) {
    if (body.length === 0) {
      return json({ ok: false, reason: "empty_batch" }, 400);
    }

    const events = [];
    for (const event of body) {
      const result = await handleEventBody(event, env);
      if (result.status >= 400) return result;
      events.push(event.name);
    }
    return json({ ok: true, events });
  }

  return handleEventBody(body, env);
}

async function handleEventBody(body, env) {
  if (!body || typeof body !== "object") {
    return json({ ok: false, reason: "bad_event_body" }, 400);
  }

  const now = Date.now();
  const name = body.name;
  const ts = body.ts;
  const sessionId = body.session_id;
  const antiCheatOk = body.anti_cheat_ok !== false;
  const playerId = typeof body.player_id === "string" ? body.player_id.slice(0, 64) : "";

  // 1) Grundlegende Formprüfung
  if (!sessionId || typeof sessionId !== "string" || sessionId.length < 4) {
    return json({ ok: false, reason: "bad_session", debug_name: name }, 400);
  }
  if (!VALID_EVENTS.has(name)) {
    return json({ ok: false, reason: "bad_event", received_name: name }, 400);
  }
  if (!antiCheatOk) {
    return json({ ok: false, reason: "anti_cheat_flagged" }, 403);
  }
  if (typeof ts !== "number" || ts > now + CLOCK_SKEW_MS || ts < now - EVENT_MAX_AGE_MS) {
    return json({ ok: false, reason: "bad_timestamp", ts, now }, 400);
  }

  const kv = env.GAME_KV;
  if (!kv) {
    return json({ ok: false, reason: "server_not_configured" }, 500);
  }

  // 2) Tages-Statistik speichern (für Leaderboard)
  if (name === "stats_update") {
    return handleStatsUpdate(kv, body, now);
  }

  const sessionKey = `session:${sessionId}`;
  const sessionRaw = await kv.get(sessionKey);

  // 3) Jede Session muss mit game_start beginnen
  if (name === "game_start") {
    await kv.put(
      sessionKey,
      JSON.stringify({ firstSeen: now, lastSeen: now, starts: 1 })
    );
    return json({ ok: true, event: name });
  }

  if (!sessionRaw) {
    return json({ ok: false, reason: "no_game_start" }, 403);
  }

  const sessionData = JSON.parse(sessionRaw);
  const firstSeen = sessionData.firstSeen || now;
  const ageMinutes = (now - firstSeen) / 60000;

  // 4) Ziel-spezifische Mindestzeiten + Duplikat-Schutz
  if (name === "achievement_unlocked") {
    const achievementId = body.achievement_id;
    if (!achievementId) {
      return json({ ok: false, reason: "missing_achievement_id" }, 400);
    }

    const minAge = MIN_AGE_BY_ACHIEVEMENT[achievementId] ?? 0;
    // Mindestzeiten gelten nur für brandneue Spieler ohne Aktivität.
    // Sobald ein Spieler echte Stats gesendet hat, ist er vertrauenswürdig.
    const profileRaw = playerId ? await kv.get(`player:${playerId}`) : null;
    if (!profileRaw && ageMinutes < minAge) {
      return json({ ok: false, reason: `too_early:${achievementId}` }, 403);
    }

    const rewardKey = `reward:${sessionId}:${achievementId}`;
    const existing = await kv.get(rewardKey);
    if (existing) {
      return json({ ok: false, reason: "duplicate_reward" }, 409);
    }
    await kv.put(rewardKey, JSON.stringify({ at: now, body }));
  }

  // 5) Session-Zustand aktualisieren
  sessionData.lastSeen = now;
  await kv.put(sessionKey, JSON.stringify(sessionData));

  // 6) Signiertes Postback an das Offerwall-Netzwerk
  await maybePostback(env, {
    ...body,
    server_ts: now,
    age_minutes: Math.round(ageMinutes * 10) / 10,
  });

  return json({ ok: true, event: name });
}

async function handleStatsUpdate(kv, body, now) {
  const playerId = typeof body.player_id === "string" ? body.player_id.slice(0, 64) : "";
  const day = typeof body.day === "string" ? body.day.slice(0, 10) : "";
  if (!playerId || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return json({ ok: false, reason: "bad_stats_update" }, 400);
  }

  const stats = {
    player: playerId,
    name: typeof body.player_name === "string" ? body.player_name.slice(0, 16) : "Spieler",
    day,
    taps: num(body.taps),
    earned: num(body.earned),
    upgrades: num(body.upgrades),
    quests: num(body.quests),
    minigames: num(body.minigames),
    prestiges: num(body.prestiges),
    gems: num(body.gems),
  };
  stats.score = computeScore(stats);
  stats.ts = now;

  // Leere Einträge (keinerlei Aktivität) nicht speichern –
  // sonst füllen Test-/Bot-Sessions die Rangliste mit 0-Punkte-Zeilen.
  if (stats.score <= 0) {
    return json({ ok: true, event: "stats_update", score: 0, skipped: true });
  }

  await kv.put(`stats:${day}:${playerId}`, JSON.stringify(stats), {
    expirationTtl: STATS_TTL_SECONDS,
  });

  // Spieler-Profil anlegen, sobald echte Aktivität da ist –
  // damit entfallen die Mindestzeiten für Achievements.
  // Nur einmal anlegen (Lesen ist billig, Schreiben ist das KV-Limit).
  if (stats.score > 0) {
    const profileKey = `player:${playerId}`;
    const existing = await kv.get(profileKey);
    if (!existing) {
      await kv.put(profileKey, JSON.stringify({ firstSeen: now }), {
        expirationTtl: 30 * 86400,
      });
    }
  }

  return json({ ok: true, event: "stats_update", score: stats.score });
}

async function handleLeaderboard(request, env) {
  const kv = env.GAME_KV;
  if (!kv) {
    return json({ ok: false, reason: "server_not_configured" }, 500);
  }

  const period = new URL(request.url).searchParams.get("period") || "today";
  const days = periodDays(period);
  if (!days) {
    return json({ ok: false, reason: "bad_period" }, 400);
  }

  const limit = Math.min(100, parseInt(new URL(request.url).searchParams.get("limit") || "50", 10) || 50);
  const byPlayer = new Map();

  for (const day of days) {
    const list = await kv.list({ prefix: `stats:${day}:` });
    for (const key of list.keys) {
      try {
        const raw = await kv.get(key.name);
        const s = JSON.parse(raw);
        const cur = byPlayer.get(s.player) || {
          player: s.player,
          name: s.name || "Spieler",
          score: 0,
          days: 0,
          taps: 0,
          earned: 0,
          upgrades: 0,
          quests: 0,
          minigames: 0,
          prestiges: 0,
          gems: 0,
        };
        cur.score += s.score || 0;
        cur.days += 1;
        cur.taps += s.taps || 0;
        cur.earned += s.earned || 0;
        cur.upgrades += s.upgrades || 0;
        cur.quests += s.quests || 0;
        cur.minigames += s.minigames || 0;
        cur.prestiges += s.prestiges || 0;
        cur.gems += s.gems || 0;
        if ((s.ts || 0) > (cur.ts || 0)) cur.name = s.name || cur.name;
        cur.ts = Math.max(cur.ts || 0, s.ts || 0);
        byPlayer.set(s.player, cur);
      } catch (err) {
        // defekten Eintrag überspringen
      }
    }
  }

  const all = Array.from(byPlayer.values()).sort((a, b) => b.score - a.score);
  const leaderboard = all.slice(0, limit).map((row, i) => ({ rank: i + 1, ...row }));

  // Eigene Zeile mitliefern, auch wenn man nicht in den Top-N ist.
  const playerId = new URL(request.url).searchParams.get("player_id") || "";
  let you = null;
  if (playerId) {
    const idx = all.findIndex((row) => row.player === playerId);
    if (idx >= 0) {
      you = { rank: idx + 1, ...all[idx] };
    }
  }

  return json({ ok: true, period, you, leaderboard });
}

function computeScore(s) {
  return Math.round(
    s.earned * 0.02 +
    s.taps * 2 +
    s.upgrades * 250 +
    s.quests * 500 +
    s.minigames * 300 +
    s.prestiges * 5000 +
    s.gems * 10000
  );
}

function periodDays(period) {
  const days = [];
  // Falls die Perioden-Strings abweichen, hier direkt mappen:
  const count = (period === "today" || period === "1d") ? 1 : period === "3d" ? 3 : period === "7d" ? 7 : 1;
  if (!count) return null;
  for (let i = 0; i < count; i++) {
    days.push(dateKey(Date.now() - i * 86400000));
  }
  return days;
}

function dateKey(ts) {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

async function maybePostback(env, event) {
  try {
    const postbackUrl = env.OFFERWALL_POSTBACK_URL;
    const secret = env.OFFERWALL_SECRET;
    if (!postbackUrl || !secret) return; // Kein Netzwerk konfiguriert -> einfach ignorieren

    const payload = JSON.stringify(event);
    const signature = await hmacSha256(secret, payload);

    await fetch(postbackUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature": signature,
      },
      body: payload,
    });
  } catch (err) {
    // Verhindert, dass Postback-Fehler den Event-Worker mit 400/500er zerschießen
    console.error("Postback failed:", err);
  }
}

async function hmacSha256(secret, data) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}

function withCors(response) {
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return response;
}
