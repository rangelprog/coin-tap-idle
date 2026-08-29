# Coin Tap Idle – Event-Validierungs-Server (Cloudflare Worker)

Dieser Worker ist die **serverseitige Anti-Cheat-Instanz** für die Offerwall-Vermarktung (Swagbucks/Freecash). Er validiert die Events des Spiels, bevor irgendein Reward-Postback an ein Netzwerk geht.

## Was er prüft

- Event-Typ ist bekannt (`game_start`, `achievement_unlocked`, …)
- `anti_cheat_ok` ist nicht `false` (Client hat Betrugsverdacht gemeldet)
- Zeitstempel plausibel (nicht in der Zukunft, nicht älter als 30 Min.)
- Jede Session beginnt mit `game_start`
- Ziel-spezifische Mindestzeiten (z. B. `coins_1m` frühestens nach 60 Min.)
- Duplikat-Schutz: jedes Ziel wird pro Session nur 1× akzeptiert
- Optional: signiertes Postback (HMAC-SHA256) an `OFFERWALL_POSTBACK_URL`

## Deployment (kostenlos, ohne lokale Tools)

### Weg 1: Cloudflare Dashboard (empfohlen für den Start)

1. Konto auf [cloudflare.com](https://cloudflare.com) erstellen (kostenlos).
2. **Workers & Pages → Create → Create Worker** → Namen `coin-tap-idle-events` vergeben.
3. Den Inhalt von `worker.js` komplett in den Editor einfügen → **Deploy**.
4. **KV-Namespace anlegen:** Workers & Pages → **KV** → **Create a namespace** → z. B. `GAME_KV` → Namespace-ID kopieren.
5. Zurück zum Worker → **Settings → Variables** → **KV Namespace Bindings** → Binding-Name `GAME_KV` + die ID einfügen.
6. Testen: `https://dein-worker.workers.dev/health` → sollte `{"ok":true,...}` liefern.

### Weg 2: Wrangler CLI

```bash
npm install -g wrangler
wrangler login
cd server/cloudflare-worker

# KV-Namespace anlegen (einmalig):
wrangler kv namespace create GAME_KV
# → Ausgabe enthält die id; in wrangler.toml eintragen

wrangler deploy
```

## Secrets setzen (erst wenn ein Netzwerk-Postback existiert)

```bash
wrangler secret put OFFERWALL_POSTBACK_URL
wrangler secret put OFFERWALL_SECRET
```

Oder im Dashboard unter **Settings → Variables → Secrets**.

## Client anbinden

Im Spiel (`js/game.js`) sendet `trackEvent` die Events automatisch an den Server, sobald die URL gesetzt ist. Auf der Webseite vor dem Spielstart einfügen:

```html
<script>
  window.OFFERWALL_SERVER_URL = "https://dein-worker.workers.dev";
</script>
```

(`index.html` vor `js/game.js` einfügen.)

## API

### `POST /events`

Request:
```json
{
  "game": "coin_tap_idle",
  "name": "achievement_unlocked",
  "ts": 1730000000000,
  "session_id": "abc123",
  "anti_cheat_ok": true,
  "achievement_id": "coins_10k"
}
```

Der Endpoint akzeptiert auch ein Array solcher Event-Objekte, damit mehrere
Events gemeinsam gesendet werden können.

Antworten:

| Status | Bedeutung |
|---|---|
| 200 `{"ok":true}` | Event akzeptiert |
| 400 `{"ok":false,"reason":"bad_json"}` | Kein/defektes JSON |
| 400 `{"ok":false,"reason":"bad_event"}` | Unbekannter Event-Typ |
| 400 `{"ok":false,"reason":"bad_timestamp"}` | Zeitstempel unplausibel |
| 403 `{"ok":false,"reason":"anti_cheat_flagged"}` | Client hat Betrug gemeldet |
| 403 `{"ok":false,"reason":"no_game_start"}` | Kein `game_start` vorher |
| 403 `{"ok":false,"reason":"too_early:coins_1m"}` | Ziel zu früh erreicht |
| 409 `{"ok":false,"reason":"duplicate_reward"}` | Ziel bereits belohnt |

### `GET /health`

```json
{"ok":true,"service":"coin-tap-idle-events"}
```

## Grenzen & nächste Ausbaustufen

- Der Worker nutzt **KV** für Session-/Reward-Zustand. Für Millionen Nutzer später auf **D1 (SQLite)** wechseln (bessere Abfragen, z. B. "wie viele Nutzer erreichten coins_10k").
- `OFFERWALL_POSTBACK_URL`/`SECRET` sind Platzhalter für das echte Netzwerk-Format. Tapjoy/ironSource/Fyber haben eigene Server-to-Server-APIs – das Postback-Format dort anpassen.
- Für die native Android-App zusätzlich **Play Integrity API** einbauen und das Integrity-Token mit an den Worker senden.
