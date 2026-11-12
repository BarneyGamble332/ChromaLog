# ChromaLog – Anforderungen und Nachweise

Stand: 12.11.2026 · gilt für Version 0.4

Dieses Dokument hält fest, was die Software können muss, und womit jede Anforderung nachgewiesen ist. Es ist die Grundlage für eine spätere Validierung. Bei jeder Änderung an der Software wird es mitgepflegt.

## Wie der Nachweis geführt wird
- **Automatisch:** Test in `tests/chromalog.test.js` mit derselben Nummer. Die Tests laufen bei jedem Push auf GitHub (Reiter „Actions“, Workflow „Tests“); der Testbericht wird dort zu jedem Stand aufbewahrt. Lokal: `npm test`.
- **Browser-Test:** von Hand bzw. skriptgesteuert im Browser mit dem Simulator geprüft, mit Datum. Diese Prüfungen laufen noch nicht automatisch mit.
- **Offen:** noch nicht nachgewiesen.

Die Referenzdaten der automatischen Tests sind berechnete Chromatogramme aus Gauß-Peaks mit bekannter Fläche, Lage und Breite, dazu Rauschen (σ = 0,05 mAU) und Drift. Der Zufall ist fest eingestellt, jeder Testlauf rechnet mit denselben Zahlen.

## 1 Datenerfassung und Gerät
| Nr. | Anforderung | Nachweis | Status |
| --- | --- | --- | --- |
| A-01 | Der Gradient wird zwischen den Tabellenzeilen linear interpoliert; vor der ersten und nach der letzten Zeile gilt deren Wert. | Automatisch | erfüllt |
| A-02 | Datenzeilen des Geräts (`D,…`) werden vollständig und richtig gelesen; ein leeres UV-Feld gilt als „kein Wert“. | Automatisch | erfüllt |
| A-03 | Der Stufe-1-Sketch (7 Spalten) wird erkannt; Kopfzeilen und Text werden nicht als Messwert gewertet. | Automatisch | erfüllt |
| A-04 | Ein Lauf läuft in der Reihenfolge Equilibrieren, Autozero, Injektion, Gradient, Ende ab und wird gespeichert. | Browser-Test 12.11.2026 (Simulator) | erfüllt im Simulator |
| A-05 | Überschreitet der Druck die Grenze der Methode, stoppt die Software die Pumpen und bricht den Lauf ab. | Offen (nur Code-Durchsicht) | offen |
| A-06 | Verbindung über USB seriell. | Offen (keine Hardware) | offen |
| A-07 | Verbindung über Bluetooth Low Energy. | Offen (keine Hardware) | offen |
| A-08 | Eine Sequenz arbeitet die Probenliste der Reihe nach ab und wartet auf Wunsch vor jeder Probe auf Bestätigung. | Browser-Test 12.11.2026 (Simulator, 5 Proben) | erfüllt im Simulator |

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
| A-23 | Ändern sich Fluss, Gradient, Säule, Laufmittel oder Stoffliste einer Methode, wird ihre Kalibrierung verworfen. | – | Browser-Test 12.11.2026 | erfüllt |
| A-30 | Gesamtkette: Standards 1, 5 und 20 mg/l kalibrieren, eine Probe mit 3 mg/l wird richtig bestimmt. | ±5 %, R² > 0,999 | Automatisch (Simulator) | erfüllt |

## 4 Nachvollziehbarkeit und Bericht
| Nr. | Anforderung | Nachweis | Status |
| --- | --- | --- | --- |
| A-40 | Jeder Lauf trägt eine SHA-256-Prüfsumme der Rohdaten. | Browser-Test 12.11.2026 | erfüllt |
| A-41 | Die Methode wird mit jedem Lauf mitgespeichert. | Browser-Test 12.11.2026 | erfüllt |
| A-42 | Auswertung und manuelle Änderungen werden getrennt von den Rohdaten gespeichert und bleiben nach dem Neuladen erhalten. | Browser-Test 12.11.2026 | erfüllt |
| A-43 | Verbinden, Läufe, Methodenänderungen, Kalibrierungen, Auswertungen, Exporte und Löschungen stehen im Protokoll. | Teilweise Browser-Test | teilweise |
| A-44 | Der Messbericht enthält Probe, Methode, Chromatogramm, Ergebnis, Kalibrierung, Integrationsparameter, Prüfsumme und Software-Version; simulierte Daten sind gekennzeichnet. | Browser-Test 12.11.2026 | erfüllt |
| A-45 | Das Protokoll hält fest, wer eine Aktion ausgeführt hat (Anmeldung, Rollen, elektronische Unterschrift). | – | nicht umgesetzt |
| A-46 | Daten und Protokoll liegen manipulationssicher und mit Sicherung vor. | – | nicht umgesetzt (Browser-Speicher) |
| A-47 | Prüfung der Prüfsumme beim Öffnen oder Importieren eines Laufs. | – | nicht umgesetzt |

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
| A-58 | Bauteile lassen sich verschieben, verbinden, ändern und löschen; der Aufbau bleibt nach dem Neuladen erhalten. | Browser-Test 12.11.2026 (Simulator) | erfüllt im Simulator |
| A-59 | „Alles stopp“ beendet einen laufenden Ablauf und stoppt die Pumpen. | Browser-Test 12.11.2026 (Simulator) | erfüllt im Simulator |
| A-60 | Während eines Methodenlaufs ist die Steuerung gesperrt; „Alles stopp“ bricht auch den Methodenlauf ab. | Offen (nur Code-Durchsicht) | offen |
| A-61 | Allgemeiner Arduino-Sketch, der `CFG` und `SET` versteht und Messwerte als `V`-Zeilen meldet. | – | nicht umgesetzt |
| A-62 | Heizung: Regelung und Übertemperatur-Abschaltung laufen im Gerät, auch ohne Verbindung zur App. | – | nicht umgesetzt (gehört zu A-61) |
| A-63 | Ein Endschalter oder Lecksensor kann „Alles stopp“ auslösen. | – | nicht umgesetzt |

## Bekannte Grenzen
- Die Tests prüfen die Rechenkerne (`js/analysis.js`, `js/device.js`, `js/control.js`). Die Oberfläche und der Ablauf im Browser sind noch nicht automatisch abgedeckt.
- Referenzdaten sind berechnet. Ein Vergleich mit einer etablierten Chromatographie-Software an echten Messdaten steht aus.
- Mit echter Hardware ist noch nichts geprüft.
- Die Toleranzen gelten für Peaks mit Signal/Rausch-Verhältnis deutlich über der Schwelle; nahe der Nachweisgrenze sind sie nicht nachgewiesen.

## Änderungsverlauf
| Datum | Version | Änderung |
| --- | --- | --- |
| 12.11.2026 | 0.3 | Erste Fassung: 31 Anforderungen, davon 17 mit automatischem Test. |
| 12.11.2026 | 0.4 | Abschnitt 5 „Steuerung“ ergänzt: 14 Anforderungen, davon 8 mit automatischem Test. Insgesamt 45 Anforderungen, 25 automatische Tests. |
