# ChromaLog

Chromatographie-Software für die Mini-HPLC (Projekt Gewässermessung). Läuft als Web-App im Browser (Linux-PC, Android) und später als Android-App.

## Stand Version 0.6
- Live-Chromatogramm in Echtzeit: UV 275 nm, dazu Druck, Leitfähigkeit, Temperatur und Gradient
- Gerätesteuerung: Lauf mit Equilibrieren, Autozero, Injektion, Gradient-Tabelle, Ventil-Ereignissen und Druckabschaltung; Handsteuerung
- Anschlüsse: Simulator (ohne Hardware), USB seriell, Bluetooth Low Energy (Nordic UART oder HM-10); WLAN ist vorbereitet
- Methoden mit Gradient, Ventil-Ereignissen und Stoffliste
- Läufe speichern, als CSV/JSON exportieren, JSON importieren
- Erste Auswertung: Basislinie, Peakerkennung, Integration, tR, Fläche, Höhe, Halbwertsbreite, Bodenzahl, Tailing, Auflösung, S/N, Zuordnung über die Stoffliste
- Kalibrierung und Quantifizierung: Kalibriergeraden je Stoff aus Standard-Läufen (Steigung, Achsenabschnitt, R², Bereich, geschätzte Nachweisgrenze), Konzentration in der Peaktabelle
- Zoomfenster: Rechteck aufziehen vergrößert den Ausschnitt
- Vergleich: bis zu 5 weitere Läufe über das Chromatogramm legen
- Manuelle Integration: Integrationsgrenzen selbst ziehen, Peaks entfernen; die Änderungen werden mit dem Ergebnis gespeichert
- Steuerung: Fließbild mit frei angelegten Bauteilen aus einer Bibliothek (Pumpen, Ventile, Heizung, Schalter, Sensoren), verschiebbar und mit Leitungen verbindbar; mehrere Aufbauten; „Alles stopp“; einfache Abläufe (Stellen, Warten, Warten bis)
- Sequenzen: Probenliste (Blindwert, Standards, Proben) läuft nacheinander ab, auf Wunsch mit Bestätigung vor jeder Probe
- Messbericht zum Drucken oder als PDF/HTML speichern
- Methodenlauf am Prototyp: Bauteile mit Rolle (Pumpe A/B, Injektionsventil) werden von der Methode gefahren
- Nachvollziehbarkeit: Prüfsumme wird beim Öffnen und Importieren nachgerechnet; Rohdaten mit SHA-256-Prüfsumme, Protokoll aller Aktionen
- Deutsch und Englisch

## Starten
https://barneygamble332.github.io/ChromaLog/ in Chrome oder Chromium öffnen. USB und Bluetooth brauchen eine https-Adresse oder localhost.

## Geräteprotokoll (Textzeilen)
| Richtung | Zeile |
| --- | --- |
| Gerät → App | `D,t_s,uv_AU,leitf_uS,druck_bar,temp_C,fluss_ml_min,B_%,LOAD|INJECT` |
| App → Gerät | `FLOW 0.50`, `PCTB 35.0`, `VALVE INJECT`, `VALVE LOAD`, `ZERO`, `LED 1`, `RATE 10`, `STOP` |
| Steuerung | `CLEAR`, `CFG kurzname ART pins [max] [schritte_je_ml]`, `SET kurzname wert`; Gerät meldet `READY …` und `V,kurzname,wert` |
| Stufe-1-Sketch | `zeit_s,I_V,R_V,verhaeltnis,extinktion_AU,temp_C,uebersteuert` wird automatisch erkannt (Befehle `n`, `d`) |

## Arduino
`firmware/chromalog_uno` enthält den allgemeinen Sketch für den Arduino Uno (UV-Detektor aus Stufe 1 plus Baukasten für die Steuerung). Anleitung, Pin-Regeln und Sicherheitshinweise: `firmware/README.md`. Der Sketch ist übersetzt, aber noch nicht am Gerät getestet.

## Tests und Anforderungen
- `docs/ANFORDERUNGEN.md`: Anforderungen mit Nachweis und Status
- `tests/chromalog.test.js`: Tests der Rechenkerne (`npm test`)
- `tests/e2e.test.js`: Tests der Oberfläche im Browser mit dem Simulator (`npm install`, dann `npm run test:ui`)
- `tests/firmware/`: Logiktest des Arduino-Sketches am PC (`npm run test:fw`)
- Alle Tests und die Übersetzung des Sketches laufen bei jedem Push über GitHub Actions

## Aufbau
- `js/device.js` Anschlüsse, Protokoll, Simulator
- `js/control.js` Bauteil-Bibliothek und Regeln der Steuerung, `js/steuerung.js` Reiter „Steuerung“
- `js/analysis.js` Auswertung
- `js/plot.js` Zeichenfläche
- `js/store.js` Speicher (IndexedDB), Prüfsumme, Export
- `js/app.js` Ablauf und Oberfläche, `js/i18n.js` Texte
