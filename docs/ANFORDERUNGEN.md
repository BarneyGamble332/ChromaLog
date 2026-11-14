# ChromaLog – Anforderungen und Nachweise

Stand: 12.11.2026 · gilt für Version 0.8

Dieses Dokument hält fest, was die Software können muss, und womit jede Anforderung nachgewiesen ist. Es ist die Grundlage für eine spätere Validierung. Bei jeder Änderung an der Software wird es mitgepflegt.

## Wie der Nachweis geführt wird
- **Automatisch:** Test der Rechenkerne in `tests/chromalog.test.js` mit derselben Nummer (`npm test`).
- **Automatisch im Browser:** Test der Oberfläche in `tests/e2e.test.js`; ein echter Browser bedient die App mit dem Simulator (`npm run test:ui`).
- **Logiktest am PC:** Der Arduino-Sketch wird mit einer nachgebildeten Arduino-Umgebung für den PC übersetzt und in `tests/firmware/test_fw.cpp` geprüft (`npm run test:fw`). Das prüft Befehle, Grenzen und Abschaltungen, nicht die Elektrik und nicht das Zeitverhalten am echten Gerät.
- **Offen:** noch nicht nachgewiesen.

Alle drei Testarten und die Übersetzung des Sketches für den Uno laufen bei jedem Push auf GitHub (Reiter „Actions“, Workflow „Tests“).

Die Referenzdaten der Rechenkern-Tests sind berechnete Chromatogramme aus Gauß-Peaks mit bekannter Fläche, Lage und Breite, dazu Rauschen (σ = 0,05 mAU) und Drift. Der Zufall ist fest eingestellt, jeder Testlauf rechnet mit denselben Zahlen.

## 1 Datenerfassung und Gerät
| Nr. | Anforderung | Nachweis | Status |
| --- | --- | --- | --- |
| A-01 | Der Gradient wird zwischen den Tabellenzeilen linear interpoliert; vor der ersten und nach der letzten Zeile gilt deren Wert. | Automatisch | erfüllt |
| A-02 | Datenzeilen des Geräts (`D,…`) werden vollständig und richtig gelesen; ein leeres UV-Feld gilt als „kein Wert“. | Automatisch | erfüllt |
| A-03 | Der Stufe-1-Sketch (7 Spalten) wird erkannt; Kopfzeilen und Text werden nicht als Messwert gewertet. | Automatisch | erfüllt |
| A-04 | Ein Lauf läuft in der Reihenfolge Equilibrieren, Autozero, Injektion, Gradient, Ende ab und wird gespeichert. | Automatisch im Browser (Simulator) | erfüllt im Simulator |
| A-05 | Überschreitet der Druck die Grenze der Methode, stoppt die Software die Pumpen und bricht ab – im Lauf und schon beim Equilibrieren. | Automatisch im Browser (Simulator) | erfüllt im Simulator |
| A-06 | Verbindung über USB seriell: im Browser (Web Serial), im Linux-Programm und in der Android-App (Plugin). | Linux: Selbsttest beim Bau (Anschluss verfügbar). Android: automatisch im Browser mit nachgebildeter Plugin-Brücke. Am Gerät offen. | am Gerät ungetestet |
| A-07 | Verbindung über Bluetooth Low Energy: im Browser, im Linux-Programm und in der Android-App (Plugin); Nordic UART und HM-10. | Android: automatisch im Browser mit nachgebildeter Plugin-Brücke. Am Gerät offen. | am Gerät ungetestet |
| A-08 | Eine Sequenz arbeitet die Probenliste der Reihe nach ab und wartet auf Wunsch vor jeder Probe auf Bestätigung. | Automatisch im Browser (Simulator) | erfüllt im Simulator |

## 2 Auswertung
| Nr. | Anforderung | Toleranz | Nachweis | Status |
| --- | --- | --- | --- | --- |
| A-10 | Alle Peaks über der Schwelle werden gefunden, die Retentionszeit stimmt. | ±0,01 min | Automatisch | erfüllt |
| A-11 | Die Peakfläche stimmt auch auf driftender Basislinie; die Flächenprozente ergeben 100 %. | ±2 % | Automatisch | erfüllt |
| A-12 | Höhe, Halbwertsbreite, Bodenzahl und Tailing stimmen. | ±3 % / ±5 % / ±10 % / 0,9–1,1 | Automatisch | erfüllt |
| A-13 | Die Auflösung zwischen Nachbarpeaks stimmt. | ±5 % | Automatisch | erfüllt |
| A-14 | Ein Blindwert (nur Rauschen) ergibt keinen Peak. | 5 Rauschfolgen | Automatisch | erfüllt |
| A-15 | Peaks unter der eingestellten Signal/Rausch-Schwelle werden nicht gemeldet. | – | Automatisch | erfüllt |
| A-16 | Die Auswertung verändert die Rohdaten nicht. | exakt | Automatisch | erfüllt |
| A-17 | Manuelle Integrationsgrenzen ersetzen den automatischen Peak, entfernte Peaks fehlen im Ergebnis, der manuelle Peak ist gekennzeichnet. | Fläche ±2 % | Automatisch | erfüllt |
| A-18 | Peaks werden über Retentionszeit und Fenster dem Stoff zugeordnet. | – | Automatisch | erfüllt |
| A-19 | Überlappende Peaks werden per Lot getrennt. | ±5 % | Automatisch | erfüllt |

## 3 Kalibrierung und Quantifizierung
| Nr. | Anforderung | Toleranz | Nachweis | Status |
| --- | --- | --- | --- | --- |
| A-20 | Die Kalibriergerade liefert Steigung, Achsenabschnitt und R² richtig, wahlweise durch den Nullpunkt. | rechnerisch exakt | Automatisch | erfüllt |
| A-21 | Mit zu wenigen Punkten entsteht keine Gerade. | – | Automatisch | erfüllt |
| A-22 | Die Konzentration wird aus Fläche, Steigung und Achsenabschnitt berechnet; Werte außerhalb des kalibrierten Bereichs sind markiert. | exakt | Automatisch | erfüllt |
| A-23 | Ändern sich Fluss, Gradient, Säule, Laufmittel oder Stoffliste einer Methode, wird ihre Kalibrierung verworfen. | – | Automatisch im Browser (Simulator) | erfüllt |
| A-30 | Gesamtkette: Standards 1, 5 und 20 mg/l kalibrieren, eine Probe mit 3 mg/l wird richtig bestimmt. | ±5 %, R² > 0,999 | Automatisch (Simulator) | erfüllt |

## 4 Nachvollziehbarkeit und Bericht
| Nr. | Anforderung | Nachweis | Status |
| --- | --- | --- | --- |
| A-40 | Jeder Lauf trägt eine SHA-256-Prüfsumme der Rohdaten. | Automatisch im Browser (Simulator), im Test A-04 | erfüllt |
| A-41 | Die Methode wird mit jedem Lauf mitgespeichert. | Automatisch im Browser (Simulator), im Test A-04 | erfüllt |
| A-42 | Auswertung und manuelle Änderungen werden getrennt von den Rohdaten gespeichert und bleiben nach dem Neuladen erhalten. | Automatisch im Browser (Simulator) | erfüllt |
| A-43 | Verbinden, Läufe, Methodenänderungen, Kalibrierungen, Auswertungen, Exporte und Löschungen stehen im Protokoll. | Teilweise Browser-Test | teilweise |
| A-44 | Der Messbericht enthält Probe, Methode, Chromatogramm, Ergebnis, Kalibrierung, Integrationsparameter, Prüfsumme mit Prüfergebnis und Software-Version; simulierte Daten sind gekennzeichnet. | Automatisch im Browser (Simulator) | erfüllt |
| A-45 | Das Protokoll hält fest, wer eine Aktion ausgeführt hat (Anmeldung, Rollen, elektronische Unterschrift). | – | nicht umgesetzt |
| A-46 | Daten und Protokoll liegen manipulationssicher und mit Sicherung vor. | – | nicht umgesetzt (Browser-Speicher) |
| A-47 | Beim Öffnen und beim Importieren eines Laufs wird die Prüfsumme nachgerechnet. Veränderte Rohdaten werden markiert, im Protokoll vermerkt und im Bericht ausgewiesen. | Automatisch (Rechenkern und Browser) | erfüllt |

## 5 Steuerung (Fließbild, Bauteile, Abläufe)
| Nr. | Anforderung | Nachweis | Status |
| --- | --- | --- | --- |
| A-50 | Jedes Bauteil sendet den richtigen Befehl: Standard `SET kurzname wert`, eigener Befehl mit `{v}`, Taster ohne Wert. | Automatisch | erfüllt |
| A-51 | Bauteile ohne eigenen Befehl werden beim Gerät angemeldet (`CFG`); Anzeigen aus der Datenzeile und Bauteile mit eigenem Befehl nicht. | Automatisch | erfüllt |
| A-52 | „Alles stopp“ sendet für jedes Bauteil den hinterlegten sicheren Wert; Bauteile ohne sicheren Wert bleiben unverändert. | Automatisch | erfüllt |
| A-53 | Ablauf-Schritte „Stellen“, „Warten“ und „Warten bis“ schalten richtig weiter; eine Zeitüberschreitung bricht ab; ohne Messwert wird gewartet. | Automatisch | erfüllt |
| A-54 | Messwerte werden aus der Datenzeile (`D:`) oder von einem Bauteil (`V:`) gelesen; fehlende Werte gelten als „kein Wert“. | Automatisch | erfüllt |
| A-55 | Kurznamen sind je Aufbau eindeutig; Stellungen werden aus „Name=Wert“ gelesen. | Automatisch | erfüllt |
| A-56 | Eine Leitung verlässt die Kachel an der Seite, die zum Ziel zeigt. | Automatisch | erfüllt |
| A-57 | Simulator: Spritzenpumpe fördert das eingestellte Volumen und hält leer an; Heizung erreicht den Sollwert; Messwertzeilen werden gelesen. | Automatisch | erfüllt |
| A-58 | Bauteile lassen sich verschieben, verbinden, ändern und löschen; der Aufbau bleibt nach dem Neuladen erhalten. | Automatisch im Browser (Simulator) | erfüllt im Simulator |
| A-59 | „Alles stopp“ beendet einen laufenden Ablauf und stoppt die Pumpen. | Automatisch im Browser (Simulator) | erfüllt im Simulator |
| A-60 | Während eines Methodenlaufs sind die Bauteile gesperrt, die die Methode selbst fährt (Rolle oder Methodenbefehl); alle anderen bleiben bedienbar. „Alles stopp“ bricht auch den Methodenlauf ab. | Automatisch (Rechenkern und Browser) | erfüllt im Simulator |
| A-61 | Allgemeiner Sketch für den Arduino Uno (`firmware/chromalog_uno`), der `CLEAR`, `CFG` und `SET` versteht, Pin-Regeln prüft und Messwerte als `V`-Zeilen meldet. | Übersetzung für den Uno und Logiktest am PC (F-01 bis F-12, F-60 bis F-70) | Logik geprüft, am Gerät ungetestet |
| A-62 | Heizung: Regelung, Begrenzung des Sollwerts und Abschaltung bei Fühlerfehler oder Übertemperatur laufen im Gerät, auch ohne Verbindung zur App. | Logiktest am PC (F-30 bis F-32, F-50) | Logik geprüft, am Gerät ungetestet |
| A-63 | Lecksensor: Der Sketch stoppt Pumpen und Heizungen selbst und meldet es; die App führt daraufhin „Alles stopp“ aus. | Logiktest am PC (F-40) und automatisch im Browser | Logik geprüft, am Gerät ungetestet |
| A-64 | Anzeigen rechnen den Rohwert um (Faktor und Versatz), z. B. Volt in bar; Abläufe können auf den umgerechneten Wert warten. | Automatisch (im Test A-54) | erfüllt |
| A-65 | Nach dem Neustart des Arduino (`READY`) meldet die App alle Bauteile des Aufbaus neu an und schaltet die Verbindungsüberwachung ein. | Automatisch im Browser (nachgestellte READY-Zeile) | am Gerät ungetestet |
| A-66 | Endschalter halten eine Pumpe in der eingestellten Richtung an und berichtigen den Füllstand. Bleibt das Lebenszeichen der App aus, halten die Pumpen an; die Heizung regelt weiter. | Logiktest am PC (F-20, F-21, F-50, F-51) | Logik geprüft, am Gerät ungetestet |
| A-67 | Ein Methodenlauf fährt die Bauteile mit Rolle: Pumpe A und B teilen den Fluss nach dem Anteil B, das Injektionsventil schaltet zwischen erster und zweiter Stellung; ohne Rollen gehen die Befehle unverändert ans Gerät. | Automatisch (Rechenkern und Browser) | erfüllt im Simulator |
| A-68 | Endschalter und Lecksensor werden nach ihrem Ziel angemeldet; Ereigniszeilen des Geräts (`E,STOP`, `E,LIMIT`) werden gelesen. | Automatisch | erfüllt |
| A-73 | Die Bauteile des gewählten Aufbaus erscheinen im Reiter „Messen“ mit ihren Bedienelementen und laufenden Messwerten; einzelne Bauteile lassen sich ausblenden; ohne Bauteile erscheint die feste Handsteuerung. | Automatisch im Browser (Simulator) | erfüllt im Simulator |
| A-74 | Im Fließbild zeigt jede Kachel nur den Zustand; ein Klick wählt das Bauteil an und öffnet ein Fenster mit seinen Bedienelementen. Reine Anzeigen öffnen kein Fenster. | Automatisch im Browser (Simulator) | erfüllt im Simulator |

## 6 Linux-Programm und Android-App
| Nr. | Anforderung | Nachweis | Status |
| --- | --- | --- | --- |
| A-69 | Eintreffender Text wird auch aus Bruchstücken zu Zeilen zusammengesetzt; Bluetooth-Daten werden richtig in Hex gewandelt. | Automatisch | erfüllt |
| A-70 | Linux-Programm (AppImage, deb): startet, zeigt die App, der Simulator läuft, Daten werden dauerhaft gespeichert, serieller Anschluss und Bluetooth stehen zur Auswahl. | Selbsttest bei jedem Bau (Workflow „Pakete“) | erfüllt; Geräteauswahl von Hand ungetestet |
| A-71 | Android-App: lässt sich bauen und installieren; Bildschirm bleibt an; Dateien werden in „Dokumente/ChromaLog“ gespeichert, sonst über „Teilen“. | Bau bei jedem Push; Verhalten automatisch im Browser mit nachgebildeter Plugin-Brücke (Tests A-06, A-07) | gebaut, auf keinem Handy getestet |
| A-72 | Eine neue APK lässt sich über die alte installieren, die Daten bleiben erhalten (gleiche Signatur, steigender Versionscode). | – | offen |

## Bekannte Grenzen
- Die Browser-Tests decken die wichtigsten Abläufe ab, nicht jede Schaltfläche. Die Bedienung am Handy ist nicht getestet.
- Referenzdaten sind berechnet. Ein Vergleich mit einer etablierten Chromatographie-Software an echten Messdaten steht aus.
- Mit echter Hardware ist noch nichts geprüft.
- Die Toleranzen gelten für Peaks mit Signal/Rausch-Verhältnis deutlich über der Schwelle; nahe der Nachweisgrenze sind sie nicht nachgewiesen.

## Änderungsverlauf
| Datum | Version | Änderung |
| --- | --- | --- |
| 12.11.2026 | 0.3 | Erste Fassung: 31 Anforderungen, davon 17 mit automatischem Test. |
| 12.11.2026 | 0.4 | Abschnitt 5 „Steuerung“ ergänzt: 14 Anforderungen, davon 8 mit automatischem Test. Insgesamt 45 Anforderungen, 25 automatische Tests. |
| 12.11.2026 | 0.5 | Uno-Sketch ergänzt (A-61, A-62 umgesetzt, ungetestet), A-64 bis A-66 neu. Insgesamt 48 Anforderungen. |
| 13.11.2026 | 0.6 | Prüfsummen-Prüfung (A-47), Rollen im Methodenlauf (A-67), Endschalter, Lecksensor und Verbindungsüberwachung im Sketch (A-63, A-66, A-68). Neu: 9 Browser-Tests und 48 Prüfungen der Sketch-Logik am PC; die bisherigen Browser-Prüfungen von Hand sind damit automatisch. Insgesamt 50 Anforderungen. |
| 13.11.2026 | 0.7 | Linux-Programm und Android-App (A-69 bis A-72); A-06 und A-07 um die neuen Wege erweitert. Insgesamt 54 Anforderungen. |
| 14.11.2026 | 0.8 | Bauteile im Reiter „Messen“ (A-73), Bedienfenster im Fließbild (A-74), Sperre im Lauf nur noch für von der Methode gefahrene Bauteile (A-60). Insgesamt 56 Anforderungen. |
