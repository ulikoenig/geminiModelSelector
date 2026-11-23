[English](README.md) | **Deutsch**

# Gemini: automatisch das beste Modell und den höchsten Denkaufwand wählen

Tampermonkey-Userscript für `https://gemini.google.com/app`. Es wählt das **beste für Sie verfügbare Modell** (den
untersten freigeschalteten Eintrag der Modellauswahl) und den **höchsten verfügbaren Denkaufwand**. Einträge im Menü mit
**Schloss-Symbol** werden ausgeblendet.

## Installation

1. Tampermonkey im Browser installieren (Chrome, Edge oder Firefox).
2. Tampermonkey-Dashboard → „Neues Skript erstellen“ → Inhalt von `gemini-best-model.user.js` einfügen → speichern.
3. `https://gemini.google.com/app` neu laden.

## Verhalten

- **Modell:** Das Auswahlmenü führt seine Modelle von klein nach groß auf (Automatic zuerst). Von allen wählbaren
  Einträgen (Radio-Einträge, weder gesperrt noch deaktiviert) zählt der **letzte**. Kommt später ein neues Modell unten
  dazu, folgt das Skript ohne Änderung. Ist „Automatic“ der einzige wählbare Eintrag (abgemeldet oder ohne
  Bezahltarif), ändert sich nichts.
- **Denkaufwand:** Das Modellmenü endet mit einem Eintrag, der ein Untermenü öffnet. Das Skript erkennt ihn an der
  Struktur (Eintrag mit Untermenü, der kein Modell ist), nicht am Namen, deshalb geht es in jeder UI-Sprache. Im
  Untermenü wird der **letzte wählbare** Eintrag gewählt (heute „Hoch“). Modelle ohne so einen Eintrag sind ebenfalls
  in Ordnung.
- **Gesperrte Einträge sind ausgeblendet:** Jeder Eintrag des Auswahlmenüs (und seines Untermenüs) mit Schloss-Symbol
  wird ausgeblendet, damit man ihn nicht versehentlich wählt. Das geschieht doppelt: über ein konstruiertes
  Stylesheet und, falls der Browser oder die Userscript-Sandbox das verweigert (Firefox-Content-Script-Welten tun das
  mitunter), über Inline-Stile, die das Skript selbst setzt, bevor das Menü gezeichnet wird. Das Skript klickt nie einen
  gesperrten oder deaktivierten Eintrag und nie „Anmelden“.
- **Zwei Layouts der Auswahl:** unter dem Eingabefeld (breites Fenster) und in der Kopfzeile (schmales Fenster,
  angezeigt als „Gemini Neon“). Beide öffnen dieselbe Menüliste; nur die Schaltfläche der Auswahl ist anders markiert
  (in der Kopfzeile sitzt die Test-ID am `<gem-button>` um den `<button>`, und der Button hat weder `aria-haspopup` noch
  `aria-expanded`). Das Skript kommt mit beiden zurecht. Die Beschriftung in der Kopfzeile zeigt den Denkaufwand wie die
  unter dem Eingabefeld („Neon Hoch“). Die beiden Layouts unterscheiden sich auch darin, wie „Denkaufwand“ seine
  Optionen zeigt: im breiten Fenster öffnen sie sich in einem Flyout neben dem Menü (per Hover), im schmalen Fenster
  (gesehen bei 640 px und 870 px) klappt der Eintrag an Ort und Stelle wie ein Akkordeon auf (per Klick), und seine
  Optionen stehen im Eintrag. Das Skript liest beides; im schmalen Layout probiert es zuerst den Hover, jeder Blick
  dauert dort etwa eine Sekunde länger. Ein Handy (gemessen bei 360 px mit der mobilen Seite, abgemeldet) nutzt das
  Layout der Kopfzeile: dieselbe Menüliste in einem Popover, kein Bottom Sheet. Ein Screenshot von Firefox auf Android
  (angemeldet) zeigt dort die Akkordeon-Form von „Denkaufwand“. Was bekannt ist und was nicht, steht unter „Handy“ in der
  Fehlersuche.
- **Zwei Ansichten der Auswahl:** Neben der Menüliste kann die Auswahl „The Periodic Table of Gemini“ zeigen (ein Panel
  mit den Umschaltern „Full table“ und „List view“ und einer Kachel je Modell). Das Skript arbeitet auf der Liste:
  erscheint das Panel, drückt es „List view“ (exakter Treffer der ganzen Beschriftung; sonst wird im Panel nie etwas
  geklickt, keine Kachel, kein „Unlock“) und macht weiter. Die Seite merkt sich die Ansicht. Hat das Panel keinen
  solchen Umschalter, tut das Skript darin nichts, und das Debug-Log enthält einen Auszug des Panels.
- **Reihenfolge und Prüfung:** Das Skript öffnet das Modellmenü, liest die Häkchen und klickt den ersten Eintrag, der
  noch nicht stimmt. Die Seite schließt das Menü bei jedem Klick, deshalb schaut das Skript erneut hin: zuerst das
  Modell (ein Modellwechsel kann den Denkaufwand zurücksetzen), dann der Denkaufwand, dann ein letzter Blick zur
  Kontrolle. Stimmt schon alles, wird nichts geklickt.
- **Wann es läuft:** einmal nach dem Laden der Seite, wenn sich die Beschriftung der Auswahl ändert (die Seite oder
  jemand anderes hat Modell oder Denkaufwand gewechselt: die Beschriftung zeigt beides, z. B. „Neon Hoch“, den
  Denkaufwand nur, solange er nicht der niedrigste ist) und wenn Sie einen **neuen Chat** öffnen (der Pfad wird wieder
  `/app`). Ein neuer Chat wird sicherheitshalber einmal angesehen, weil der niedrigste Denkaufwand nicht in der
  Beschriftung steht. Das Senden der ersten Nachricht eines Chats (`/app` wird zu `/app/<id>`) öffnet das Menü nicht.
- **Ihre eigene Wahl gewinnt:** Bedienen Sie das Modellmenü selbst (echter Klick oder Tastendruck, auch mitten in einem
  automatischen Lauf), fasst das Skript es bis zum Neuladen der Seite nicht mehr an. Ein neuer Chat hebt das nicht auf.
  Zum erneuten Setzen von bestem Modell und Denkaufwand die Seite neu laden.
- **Sicherungen:** Setzt die Seite die Auswahl immer wieder zurück (5 Versuche mit Klick in 30 s), pausiert das Skript
  2 Minuten. Nach 5 Fehlversuchen in Folge gibt es auf, bis sich die Beschriftung der Auswahl oder der Chat ändert.
  Ein Menü mit nur einem Modell kann eine unfertige Seite sein, es wird deshalb dreimal angesehen, bevor das Skript
  zur Ruhe kommt.
- **Tippen:** Das Menü wird nie innerhalb von 1,5 s nach einem Tastendruck von Ihnen geöffnet, es kann also nichts von
  dem verschlucken, was Sie tippen.
- **Fokus:** Nach einem Lauf kehrt der Tastaturfokus dorthin zurück, wo er vorher war (meist das Eingabefeld). Escape
  wird nur gesendet, solange ein Menü offen ist.
- **Kein Flackern:** Das Menü ist unsichtbar, solange das Skript arbeitet.
- **Debug:** `localStorage.setItem('gemini-best-model-debug', '1')` in der Konsole, danach die Seite neu laden. Das Log
  zeigt jedes Menü, das das Skript sieht (`*` gewählt, `>` öffnet Untermenü, `[lock]`, `[disabled]`). Findet sich das
  Skript nicht zurecht (kein Untermenü, kein wählbarer Eintrag), enthält das Log zusätzlich einen kompakten Auszug von
  Auswahl und Menüs; für eine Fehlermeldung genügen dann die Zeilen mit `[gemini-best-model]`. Menübeschriftungen werden
  geloggt, Chat-Inhalte nie.
- **Log-Anzeige (für ein Handy, das keine Konsole hat):** `https://gemini.google.com/app?gbm-debug` in einem **neuen Tab**
  öffnen (das Skript liest die Adresse beim Laden der Seite; ein Server macht aus `?gbm-debug` mitunter `?gbm-debug=`,
  beides funktioniert). Das Skript zeigt dann sein Log in einem Panel am unteren Rand der Seite: die Zeile „geladen“, die
  Umgebung (User-Agent, Fenstergröße, Touch, Userscript-Manager, ob der Browser `:has()` kennt), ob die Auswahl gefunden
  wurde, jedes Menü, das es sieht, und was es geklickt hat. „Log kopieren“ kopiert den Text (oder von Hand markieren),
  „Ausschalten“ entfernt die Einstellung, „Schließen“ blendet das Panel bis zum nächsten Laden aus. Auch `?gbm-debug=off`
  schaltet es aus. Die Einstellung bleibt bis dahin bestehen. Das Log enthält Menübeschriftungen und technische Angaben
  zum Gerät, keine Chat-Inhalte.

## Fehlersuche

- **Nichts passiert:** Ein Userscript-Manager schleust ein Skript nur beim Laden einer Seite ein; nach dem Installieren
  oder Aktualisieren des Skripts die Seite also neu laden (am Handy: neu öffnen), ein schon offener Tab bleibt
  unberührt. Dann in der Browserkonsole nach der Zeile `[gemini-best-model] <Version> geladen (...)` suchen. Das
  Skript gibt sie einmal je Seitenladung aus, ohne jeden Schalter. Fehlt sie, läuft das Skript auf der Seite nicht
  (Tampermonkey-Symbol: ist das Skript für den Tab aufgeführt und aktiv?). Ist sie da, das Debug-Flag setzen (siehe
  Debug), neu laden und das Log lesen: Es nennt den Schritt, der scheitert.
- **Handy (Firefox auf Android), keine Konsole:** Zuerst wie oben neu laden, dann im Menü des Userscript-Managers bei
  geöffnetem Gemini-Tab prüfen, dass dieses Skript für die Seite aufgeführt und aktiviert ist und welche Version es hat
  (die Log-Anzeige braucht 1.0.5 oder neuer). Dann die Seite mit `?gbm-debug` öffnen, wie unter Debug beschrieben. **Gar kein Panel:** Das
  Skript läuft auf der Seite nicht: Manager, Match-Muster oder Version, nicht die Auswahl. **Panel da:** lesen; die ersten
  Zeilen sagen, ob die Auswahl gefunden wurde, und nach etwa 10 s nennt „Nach 10 s keine nutzbare Modellauswahl“, was
  das Skript stattdessen sieht. Das Log in eine Fehlermeldung kopieren.
- **`@grant GM_addStyle` statt `@grant none`:** Bei `none` schleust der Userscript-Manager das Skript als Inline-`<script>`
  in die Seite ein, und die strenge Content-Security-Policy von Gemini blockt das in Firefox (Datenschutz-Erweiterungen
  verschärfen das). Mit einem Grant führt der Manager das Skript in seiner eigenen Sandbox aus, die keine Seitenrichtlinie
  blocken kann. Das Skript braucht nur DOM, Ereignisse und `localStorage`, und die teilt die Sandbox mit der Seite; die
  Tests lassen es in der Welt der Seite und in einer isolierten Welt laufen.

## Prüfstand

Gemessen am 23.11.2026 auf der echten Gemini-Seite, **abgemeldet** (deutsche Oberfläche): Auswahl
(`bard-mode-switcher`, `data-test-id="bard-mode-menu-button"`), Menü (`gem-menu role="menu"` in einem Popover),
Modelleinträge (`gem-menu-item role="menuitemradio"`, `aria-checked`, `aria-disabled`, Schloss `fonticon="lock"`),
Eintrag „Anmelden“. Der E2E-Test prüft das Skript gegen genau diese Seite. Eine gespeicherte Kopie der angemeldeten
Seite (Menü geschlossen) zeigt dasselbe Markup der Auswahl; die Beschriftung steht in `span.picker-primary-text`. Ein
echtes Konsolenlog des Skripts (Firefox, Tampermonkey, angemeldet, 23.11.2026) zeigt die Menüliste korrekt gelesen: vier
Radio-Einträge (Automatic, Hilfe im Alltag, Detaillierte Analyse gewählt, Code und komplexe Aufgaben gesperrt, aber
**nicht** `aria-disabled`, deshalb wird die Sperre am Symbol erkannt) und „Denkaufwand“ als Eintrag mit Untermenü. Dasselbe
Log zeigte, dass eine Firefox-Userscript-Sandbox ein `view`-Member in synthetischen Ereignissen ablehnt; das Skript baut
seine Ereignisse ohne. Das
Denkaufwand-Untermenü gibt es nur für angemeldete Nutzer und es existiert nur bei geöffnetem Menü; es ist durch die
Mock-Seite abgedeckt (aus demselben Markup und dem Verhalten der Menükomponente der Seite gebaut) und, wenn ein Profil
vorhanden ist, durch den angemeldeten Teil des E2E-Tests (siehe unten). Die automatischen Tests laufen in Chromium;
Tampermonkey in Firefox deckt keiner davon ab.

**Live-Prüfung, schmales Fenster** (Firefox im Responsive-Modus bei etwa 870 px, Skript 1.0.4): Die Auswahl in der
Kopfzeile wurde gefunden und derselbe Ablauf lief durch (Denkaufwand gewählt, Kontrolldurchgang „bereits das beste“);
die Kopfzeile zeigte „Neon Hoch“. **Live-Prüfung, breites Fenster** (Firefox, Tampermonkey, angemeldet, Skript 1.0.3,
23.11.2026): Das Skript öffnete das
Denkaufwand-Untermenü (Einträge „Niedrig (Schnell und effizient)“, „Mittel (Ausgewogener Tiefgang)“, „Hoch (Besonders
gründlich)“), wählte „Hoch“, und sein Kontrolldurchgang fand Modell und Denkaufwand wie gewünscht. Die Auswahl zeigte
danach „Neon Hoch“. **Ausblenden bestätigt:** Auf einem Screenshot des geöffneten Menüs in Firefox (angemeldet, schmales
Fenster, 640 px) fehlt der gesperrte Eintrag „Code und komplexe Aufgaben“; das Menü zeigt Automatic, „Hilfe im Alltag“
und „Detaillierte Analyse“ sowie „Denkaufwand“ mit „Hoch“ angehakt.

**Handy:** Die Auswahl und ihr Menü bei 360 px Breite mit dem User-Agent von Firefox auf Android wurden auf der echten
Seite gemessen, abgemeldet (Chromium mit Touch und Pixeldichte 3 als Ersatz): Die Auswahl sitzt in der Kopfzeile, das
Menü ist dasselbe `gem-menu`-Popover in `bard-mode-switcher`, und das Skript läuft dort im E2E-Test durch (Auswahl
gefunden, Menü gelesen, gesperrte Einträge ausgeblendet, nichts geklickt, Menü wieder geschlossen). **Live-Prüfung,
Firefox auf Android** (angemeldet, 23.11.2026): Nach dem frischen Öffnen der Seite zeigte die Kopfzeile „Neon Hoch“,
Modell und Denkaufwand waren also gesetzt. Eine frühere Prüfung am selben Handy (Skript 1.0.4) hatte den Denkaufwand auf
„Niedrig“ und den gesperrten Eintrag „Code und komplexe Aufgaben“ weiter sichtbar gezeigt. Das Ausblenden übernimmt das
Stylesheet, sobald das Skript läuft; das Skript lief auf jener Seite also sehr wahrscheinlich gar nicht. Die Ursache ist
nicht belegt, und welche Version bei der zweiten Prüfung lief, wurde nicht festgehalten. Version 1.0.5 bringt die
Log-Anzeige für solche Fälle (siehe Debug). **Firefox auf Android selbst deckt kein automatischer Test ab.**

## Code und Lokalisierung

Der Code des Skripts (Bezeichner, Kommentare) ist englisch. Texte gibt es auf Englisch und Deutsch:

- **Tampermonkey-Header:** `@name`/`@description` englisch, `@name:de`/`@description:de` deutsch.
- **Konsolenmeldungen (Debug):** Tabelle `MESSAGES` im Skript, Sprache nach `navigator.language`. Deutsch bekommt
  deutsche Texte, jede andere Sprache englische.
- **Andere UI-Sprachen:** Nichts an der Erkennung hängt von der UI-Sprache ab (Auswahl: `data-test-id`; Denkaufwand:
  Struktur; Schloss: Icon-Name).

## Tests (Chrome oder Edge + Playwright)

```sh
npm install
npm test            # Menü-Test (Mock-Seite) und E2E-Test (echte Seite)
npm run test:menu   # nur Mock-Seite: Regeln, Ausblenden, Fokus, neuer Chat, eigene Wahl, Tippen, Schleifenbremse, Wiederholung
npm run test:e2e    # echte Seite: abgemeldet (Wegwerfprofil; breites, schmales und Handy-Fenster; Log-Anzeige) und, falls vorhanden, angemeldet
node tools/probe.mjs --viewport=870x600   # Auswahl und Menüs der echten Seite ausgeben (beliebige Fenstergröße)
node tools/probe.mjs --mobile             # dasselbe als Handy: 360x780, Touch, User-Agent von Firefox auf Android
npm run login       # einmalig: öffnet ein Browserfenster zur Google-Anmeldung und sichert die Sitzung für den E2E-Test
```

Der Menü-Test braucht kein Konto. Seine Mock-Seite bildet das Markup der Auswahl nach, wie es auf der echten Seite
gemessen wurde, samt Denkaufwand-Untermenü und dem Verhalten, von dem das Skript abhängt (Popover in der obersten Ebene,
Fokus wandert ins Menü und zurück, Escape schließt eine Ebene, ein deaktivierter Eintrag verschluckt den Klick). Er lässt
die Seite auch als Handy laufen (Touch, 360 px, User-Agent von Firefox auf Android) und deckt die Log-Anzeige ab.
`ONLY=<Regex>` führt einzelne Szenarien aus, `VERBOSE=1` zeigt Zustand und Skript-Log auch für bestandene Prüfungen.

Der E2E-Test lädt das Skript als Init-Script (Tampermonkey selbst läuft im Test nicht; das Skript nutzt keine
`GM_*`-API). Abgemeldet läuft er in einem Wegwerfprofil. Der angemeldete Teil läuft, wenn `npm run login` das Profil
`.profile/` angelegt hat, und stellt zuerst von Hand den niedrigsten Denkaufwand ein; er sendet nie eine Nachricht,
ändert aber die Auswahl von Modell und Denkaufwand dieses Kontos, wofür das Skript ja da ist.

`npm run login` öffnet ein gewöhnliches Browserfenster mit eigenem Profil (`.profile/`, nicht Ihr normales Profil,
Sync aus). Dort bei Google anmelden und das Fenster schließen, sobald Gemini Ihr Konto zeigt; das Skript liest dann die
Cookies des Profils und sichert sie in `.auth/gemini-state.json`. Es muss ein gewöhnliches Fenster sein: Chrome setzt
`navigator.webdriver = true`, sobald ein Debug-Port offen ist (mit Chrome 158 gemessen), und ein von Playwright
gestarteter Browser tut das ebenfalls; Google lehnt die Anmeldung dann ab („Dieser Browser oder diese App ist unter
Umständen nicht sicher“). Playwright fasst das Profil erst an, wenn das Fenster geschlossen ist und die Sitzung schon
besteht. `npm run login:finish` sichert nur die Sitzung eines Profils, das schon eine enthält. Dieser Anmeldeablauf ist
noch nicht bis zum Ende durchlaufen worden: Die ersten Versuche wurden aus dem oben genannten Grund abgelehnt, und die
Live-Prüfung lief stattdessen in Firefox. **`.profile/` und
`.auth/` enthalten eine aktive Google-Sitzung. Sie sind per `.gitignore` ausgeschlossen; nie committen oder
weitergeben.** Der Browser ist standardmäßig Chrome (ein frisches Edge-Profil kann sich von selbst mit dem
Windows-Konto anmelden und eine Synchronisierung starten); mit `GEMINI_BROWSER_EXE` / `GEMINI_BROWSER_CHANNEL` lässt sich ein
anderer wählen.

## Lizenz

[MIT](LICENSE)
