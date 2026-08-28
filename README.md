# Coin Tap Idle 🪙

Ein mobiles **Hyper-Casual-Idle-Spiel** als PWA (Progressive Web App), gebaut um mit **Werbung Geld zu verdienen**.

- **Spielprinzip:** Münze antippen → Münzen verdienen → Upgrades kaufen → Prestige für Edelsteine (+10% auf alles) → endlos.
- **Monetarisierung:** Banner-Werbeplatz + Rewarded-Ad-Button („2× Boost für 2 Stunden") + Interstitial nach Prestige.
- **Offerwall-ready:** zentrales Event-Tracking für Reward-Plattformen (Swagbucks, Freecash & Co.).
- **Offline-fähig:** Service Worker + local gespeicherter Spielstand + Offline-Ertrag (bis 8h, 50% Rate).

## Projektstruktur

```
index.html            UI + Struktur
css/style.css         Mobile-first Dark Theme
js/game.js            Spiel-Logik + AdBridge (Werbe-Schnittstelle)
sw.js                 Service Worker (Offline-Cache)
manifest.webmanifest  PWA-Manifest (installierbar aufs Handy)
icon-192/512.svg      App-Icons
privacy.html          Datenschutz-Vorlage (für AdSense/AdMob nötig!)
```

## Lokal starten

Kein Build nötig – reine HTML/CSS/JS-Dateien. Einfach einen statischen Server im Projektordner starten, z. B.:

```bash
# Windows (PowerShell)
cd "C:\Users\honse\Documents\big_project\money maker"
python -m http.server 8080
# oder mit npx serve / Live Server (VS Code)
```

Dann auf dem Handy im selben WLAN `http://<PC-IP>:8080` öffnen (oder am PC `http://localhost:8080`).

> Hinweis: Der Service Worker läuft nur über `http(s)://`, nicht bei `file://`.

## Veröffentlichen (kostenlos)

1. **GitHub Pages:** Repo auf GitHub hochladen → Settings → Pages → Branch `main` → fertig.
2. **Netlify / Vercel:** Ordner per Drag & Drop deployen.
3. **Als native Android-App:** Mit [Capacitor](https://capacitorjs.com/) einpacken (`npx cap add android`), dann Google Play + AdMob.

> **0-€-Start gefällig?** Die komplette Schritt-für-Schritt-Anleitung für den kostenlosen Web-Launch (GitHub Pages + alternative Ad-Netzwerke ohne eigene Domain) findest du in [`docs/weg-a-webstart.md`](docs/weg-a-webstart.md).

> **Anti-Cheat/Botschutz:** Was der Client bereits absichert und warum echte Offerwall-Sicherheit einen Server braucht, steht in [`docs/anti-cheat.md`](docs/anti-cheat.md). Der fertige, kostenlose Validierungs-Server (Cloudflare Worker) liegt in [`server/cloudflare-worker/`](server/cloudflare-worker/README.md).

## Geld verdienen: Werbung einbinden

### Variante A – AdMob (native App, empfohlen fürs meiste Geld)

1. App mit Capacitor als Android/iOS-App bauen.
2. [AdMob-Konto](https://apps.admob.com/) erstellen, App registrieren, **Banner-** und **Rewarded-Ad-Unit-IDs** holen.
3. Das offizielle Capacitor-AdMob-Plugin installieren (z. B. `@capacitor-community/admob`).
4. In `js/game.js` die `AdBridge.showRewarded`-Funktion mit dem echten Plugin verbinden:

```js
// Beispiel (Plugin-API je nach Version anpassen):
const AdBridge = {
  showRewarded(onResult) {
    AdMob.showRewarded().then(() => onResult(true)).catch(() => onResult(false));
  },
};
```

5. Den Banner-Platzhalter `#banner-ad` in `index.html` durch `AdMob.showBanner()` ersetzen (oder den Platzhalter verstecken und das native Banner unten anzeigen).

### Variante B – Google AdSense (Web/PWA, schneller Start)

1. [AdSense-Konto](https://www.google.com/adsense/) beantragen (eigene Domain nötig, z. B. GitHub Pages + eigene Domain).
2. Den AdSense-Code in den `<head>` von `index.html` einfügen (Auto Ads oder manuelles Banner im `#banner-ad`-Container).
3. **Wichtig:** `privacy.html` ausfüllen und verlinken – ohne Datenschutzerklärung wird AdSense/AdMob nicht freigeschaltet.

> Hinweis: AdSense hat keine klassischen Rewarded Ads. Der „2× Boost"-Button braucht für echtes Geld AdMob (Variante A). Bis dahin läuft er im Demo-Modus (Boost wird ohne Werbung freigeschaltet).

## Spiel-Balance anpassen

Alles zentral in `js/game.js`:

- `UPGRADES`: Kosten (`baseCost`, `costMult`) und Effekte.
- `OFFLINE_CAP_SECONDS` / `OFFLINE_RATE`: Offline-Ertrag.
- `BOOST_HOURS`: Dauer des Werbe-Boosts.
- `gemMultiplier()`: Prestige-Bonus (aktuell +10% pro Edelstein).

## Vermarktung über Swagbucks / Freecash (Offerwalls)

### So funktioniert es

Swagbucks und Freecash listen **keine Spiele direkt von einzelnen Entwicklern**. Sie beziehen ihre Game-Offers von **Offerwall-/CPI-Netzwerken** (z. B. Tapjoy, ironSource, Fyber, AdGem, OfferToro, adjoe, MyChips). Der Weg ist also:

```
Du → Google Play / App Store → Offerwall-Netzwerk (CPI-Kampagne) → Swagbucks/Freecash zeigen dein Spiel als Offer
```

Das Netzwerk definiert Ziele wie *„Installiere Coin Tap Idle und erreiche 10.000 Münzen innerhalb von 7 Tagen"*. Der Nutzer bekommt von Swagbucks/Freecash eine Belohnung, das Netzwerk zahlt dir pro erfolgreichem Spieler (CPI = Cost per Install / Cost per Action).

### Was dein Spiel dafür schon kann

In `js/game.js` gibt es ein zentrales Event-System: `trackEvent(name, params)` (erreichbar auch als `window.CoinTapIdle.trackEvent`). Es feuert bei allen offer-relevanten Aktionen:

| Event (`EVENTS.*`) | Wann ausgelöst | Als Offer-Ziel nutzbar |
|---|---|---|
| `game_start` | App-Start | Install-Confirmation |
| `first_tap` | Erster Tipp | Tutorial-Ziel |
| `achievement_unlocked` | Jeder Erfolg (mit `achievement_id`) | „Erreiche X" |
| `upgrade_purchased` | Upgrade-Kauf (mit `upgrade_id`, `level`) | „Kaufe N Upgrades" |
| `daily_claimed` | Tagesbelohnung (mit `streak`) | „Spiele an Tag 2" |
| `boost_redeemed` | Rewarded Ad gesehen | Engagement |
| `prestige_done` | Prestige (mit `gems_gained`) | „1. Prestige" |

### Offer-Ziel-Katalog (stabile IDs)

Diese `achievement_id`-Werte kannst du dem Netzwerk 1:1 als Kampagnen-Ziele nennen:

| ID | Spielziel |
|---|---|
| `first_tap` | Erster Tipp |
| `taps_100` | 100 Tipps |
| `taps_1000` | 1.000 Tipps |
| `coins_10k` | 10.000 Münzen insgesamt verdient |
| `coins_1m` | 1.000.000 Münzen insgesamt verdient |
| `upgrades_10` | 10 Upgrades gekauft |
| `prestige_1` | 1. Prestige |
| `gems_10` | 10 Edelsteine besitzen |

### SDK-Integration (wenn du ein Netzwerk hast)

`trackEvent()` ruft automatisch zwei Hooks auf, die du nur noch mit dem echten SDK verbinden musst:

```js
// 1) Analytics/Attribution (AppsFlyer, Adjust …)
window.GameAnalytics = { trackEvent: (name, params) => { /* SDK-Aufruf */ } };

// 2) Offerwall-SDK (Tapjoy, ironSource, Fyber …)
window.OfferwallSDK = { trackEvent: (name, params) => { /* SDK-Aufruf */ } };
```

Viele Netzwerke arbeiten stattdessen mit **Server-to-Server-Postbacks**: Dann reicht es, die Events an deinen Server/Webhook zu senden (einfach `trackEvent` entsprechend erweitern) — der Server meldet das Ziel dann per Postback ans Netzwerk.

### Schritt-für-Schritt-Plan

1. **Spiel veröffentlichen:** Native App via Capacitor bauen → Google Play (AdMob einbinden). PWA-Webversion zusätzlich auf GitHub Pages/Netlify deployen.
2. **Accounts erstellen:** Bei 3–5 Offerwall-/CPI-Netzwerken anmelden (Tapjoy, ironSource, Fyber, AdGem, OfferToro …) und App zur Review einreichen.
3. **Kampagnen definieren:** Offer-Ziele aus dem Katalog oben wählen, z. B. `coins_10k` (einfach, hohe Conversion) und `prestige_1` (schwerer, höherer Payout).
4. **SDK/Postback einbinden:** `trackEvent`-Hooks verdrahten (siehe oben) oder Server-Postbacks konfigurieren.
5. **Datenschutz & Regeln:** `privacy.html` ausfüllen, Impressum/AGB ergänzen. Netzwerke lehnen Apps ohne Datenschutzerklärung ab. Events müssen **sofort und verlässlich** feuern — kein verzögertes oder zufälliges Tracking.

### Wichtig zu wissen (Risiken)

- **Incentivized Traffic ist ein Marketing-Instrument, kein Selbstläufer:** Bezahlte Install-Kampagnen bringen viele Nutzer, aber oft niedrige Retention. Kombiniere sie mit organischem Wachstum (App Store Optimization, TikTok/Shorts).
- **Zu viel gekaufter Traffic kann das Store-Ranking verschlechtern**, wenn die Nutzer schnell abspringen. Starte klein und beobachte D1/D7-Retention.
- **Payouts variieren stark** (typisch $0,20–$3 pro erfolgreichem Spieler, je nach Ziel und Land).
- Netzwerke prüfen Betrug: Cheat-Erkennung nicht umgehen, keine Fake-Events.

## Nächste sinnvolle Schritte für mehr Einnahmen

1. App-Icon als PNG (192/512) für maximale PWA-Kompatibilität nachreichen.
2. Google Play Console + AdMob einrichten, sobald du die App nativ verpackst.
3. 3–5 Offerwall-Netzwerke kontaktieren (siehe Plan oben).
4. D1/D7-Retention mit Analytics messen (Hook `window.GameAnalytics` verdrahten).
