# ChromaLog – Übergabe für die Weiterentwicklung

Dieses Dokument ist für alle gedacht, die am Programm weiterarbeiten, Mensch oder KI-Modell. Es beschreibt, was das Projekt ist, wie der Code aufgebaut ist, welche Regeln gelten und was offen ist. Stand: Version 0.11, 15.11.2026.

## 1 Worum es geht
- **Projekt Gewässermessung:** ein mobiles Analysegerät (Mini-HPLC im Koffer), das Stoffe in Gewässern vor Ort trennt, erkennt und deren Konzentration bestimmt.
- **ChromaLog** ist die Software dazu: Live-Chromatogramm, Gerätesteuerung, Auswertung, Kalibrierung, Sequenzen, Bericht.
- **Hardware heute (Stufe 1):** Arduino Uno, statischer UV-Detektor mit UV-C-LED 275 nm, zwei Fotodioden GUVA-S12SD (Messung und Referenz) am ADS1115, Temperaturfühler DS18B20. Pumpen, Ventile und Heizung kommen schrittweise dazu; welche Teile genau, steht noch nicht fest.
- **Nutzer:** Bernhard, ein Entwickler mit langer Praxis an einer präparativen HPLC in der Pharma-Produktion. Für ihn ist die Dokumentation das Wichtigste. Er programmiert nicht selbst; Erklärungen bitte auf Deutsch, in einfachen Worten, das Ergebnis zuerst.

## 2 Wo was liegt
| Was | Ort |
| --- | --- |
| Quelltext | https://github.com/BarneyGamble332/ChromaLog (Zweig `main`, öffentlich) |
| Web-App | https://barneygamble332.github.io/ChromaLog/ (Groß-/Kleinschreibung beachten) |
| Fertige Pakete (AppImage, deb, APK) | Releases → „Aktueller Stand“, Kennung `aktuell`, wird bei jedem Push neu gebaut |
| Anforderungen mit Nachweis | `docs/ANFORDERUNGEN.md` |
| Validierungsplan für das Gesamtsystem | `docs/VALIDIERUNGSPLAN.md` |
| Installation | `docs/INSTALLATION.md` |
| Erste Messung mit dem Detektor | `docs/INBETRIEBNAHME-STUFE1.md` |
| Arduino-Sketch, Pins, Sicherheit | `firmware/README.md` |

## 3 Stand
**Fertig und automatisch getestet (mit Simulator bzw. nachgebildeten Anschlüssen):** alle Punkte aus dem README, 64 Anforderungen in `docs/ANFORDERUNGEN.md`.

**Am echten Gerät bestätigt:**
- Android-App läuft am Handy; Fließbild lässt sich dort gut bedienen (Ziehen, Verbinden).
- Linux-Programm verbindet sich über USB mit dem Arduino Uno (15.11.2026).

**Am echten Gerät noch nicht geprüft:** alles Weitere. Insbesondere die Messwerte des Detektors, jedes Bauteil der Steuerung (Pumpen, Ventile, Heizung, Endschalter), Bluetooth zum Gerät, der Methodenlauf. Der Sketch ist übersetzt und seine Logik am PC geprüft, mehr nicht.

**Offen / als Nächstes sinnvoll:**
1. Erste Messungen nach `docs/INBETRIEBNAHME-STUFE1.md`; Fehler daraus beheben.
2. Bedienung der Bauteile nach den ersten Versuchen mit angeschlossenen Teilen verfeinern (ausdrücklicher Wunsch des Nutzers: erst testen, dann Details).
3. A-81: Kalibriergerade aus Küvetten-Messungen für den statischen Detektortest (nicht umgesetzt).
4. Bluetooth-Modul am Uno (z. B. HM-10): im Sketch noch nicht vorgesehen, die App kann es schon.
5. Drehventil mit Schrittmotor und Referenzfahrt; Öffner-Kontakt für den Lecksensor (siehe `firmware/README.md`).
6. Prüfen, ob ein Update der APK die gespeicherten Daten behält.
7. WLAN als Anschluss ist nur vorbereitet.
8. Vergleich der Auswertung mit einer etablierten Chromatographie-Software an echten Daten.

## 4 Aufbau des Codes
Die App ist bewusst einfach gehalten: reines HTML, CSS und JavaScript ohne Framework und ohne Build-Schritt. `index.html` lädt die Dateien als normale `<script>`-Dateien in dieser Reihenfolge; jede legt globale Namen an, die die späteren benutzen.

| Datei | Aufgabe |
| --- | --- |
| `js/i18n.js` | Texte Deutsch/Englisch (`I18N.de`, `I18N.en`), `t()`, `applyI18n()` |
| `js/store.js` | Speicher (IndexedDB: Läufe, Methoden, Protokoll, Einstellungen), SHA-256, Datei speichern |
| `js/device.js` | Protokoll (`parseLine`), Simulator, Anschlüsse USB/Bluetooth für Browser und Android |
| `js/analysis.js` | Basislinie, Peakerkennung, Integration, Kennzahlen, Kalibriergerade, Quantifizierung |
| `js/plot.js` | Zeichenfläche (Canvas): Zoomfenster, Verschieben, Fingerzoom |
| `js/control.js` | Rechenkern der Steuerung: Bauteil-Bibliothek, Befehle, Rollen, Leitungsführung |
| `js/steuerung.js` | Reiter „Steuerung“: Fließbild, Bedienfenster, Aufbauten, Abläufe |
| `js/app.js` | Ablauf eines Laufs, alle übrigen Reiter, Sequenz, Bericht, Start (`init()`) |
| `css/app.css` | Gestaltung hell/dunkel, Druck; Schriften liegen lokal in `fonts/` |

Dazu:
- `firmware/chromalog_uno/` – Sketch für den Uno (Version 0.3).
- `desktop/` – Linux-Programm mit Electron (`main.js`, `ports.js` für die Auswahl des Anschlusses).
- `mobile/` – Android-App mit Capacitor. Der Ordner `android/` wird **nicht** eingecheckt, sondern im Bau erzeugt und mit `tools/android_patch.py` angepasst (Rechte, Version, Signatur).
- `tools/` – `copy_web.sh` (kopiert die Web-App nach `desktop/app` bzw. `mobile/www`), `build_firmware.sh`.
- `.github/workflows/` – `tests.yml` (alle Tests), `pakete.yml` (APK, AppImage, deb, Release).

### Wichtige Zusammenhänge
- **Ein Code für drei Wege.** Browser, Linux-Programm und Android-App benutzen dieselben Dateien. Unterschiede stecken nur in den Anschlüssen (`js/device.js`): `SerialDevice`/`BleDevice` für Browser und Electron, `AndroidSerialDevice`/`AndroidBleDevice` für die App. Alle haben dieselbe Schnittstelle: `connect()`, `close()`, `send(zeile)`, `onLine`, `onClose`, `kind`.
- **Zustand:** in `app.js` das Objekt `S`, in `steuerung.js` das Objekt `CTL`.
- **Nach dem Verbinden** meldet der Uno `READY …`; die App sendet darauf die Messrate, meldet alle Bauteile des Aufbaus an (`ctlConfigure`) und schaltet die Verbindungsüberwachung ein (`WATCHDOG 10`, danach alle 2 s `PING`).
- **Simulator:** startet nicht von selbst. Nur über „Simulator starten“ oder die Adresse mit `?demo=1` (so laufen auch die Browser-Tests).
- **Bauteile der Steuerung** werden in der App angelegt, nicht im Sketch. Die Bibliothek steht in `CTL_LIB` (`js/control.js`); ein neues Bauteil braucht dort einen Eintrag und, wenn es eine neue Art ist, die Behandlung im Sketch und im Simulator.

## 5 Geräteprotokoll
Textzeilen, 115200 Baud, Zeilenende `\n`.

Gerät → App:
| Zeile | Bedeutung |
| --- | --- |
| `READY ChromaLog-Uno 0.3` | nach dem Start |
| `D,t_s,uv_AU,leitf,druck,temp,fluss,B,VENTIL` | Datenzeile, 9 Felder, leere Felder erlaubt |
| `V,kurzname,wert` | Wert eines Bauteils; auch `V,uv_i` und `V,uv_r` (Diodenspannungen) |
| `E,STOP,name` / `E,LIMIT,name` | Lecksensor bzw. Endschalter hat ausgelöst |
| `# text` | Hinweis, erscheint im Protokoll |

App → Gerät: `FLOW`, `PCTB`, `VALVE LOAD|INJECT`, `ZERO`, `DARK`, `LED 0|1`, `RATE hz`, `STOP`, `CLEAR`, `CFG kurzname ART pins [max] [schritte_je_ml]`, `CFG kurzname LIMIT pin [ziel] [richtung]`, `SET kurzname wert`, `VOL kurzname ml`, `WATCHDOG s`, `PING`.

Der alte Stufe-1-Sketch (7 Spalten ohne Kennbuchstabe) wird weiter erkannt.

Wer das Protokoll ändert, muss vier Stellen zusammen ändern: Sketch, `parseLine`, Simulator (`SimDevice` in `js/device.js`) und die Tests.

## 6 Arbeitsweise
### Tests
```
npm install            # einmalig, holt Playwright
npm test               # Rechenkerne, 33 Tests
npm run test:ui        # Oberfläche im Browser, 15 Tests
npm run test:fw        # Logik des Sketches am PC, 51 Prüfungen
tools/build_firmware.sh   # Sketch übersetzen (avr-gcc)
```
Die Browser-Tests brauchen Chrome oder Chromium; mit installiertem Chrome: `PW_CHANNEL=chrome npm run test:ui`. Alles läuft auch bei jedem Push über GitHub Actions; beide Abläufe („Tests“, „Pakete“) müssen grün sein.

### Regeln für Änderungen
1. **Erst die Anforderung, dann der Code.** Jede neue Funktion bekommt eine Zeile in `docs/ANFORDERUNGEN.md` (Nummer A-xx, Nachweis, Status) und einen Eintrag im Änderungsverlauf. Tests tragen die Nummer im Namen.
2. **Ehrlicher Status.** „Am Gerät ungetestet“ bleibt stehen, bis es jemand am echten Gerät geprüft hat. Nichts als geprüft ausgeben, was nur am Simulator lief.
3. **Texte immer zweisprachig** in `js/i18n.js` (de und en), nie fest im HTML.
4. **Kein Framework, kein Build-Schritt** für die Web-App. Neue Abhängigkeiten nur, wenn es nicht anders geht.
5. **Rohdaten werden nie verändert.** Auswertung und manuelle Integration liegen getrennt daneben; die Prüfsumme gilt für die Rohdaten.
6. **Sicherheit bleibt im Arduino.** Heizungsgrenzen, Endschalter, Lecksensor und Verbindungsüberwachung müssen auch ohne App wirken.
7. **README und dieses Dokument mitziehen**, wenn sich Stand oder Aufbau ändern.

### Neue Version herausgeben
Versionsnummer an vier Stellen gleich setzen: `APP_VERSION` in `js/app.js`, `package.json`, `desktop/package.json`, `mobile/package.json`. Dann README („Stand Version …“) und Änderungsverlauf ergänzen, nach `main` schieben. Die Pakete entstehen von selbst.

### Stolpersteine
- Mit `const` oder `let` angelegte globale Namen hängen **nicht** an `window`. In Tests also `typeof S !== 'undefined'` statt `window.S`.
- Funktionen nicht direkt an `map` übergeben, wenn sie einen zweiten Parameter haben (`parts.map(p => ctlNodeHtml(p))`).
- Bei Wertänderung eines Bedienelements die Oberfläche nicht neu aufbauen, sonst geht der nächste Klick verloren.
- Der Uno hat wenig Speicher: Sketch belegt rund 21 500 von 32 256 Byte. PWM geht nur an D5 und D6 (Timer sind sonst belegt). Höchstens 8 Bauteile, 4 Servos, 2 Schrittmotoren, 2 Heizungen.
- Linux: Die alten Anschlüsse `ttyS0…31` sind fast immer leer; der Uno heißt `ttyACM0` (Original) oder `ttyUSB0` (Nachbau). Der Benutzer muss in der Gruppe `dialout` sein. Die Arduino-Software belegt den Anschluss, solange ihr serieller Monitor offen ist.
- Android: Das Signieren nutzt einen festen Test-Schlüssel (`mobile/chromalog-debug.p12`), damit Updates über die alte Version installiert werden können. Für eine echte Veröffentlichung braucht es einen eigenen, geheimen Schlüssel.
- Electron braucht für Bluetooth den Schalter `enable-experimental-web-platform-features` (steht in `desktop/main.js`).

## 7 Validierung
Die Software ist **nicht validiert**. Vorbereitet ist, was eine spätere Validierung braucht: Anforderungen mit Nachweis, automatische Tests, Prüfsummen, Protokoll aller Aktionen, Versionsangabe im Bericht. Bezugsrahmen bei Bedarf: ISO/IEC 17025, EU-GMP Anhang 11, 21 CFR Part 11, GAMP 5. Es fehlen unter anderem Benutzer mit Anmeldung und Rechten, elektronische Unterschrift und der Vergleich mit einem anerkannten System.
