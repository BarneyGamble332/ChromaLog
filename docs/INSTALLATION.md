# ChromaLog installieren

Es gibt drei Wege, ChromaLog zu benutzen. Alle zeigen dieselbe Software.

| Weg | Wo | USB zum Arduino | Bluetooth |
| --- | --- | --- | --- |
| Im Browser | https://barneygamble332.github.io/ChromaLog/ in Chrome oder Chromium | ja | ja (unter Linux muss in Chrome „Experimental Web Platform features“ an sein) |
| Linux-Programm | AppImage oder deb-Paket | ja | ja |
| Android-App | APK | ja, mit USB-OTG-Adapter | ja |

Die fertigen Pakete liegen im Repo unter **Releases → „Aktueller Stand“**: https://github.com/BarneyGamble332/ChromaLog/releases/tag/aktuell
Sie werden bei jeder Änderung neu gebaut.

**Stand der Prüfung:** Die Linux-Version wird beim Bau automatisch gestartet und geprüft (Simulator läuft, serieller Anschluss und Bluetooth sind verfügbar). Die Android-App wird gebaut, ist aber noch auf keinem Handy gelaufen; geprüft ist nur, dass ChromaLog die Verbindungs-Plugins richtig anspricht (mit einer nachgebildeten Umgebung). Mit einem echten Arduino ist auf keinem der drei Wege etwas getestet.

## Linux
**AppImage (ohne Installation)**
1. `ChromaLog-…-x86_64.AppImage` herunterladen.
2. Ausführbar machen: Rechtsklick → Eigenschaften → „Als Programm ausführen“, oder `chmod +x ChromaLog-*.AppImage`.
3. Starten. Meldet das System fehlendes FUSE: `./ChromaLog-*.AppImage --appimage-extract-and-run`.

**deb-Paket (Debian, Ubuntu, Mint)**
`sudo apt install ./ChromaLog-…-amd64.deb`, danach steht ChromaLog im Startmenü.

**Zugriff auf den Arduino:** Der Benutzer muss in der Gruppe `dialout` sein, sonst erscheint der Anschluss nicht:
`sudo usermod -a -G dialout $USER`, danach ab- und wieder anmelden.

Beim Verbinden zeigt das Programm die gefundenen Anschlüsse bzw. nach vier Sekunden Suche die Bluetooth-Geräte zur Auswahl.

Die Daten (Läufe, Methoden, Aufbauten) liegen im Benutzerordner unter `~/.config/ChromaLog`. Sie sind getrennt von den Daten im Browser.

## Android
1. Auf dem Handy die Release-Seite öffnen und `ChromaLog-….apk` herunterladen.
2. Die Datei antippen. Android fragt einmalig, ob der Browser Apps installieren darf: erlauben.
3. Android warnt bei Apps, die nicht aus dem Play Store kommen. Das ist hier erwartet.

**USB:** Arduino über einen USB-OTG-Adapter anstecken, in ChromaLog unter „System“ den Anschluss „USB (seriell)“ wählen und verbinden. Android fragt nach der Erlaubnis für das USB-Gerät.

**Bluetooth:** „Bluetooth (BLE)“ wählen und verbinden; die App zeigt die gefundenen Geräte. Der Arduino Uno braucht dafür ein BLE-Modul (z. B. HM-10); der Sketch unterstützt das noch nicht.

**Besonderheiten der App**
- Der Bildschirm bleibt an, solange die App offen ist. Wird sie in den Hintergrund gelegt, hält Android die Aufzeichnung an.
- Exportierte Dateien landen in „Dokumente/ChromaLog“. Klappt das nicht, öffnet sich „Teilen“.
- Drucken geht in der App nicht; den Messbericht als HTML-Datei speichern und von dort drucken.
- Die Daten der App sind getrennt von denen im Browser. Läufe lassen sich als JSON exportieren und woanders importieren.

**Aktualisieren:** Die neue APK einfach über die alte installieren, die Daten bleiben erhalten. Alle Pakete tragen dieselbe Signatur. Der Schlüssel dafür liegt offen im Repo (`mobile/chromalog-debug.p12`); er taugt nur zum Ausprobieren, nicht für eine Veröffentlichung im Play Store.

## Selbst bauen
- Linux: `cd desktop && npm install && npm run dist` (Ergebnis in `desktop/dist`), zum Ausprobieren `npm start`.
- Android: siehe `.github/workflows/pakete.yml`; nötig sind Node 22, Java 21 und das Android SDK.
