# Validierungsplan Mini-HPLC mit ChromaLog (schlanke Fassung)

Stand: 15.11.2026 · Entwurf 1 · gilt für das Gesamtsystem aus Gerät, Arduino-Sketch und ChromaLog

## 1 Zweck
Der Plan soll mit wenig Aufwand zeigen: **Das System kann, was eine HPLC grundsätzlich können muss** – gleichmäßig fördern, reproduzierbar aufgeben, trennen, linear messen und die Ergebnisse nachvollziehbar festhalten.

Er ist bewusst **keine** Validierung nach Pharma-Regeln und noch keine Validierung einer bestimmten Analysenmethode. Er ist der erste Nachweis „ja, es geht“. Aufbau und Begriffe lehnen sich an das an, was im Labor üblich ist (Geräteprüfung, Systemeignungstest, Kenngrößen wie bei einer Methodenvalidierung), damit sich später darauf aufbauen lässt.

**Zu den Grenzwerten:** Alle Grenzwerte in diesem Plan sind Vorschläge für einen Prototyp. Sie sind absichtlich weiter gefasst als bei Laborgeräten (dort liegen Fluss und Flächen-Wiederholbarkeit üblicherweise im Bereich von 1–2 %). Sie werden **vor** der Prüfung festgelegt und danach nicht mehr angepasst; wer einen Grenzwert ändert, vermerkt das mit Begründung im Änderungsverlauf.

## 2 Was geprüft wird und wann
Der Plan folgt dem Stufenplan des Projekts. Jeder Teil kann geprüft werden, sobald die zugehörige Stufe läuft.

| Teil | Inhalt | Voraussetzung | Aufwand etwa |
| --- | --- | --- | --- |
| A | Detektor allein | Stufe 1 (jetzt) | ½ Tag |
| B | Pumpe, Dichtheit, Gradient, Sicherheit | Stufe 2 und Gradient | 1 Tag |
| C | Gesamtsystem mit Säule (Systemeignung, Linearität, Nachweisgrenze, Verschleppung, Wiederfindung) | Stufe 3 | 1–2 Tage |
| D | Software und Dokumentation | läuft mit | 1–2 Stunden |
| E | Vergleich mit einer Labor-HPLC | freiwillig, später | – |

## 3 Was man braucht
- Feinwaage (0,01 g genügt für die Flussprüfung, 0,001 g für die Einwaage der Stammlösung), Stoppuhr, Messkolben und Pipetten.
- Koffein als Hauptprüfstoff (vorhanden). Für die Trennung ein **zweiter Stoff**, der bei 275 nm absorbiert und sich von Koffein trennt; Vorschlag Benzotriazol, weil es ohnehin Zielstoff ist. Wird festgelegt, sobald Säule und Laufmittel feststehen.
- Ein Stoff, der auf der Säule nicht hängen bleibt, für die Durchbruchszeit (z. B. Uracil) – nur für Teil C, nicht zwingend.
- Aceton (ca. 0,1 % in Wasser) als Farbstoff-Ersatz für die Gradientenprüfung; es absorbiert bei 275 nm.
- Laufmittel und Säule wie für den späteren Betrieb vorgesehen.

## 4 Prüfungen

### Teil A – Detektor
| Nr. | Prüfung | Durchführung | Grenzwert (Vorschlag) |
| --- | --- | --- | --- |
| V-01 | Rauschen und Drift | Küvette bzw. Zelle mit Wasser, 15 min einlaufen lassen, dann Methode „Detektortest (10 min)“; drei Läufe. Kennzahlen stehen beim Lauf. | Rauschen ≤ 0,001 AU; Drift ≤ 0,002 AU in 10 min – in allen drei Läufen |
| V-02 | Linearität des Detektors | Koffein 0,5 / 1 / 2 / 5 / 10 / 20 mg/l, je 3 Messungen, Mittelwert gegen Konzentration | R² ≥ 0,995; größte Abweichung eines Punktes von der Geraden ≤ 5 % (ab 2 mg/l) |
| V-03 | Dunkelwert | LED aus, Gehäuse zu, 10 min | Signal bleibt stabil, keine Sprünge beim Abdecken mit dem Tuch (kein Fremdlicht) |

V-01 bis V-03 entsprechen den Zielen aus dem Stufe-1-Konzept. Für V-02 fehlt in ChromaLog noch die Auswertung für Küvetten-Messungen (Anforderung A-81); bis dahin die Mittelwerte in eine Tabelle übertragen.

### Teil B – Pumpe, Fließweg, Sicherheit
| Nr. | Prüfung | Durchführung | Grenzwert (Vorschlag) |
| --- | --- | --- | --- |
| V-10 | Flussgenauigkeit | Mit Wasser bei 0,5 und 1,0 ml/min je 3 × 5 min in ein gewogenes Gefäß fördern, auswiegen (1 g = 1 ml). Mit Säule oder Gegendruck wie im Betrieb. | Mittelwert weicht höchstens 5 % vom Sollwert ab |
| V-11 | Fluss-Wiederholbarkeit | aus den drei Wägungen je Fluss | Streuung (RSD) ≤ 2 % |
| V-12 | Dichtheit | Bei höchstem Betriebsdruck 10 min fördern; alle Verbindungen ansehen und mit Papier abtupfen | kein Tropfen; Druck schwankt um höchstens ±10 % |
| V-13 | Gradient in Stufen | A = Wasser, B = Wasser mit 0,1 % Aceton, ohne Säule. Stufen 0 / 25 / 50 / 75 / 100 % B, je 5 min. Höhe der Stufen im Signal ablesen (0 % und 100 % als Bezug). | jede Stufe höchstens 5 %-Punkte neben dem Sollwert |
| V-14 | Verzögerung des Gradienten | aus V-13: Zeit vom Umschalten bis zur halben Stufenhöhe, mal Fluss = Verweilvolumen | wird nur festgehalten, kein Grenzwert |
| V-15 | Sicherheitsfunktionen | (a) Überdruck: Grenze in der Methode niedrig setzen oder Ausgang kurz verschließen; (b) „Alles stopp“; (c) Lecksensor auslösen; (d) USB-Kabel im Betrieb ziehen; (e) Endschalter von Hand betätigen | (a) Lauf bricht ab, Pumpen stehen; (b) alles steht sofort; (c) Pumpen und Heizung aus, auch ohne App; (d) Pumpen stehen nach spätestens 10 s; (e) Pumpe hält in dieser Richtung |

V-15 ist die wichtigste Prüfung vor jedem Betrieb mit Druck und Lösungsmittel. Sie kommt **vor** V-10 bis V-14, zuerst ohne Last.

### Teil C – Gesamtsystem mit Säule
Alle Läufe mit derselben Methode und demselben Testgemisch (Koffein und zweiter Stoff, Konzentration in der Mitte des Arbeitsbereichs). In ChromaLog als Sequenz anlegen.

| Nr. | Prüfung | Durchführung | Grenzwert (Vorschlag) |
| --- | --- | --- | --- |
| V-20 | Wiederholbarkeit (Systemeignung) | 6 Injektionen des Testgemischs hintereinander | Retentionszeit: RSD ≤ 2 %; Peakfläche: RSD ≤ 5 % |
| V-21 | Trennung | aus den Läufen von V-20 | Auflösung zwischen den beiden Stoffen ≥ 1,5 |
| V-22 | Peakform | aus den Läufen von V-20 | Tailingfaktor 0,8 bis 2,0 |
| V-23 | Trennleistung | aus den Läufen von V-20 | Bodenzahl wird festgehalten; sie dient als Vergleichswert für später |
| V-24 | Linearität | 5 Konzentrationen über den Arbeitsbereich, je 2 Injektionen; Kalibrierung in ChromaLog | R² ≥ 0,99; Rückrechnung jedes Standards innerhalb ±15 % |
| V-25 | Nachweis- und Bestimmungsgrenze | niedrigsten Standard so weit verdünnen, bis der Peak gerade sicher erkannt wird | Nachweisgrenze = Konzentration bei Signal/Rausch 3; Bestimmungsgrenze bei Signal/Rausch 10; Werte werden festgehalten |
| V-26 | Verschleppung | direkt nach dem höchsten Standard einen Blindlauf (Wasser) | Peak im Blindlauf ≤ 1 % der Fläche des höchsten Standards |
| V-27 | Wiederfindung | echte Wasserprobe (z. B. Bachwasser) einmal ohne und einmal mit bekannter Zugabe des Prüfstoffs messen, je 3 × | Wiederfindung 80–120 % |
| V-28 | Tag-zu-Tag | V-20 an einem zweiten Tag mit frisch angesetztem Laufmittel wiederholen (3 Injektionen genügen) | Retentionszeit weicht höchstens 5 % vom ersten Tag ab; Fläche höchstens 10 % |

Die Anreicherung (SPE) ist hier noch nicht enthalten. Sie bekommt einen eigenen Abschnitt, wenn sie gebaut ist (Wiederfindung über die Kartusche, Anreicherungsfaktor).

### Teil D – Software und Dokumentation
| Nr. | Prüfung | Durchführung | Grenzwert |
| --- | --- | --- | --- |
| V-30 | Stand der Software | Version von ChromaLog und Sketch notieren; automatische Tests für diese Version bestanden (GitHub, Haken bei „Tests“) | alle Tests grün |
| V-31 | Auswertung nachgerechnet | Einen Lauf aus V-20 als CSV exportieren, einen Peak in einer Tabellenkalkulation von Hand integrieren (Trapezregel, gleiche Grenzen, Basislinie abgezogen) | Fläche weicht höchstens 2 % ab, Retentionszeit höchstens 1 Messpunkt |
| V-32 | Rohdaten unverändert | Einen Lauf exportieren, wieder importieren; danach die Datei mit einem Editor an einer Zahl ändern und erneut importieren | unveränderte Datei: Prüfsumme stimmt; geänderte Datei: ChromaLog meldet die Abweichung |
| V-33 | Bericht vollständig | Messbericht eines Laufs aus V-20 erzeugen | enthält Probe, Methode, Zeitpunkt, Version, Peaktabelle, Chromatogramm, Prüfsumme |
| V-34 | Protokoll | Im Reiter „System“ das Protokoll nach der Prüfreihe ansehen | Start und Ende jedes Laufs, Änderungen an Methode und Auswertung sind eingetragen |

### Teil E – Vergleich (freiwillig)
Dieselben Standards und eine Probe auf einer Labor-HPLC messen lassen. Kein Grenzwert; der Vergleich zeigt, wie nah das Gerät an einem Laborgerät liegt, und ist der stärkste Nachweis gegenüber Dritten.

## 5 So wird dokumentiert
Für jede Prüfung ein kurzer Eintrag, am besten in einer Tabelle oder auf einem Blatt je Teil:

| Feld | Inhalt |
| --- | --- |
| Nr. und Datum | z. B. V-20, 03.12.2026 |
| Stand des Geräts | Aufbau (Stufe), Säule, Laufmittel, Version ChromaLog, Version Sketch |
| Läufe | Namen der Läufe in ChromaLog; die exportierten JSON-Dateien aufheben |
| Ergebnis | gemessene Zahl |
| Grenzwert | aus diesem Plan |
| Bewertung | bestanden / nicht bestanden |
| Bemerkung | Auffälligkeiten, Abweichungen vom Plan |
| Name, Unterschrift | wer geprüft hat |

Regeln:
- **Nicht bestanden ist ein Ergebnis, kein Makel.** Die Messung bleibt im Protokoll stehen. Ursache suchen, beheben, die Prüfung wiederholen und beide Einträge behalten.
- Läufe werden nicht gelöscht und nicht ausgewählt („die schönsten sechs“). Fällt ein Lauf wegen eines erkennbaren Fehlers aus (Luftblase, Schlauch ab), wird er mit Grund vermerkt und wiederholt.
- Nach einer Änderung am Gerät oder an der Software werden die betroffenen Prüfungen wiederholt: neue Pumpe → Teil B und C; neue Säule oder Methode → Teil C; neue Version von ChromaLog → V-30 und V-31.

## 6 Wann gilt „ja, es geht“
- Teil A, B und D vollständig bestanden,
- in Teil C mindestens V-20 bis V-22, V-24 und V-26 bestanden,
- V-25 (Grenzen) und V-23 (Bodenzahl) als Zahl festgehalten.

Das Ergebnis ist ein kurzer Abschlussbericht: eine Seite mit der Tabelle aller Prüfungen, den Abweichungen und einem Satz zur Bewertung, dazu die Messberichte aus ChromaLog als Anhang.

## 7 Was danach käme
Für eine bestimmte Messaufgabe (z. B. Benzotriazol im Kläranlagenablauf) folgt eine Methodenvalidierung mit denselben Kenngrößen, aber strengeren Grenzen und zusätzlich Selektivität in der echten Matrix, Robustheit und Messunsicherheit. Orientierung geben dann ICH Q2(R2) für die Kenngrößen, DIN 32645 für Nachweis- und Bestimmungsgrenze und ISO/IEC 17025 für den Laborbetrieb. Für die Software kämen Benutzer mit Rechten und elektronische Unterschrift dazu (siehe `docs/ANFORDERUNGEN.md`, „nicht umgesetzt“).

## Änderungsverlauf
| Datum | Fassung | Änderung |
| --- | --- | --- |
| 15.11.2026 | Entwurf 1 | Erste Fassung. Grenzwerte sind Vorschläge und noch nicht mit Messungen am Gerät abgeglichen. |
