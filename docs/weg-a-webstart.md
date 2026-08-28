# Weg A – Kostenloser Web-Start (0 €)

Ziel: Das Spiel **heute, ohne Geld**, live im Internet veröffentlichen und mit Werbung monetarisieren. Später mit den ersten Einnahmen in den Google Play Store wechseln (Weg B).

## Überblick

```
Dieses Projekt (statische Dateien)
        │
        ▼
Kostenloses Hosting (GitHub Pages ODER Netlify)
        │
        ▼
Kostenlose Ad-Netzwerke (Adsterra / PropellerAds)
        │
        ▼
Erste Einnahmen (klein, aber echt)
```

## Schritt 1: GitHub Pages (empfohlen)

Voraussetzung: kostenloses Konto auf [github.com](https://github.com).

```bash
cd "/c/Users/honse/Documents/big_project/money maker"

# 1) Git-Repo initialisieren (einmalig)
git init
git add .
git commit -m "Coin Tap Idle – erster Stand"

# 2) Auf GitHub: neues leeres Repo anlegen, z. B. "coin-tap-idle"
#    Dann (URL anpassen):
git remote add origin https://github.com/DEINNAME/coin-tap-idle.git
git branch -M main
git push -u origin main
```

Danach auf GitHub:
1. Repo öffnen → **Settings** → **Pages**
2. Source: `Deploy from a branch` → Branch `main` → Ordner `/ (root)` → **Save**
3. Nach 1–2 Minuten ist das Spiel erreichbar unter:
   `https://DEINNAME.github.io/coin-tap-idle/`

> Tipp: Die PWA (Service Worker) funktioniert auf `github.io` automatisch, weil GitHub Pages HTTPS nutzt.

## Schritt 1b: Netlify (Alternative ohne Git-Kenntnisse)

1. Konto auf [netlify.com](https://www.netlify.com) erstellen (kostenlos)
2. **Add new site → Deploy manually**
3. Den gesamten Projektordner per Drag & Drop hochladen
4. Fertig – Link sieht aus wie `https://zufallsname.netlify.app`

## Schritt 2: Werbung einbinden (0 €)

AdSense geht meist erst mit eigener Domain. Für den Start nimmt man Netzwerke, die auch kostenlose Subdomains akzeptieren:

| Netzwerk | Formate | Auszahlung ab ca. | Zahlung |
|---|---|---|---|
| [Adsterra](https://adsterra.com) | Banner, Interstitial, Native | $5 | PayPal, Krypto |
| [PropellerAds](https://propellerads.com) | Interstitial, Push | $25 | PayPal, Krypto |

### So bindest du sie ein

1. Beim Netzwerk anmelden → Website/Zone anlegen (deine `github.io`- bzw. `netlify.app`-URL eintragen)
2. **Banner-Code** kopieren → in `index.html` den Inhalt des `#banner-ad`-Containers ersetzen:

```html
<!-- Vorher (Platzhalter): -->
<div id="banner-ad" class="banner-ad" aria-hidden="true">📢 Werbung (Banner-Platzhalter)</div>

<!-- Nachher (Beispiel): -->
<div id="banner-ad" class="banner-ad">
  <script type="text/javascript" src="https://...adsterra-banner-code..."></script>
</div>
```

3. **Interstitial-Code** (z. B. nach Prestige) in `js/game.js` bei `AdBridge.showInterstitial()` einfügen:

```js
showInterstitial() {
  // Adsterra/PropellerAds-Snippet hier einfügen
  // Beispiel: window.adsterraInterstitial?.show();
}
```

4. **Boost-Button:** Web-Netzwerke haben selten klassische Rewarded Videos. Bis ein passendes Netzwerk gefunden ist, läuft der Button im Demo-Modus (Boost ohne Werbung). Das ist okay für den Start.

> Wichtig: `privacy.html` ausfüllen und im Spiel verlinken – alle Ad-Netzwerke verlangen eine Datenschutzerklärung.

## Schritt 3: Spieler ohne Budget bekommen

- **TikTok / YouTube Shorts / Instagram Reels:** 20–30 Sekunden Gameplay + Bildschirmtext („Ich habe ein Idle-Spiel gebaut"). Täglich 1 Clip.
- **Reddit:** r/incremental_games, r/indiegames, r/playmygame – ehrlich vorstellen, Feedback einsammeln.
- **Discord-Communities** für Idle-/Incremental-Spiele.
- **PWA-Install-Prompt:** Spieler können das Spiel direkt auf den Homescreen installieren – nutzt sich automatisch über das Manifest.

## Schritt 4: Realistische Erwartungen

- **Tag 1–30:** vermutlich Cent-Beträge. Das ist normal ohne Marketingbudget.
- **Ziel:** erste ~25 € ansparen → Google Play Developer-Konto kaufen → Weg B (native App + AdMob, deutlich bessere CPMs).
- **Danach:** Mit Play-Einnahmen weiter reinvestieren (Apple-Konto, erste Offerwall-Kampagnen).

## Checkliste für den Launch

- [ ] GitHub-/Netlify-Konto erstellt
- [ ] Spiel deployed und im Handy-Browser getestet
- [ ] Ad-Netzwerk-Konto erstellt, Banner + Interstitial eingebaut
- [ ] `privacy.html` ausgefüllt und verlinkt
- [ ] Erster TikTok/Shorts-Clip veröffentlicht
- [ ] Einnahmen wöchentlich prüfen (Auszahlungsgrenze im Blick)
