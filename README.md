# ChromaLog

Chromatographie-Software für die Mini-HPLC (Projekt Gewässermessung). Läuft als Web-App im Browser (Linux-PC, Android) und später als Android-App.

## Stand Version 0.2
- Live-Chromatogramm in Echtzeit: UV 275 nm, dazu Druck, Leitfähigkeit, Temperatur und Gradient
- Gerätesteuerung: Lauf mit Equilibrieren, Autozero, Injektion, Gradient-Tabelle, Ventil-Ereignissen und Druckabschaltung; Handsteuerung
- Anschlüsse: Simulator (ohne Hardware), USB seriell, Bluetooth Low Energy (Nordic UART oder HM-10); WLAN ist vorbereitet
- Methoden mit Gradient, Ventil-Ereignissen und Stoffliste
- Läufe speichern, als CSV/JSON exportieren, JSON importieren
- Erste Auswertung: Basislinie, Peakerkennung, Integration, tR, Fläche, Höhe, Halbwertsbreite, Bodenzahl, Tailing, Auflösung, S/N, Zuordnung über die Stoffliste
- Kalibrierung und Quantifizierung: Kalibriergeraden je Stoff aus Standard-Läufen (Steigung, Achsenabschnitt, R², Bereich, geschätzte Nachweisgrenze), Konzentration in der Peaktabelle
- Zoomfenster: Rechteck aufziehen vergrößert den Ausschnitt
- Nachvollziehbarkeit: Rohdaten mit SHA-256-Prüfsumme, Protokoll aller Aktionen
- Deutsch und Englisch

## Starten
https://barneygamble332.github.io/ChromaLog/ in Chrome oder Chromium öffnen. USB und Bluetooth brauchen eine https-Adresse oder localhost.

## Geräteprotokoll (Textzeilen)
| Richtung | Zeile |
| --- | --- |
| Gerät → App | `D,t_s,uv_AU,leitf_uS,druck_bar,temp_C,fluss_ml_min,B_%,LOAD|INJECT` |
| App → Gerät | `FLOW 0.50`, `PCTB 35.0`, `VALVE INJECT`, `VALVE LOAD`, `ZERO`, `LED 1`, `RATE 10`, `STOP` |
| Stufe-1-Sketch | `zeit_s,I_V,R_V,verhaeltnis,extinktion_AU,temp_C,uebersteuert` wird automatisch erkannt (Befehle `n`, `d`) |

## Aufbau
- `js/device.js` Anschlüsse, Protokoll, Simulator
- `js/analysis.js` Auswertung
- `js/plot.js` Zeichenfläche
- `js/store.js` Speicher (IndexedDB), Prüfsumme, Export
- `js/app.js` Ablauf und Oberfläche, `js/i18n.js` Texte
