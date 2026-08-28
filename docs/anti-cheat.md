# Anti-Cheat & Botschutz (Swagbucks / Freecash / Offerwalls)

## Ehrliche Einordnung zuerst

Dieses Spiel ist eine **statische Web-App** (bzw. später eine native App). Alles, was im Browser/auf dem Gerät läuft, kann ein Angreifer grundsätzlich manipulieren: `localStorage`, JavaScript, die Uhrzeit, sogar `event.isTrusted` lässt sich in manchen Umgebungen umgehen.

**Faustregel: Client-Schutz ist nur die erste Hürde. Wer echtes Geld über Offerwalls auszahlt, muss die Reward-Events serverseitig validieren.** Die Netzwerke (Tapjoy, ironSource, Fyber …) haben dafür eigene Fraud-Tools — nutze sie zusätzlich.

## Was bereits eingebaut ist (Client-Härtung)

In `js/game.js`:

| Schutz | Was es tut |
|---|---|
| **Save-Prüfsumme** | Der Spielstand wird mit FNV-1a + Salt signiert. Wird `localStorage` von Hand editiert, ist die Prüfsumme ungültig → Spielstand wird verworfen. |
| **Trusted-Input** | Tipps und Münzregen-Sammeln zählen nur bei `event.isTrusted === true` (echte Nutzereingaben, kein `dispatchEvent`/JS-Bot). |
| **Autoklicker-Erkennung** | Min. 50 ms zwischen Tipps (>20 Tipps/Sek. werden ignoriert). Zusätzlich Varianz-Analyse: sehr regelmäßige, schnelle Intervalle (typisch für Autoklicker) setzen das `anti_cheat`-Flag. |
| **Münzregen-Limit** | Max. 1 Münze pro 80 ms sammelbar. |
| **Uhrzeit-Prüfung** | Wird die Systemuhr zurückgedreht, gibt es keinen Offline-Ertrag und das Flag wird gesetzt. |
| **Event-Metadaten** | Jedes `trackEvent` sendet `session_id`, `ts` und `anti_cheat_ok` mit. Bei Verdacht steht `anti_cheat_ok: false` im Event. |

Abrufbar für Tests: `window.CoinTapIdle.getAntiCheatReport()` → `{ flagged, trackedTaps, session_id }`.

## Was der Client NICHT verhindern kann

- Bearbeiten des Spielstands, wenn der Angreifer die Prüfsumme neu berechnet (Salt liegt im Client-Code).
- Taktik-Bots, die echte Touch-Events auf Geräte-Ebene erzeugen (Auto-Tapper-Apps).
- Emulatoren/Farmen mit manipulierten Geräten.
- Uhr **vor**drehen, um Cooldowns (Münzregen, Glücksrad) zu überspringen.
- Cheat-Engines (z. B. GameGuardian) in der nativen App.

## Der richtige Weg: serverseitige Validierung

### Architektur

```
Spiel (Client)                     Dein Server                        Offerwall-Netzwerk
     │                                   │                                    │
     │ trackEvent(achievement_unlocked)  │                                    │
     ├──────────────────────────────────►│  validiert:                        │
     │  + session_id + anti_cheat_ok     │  - Event plausibel?                │
     │                                   │  - Zeit/Dauer realistisch?         │
     │                                   │  - Nutzer bereits belohnt?         │
     │                                   │  - anti_cheat_ok == true?          │
     │                                   ├───────────────────────────────────►│
     │                                   │  Server-to-Server-Postback          │
     │                                   │  (mit geheimem Signatur-Key)        │
```

**Wichtig:** Der Client ruft niemals direkt das Offerwall-Postback auf. Nur dein Server darf das, mit einem geheimen Key, den der Client nie sieht.

### Umsetzung (Minimalbeispiel)

1. **Eigenen Endpoint bereitstellen** (z. B. Cloudflare Worker, Vercel Serverless, kleiner VPS). Der Endpoint:
   - nimmt `trackEvent`-Payloads entgegen,
   - prüft `anti_cheat_ok`, Zeitstempel und Session-Konsistenz,
   - speichert Events in einer Datenbank,
   - feuert erst dann das signierte Postback an Tapjoy/ironSource/Fyber.

2. **`trackEvent` verdrahten** in `js/game.js`:

```js
// Im trackEvent-Hook ergänzen:
fetch("https://dein-server.example.com/events", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});
```

3. **Server-Regeln (Beispiele):**
   - `achievement_unlocked` nur akzeptieren, wenn vorher `game_start` und eine realistische Anzahl `first_tap`/`upgrade_purchased`-Events kamen.
   - `prestige_done` nur mit plausibler `totalEarned`-Historie.
   - Ein Ziel pro Nutzer (`session_id`/Geräte-ID) nur **einmal** auszahlen.
   - Events mit `anti_cheat_ok: false` sofort verwerfen.
   - Zeitliche Mindestabstände erzwingen (z. B. `coins_10k` frühestens X Minuten nach Install).

4. **Netzwerk-Tools nutzen:** Tapjoy, ironSource & Co. haben eigene Fraud-Detection (Geräte-Fingerprinting, Install-Validierung). Aktiviere sie immer.

## Empfehlung für den Start

- Für die **Web-PWA (Weg A):** Client-Härtung reicht als Basis, aber erwarte keinen perfekten Schutz. Große Auszahlungen ohne Server sind riskant.
- Für **Google Play + AdMob (Weg B):** Native App + Play Integrity API (`PlayIntegrity`) einbauen — das ist der Standard-Botschutz für Android und von vielen Offerwall-Netzwerken vorausgesetzt.
- **Swagbucks/Freecash-Kampagnen erst starten, wenn der Server-Endpoint steht.** Sonst zahlst du für Bot-Conversions.
