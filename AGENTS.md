# Hinweise für KI-Modelle und neue Mitarbeitende

Bitte zuerst `docs/ENTWICKLUNG.md` lesen. Dort stehen Zweck, Aufbau, Protokoll, Arbeitsregeln und offene Punkte.

Kurzfassung:
- Web-App ohne Framework und ohne Build-Schritt (`index.html`, `js/`, `css/`); derselbe Code läuft im Browser, als Linux-Programm (`desktop/`, Electron) und als Android-App (`mobile/`, Capacitor). Arduino-Sketch in `firmware/`.
- Vor jedem Push: `npm test`, `npm run test:ui`, `npm run test:fw`.
- Jede neue Funktion bekommt eine Anforderung mit Nachweis in `docs/ANFORDERUNGEN.md`. Was nur am Simulator lief, heißt „am Gerät ungetestet“.
- Texte zweisprachig in `js/i18n.js`.
- Mit dem Nutzer Deutsch sprechen, einfach und mit dem Ergebnis zuerst.
