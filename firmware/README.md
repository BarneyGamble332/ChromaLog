# Firmware für den Arduino Uno

`chromalog_uno/chromalog_uno.ino` ist der allgemeine Sketch für ChromaLog. Er enthält den UV-Detektor aus Stufe 1 und den Baukasten für die Steuerung: Bauteile werden von der App angemeldet (`CFG`) und gestellt (`SET`), der Sketch muss dafür nicht geändert werden.

**Stand: Version 0.1 – übersetzt fehlerfrei, aber noch nie auf einem Arduino gelaufen.** Vor dem ersten Einsatz jedes Bauteil einzeln und ohne Last prüfen.

## Aufspielen
1. Arduino IDE öffnen, im Bibliotheksverwalter installieren: **Servo**, **OneWire**, **DallasTemperature**, **Adafruit ADS1X15** (die Abfrage nach „Adafruit BusIO“ bestätigen).
2. Ordner `chromalog_uno` öffnen, Board „Arduino Uno“ und den Anschluss wählen, hochladen.
3. In ChromaLog unter „System“ den Anschluss „USB (seriell)“ mit 115200 Baud verbinden. Nach dem Verbinden startet der Uno neu und meldet `READY ChromaLog-Uno 0.1`; die App meldet dann alle Bauteile des aktuellen Aufbaus an.

Der serielle Monitor der Arduino IDE muss geschlossen sein, sonst ist der Anschluss belegt.

## Anschlüsse
| Pin | Verwendung |
| --- | --- |
| D0, D1 | USB-Verbindung, nicht belegen |
| D2 | DS18B20 des Detektors (fest) |
| D3 | MOSFET-Gate der UV-LED (fest) |
| A4, A5 | I2C zum ADS1115 (fest) |
| D4 … D13, A0 … A3 | frei für Bauteile |

Regeln:
- **PWM (Leistung, Gleichstrommotor) nur an D5 und D6.** Die anderen PWM-Pins sind durch die Servo-Ansteuerung (D9, D10) und die Schrittimpulse (D3, D11) belegt.
- Servos an jedem freien Pin, höchstens 4.
- Höchstens 2 Schrittmotoren (Spritzen- oder Schlauchpumpe), 2 Heizungen, 8 Bauteile insgesamt.
- Analoge Sensoren an A0 … A3 (0–5 V).

## Bauteil-Arten
| ART | Pins | Wert bei `SET` |
| --- | --- | --- |
| `SWITCH` | Ausgang | 0 oder 1 |
| `BUTTON` | Ausgang | gibt einen Impuls von 0,2 s |
| `SERVO` | Signal | Winkel 0–180° |
| `PWM` | D5 oder D6 | 0–100 % |
| `MOTOR` | PWM/Richtung | −100 … 100 % |
| `STEPPER` | Step/Dir[/Enable] | ml/min, negativ = rückwärts; ohne „Schritte je ml“ sind es Schritte je Sekunde |
| `SYRINGE` | Step/Dir[/Enable] | ml/min, positiv fördert, negativ füllt; hält bei leer und voll an |
| `HEATER` | Ausgang/DS18B20 | Solltemperatur in °C, 0 = aus |
| `SENSOR` | A0 … A3 | meldet die Spannung in Volt |
| `LIMIT` | Eingang (gegen Masse) | meldet 1 = betätigt |

## Sicherheit
- Die Heizung regelt im Arduino (Zweipunktregler, 0,3 °C Schaltabstand) und läuft auch ohne Verbindung zur App weiter. Über 70 °C Sollwert geht nicht; bei Fühlerfehler oder mehr als 75 °C schaltet sie ab.
- `STOP` hält alle Pumpen an und schaltet die Heizungen aus.
- **Noch nicht enthalten:** Endschalter an den Spritzenpumpen. Der Füllstand wird nur aus den Schritten gerechnet und nach dem Einschalten als „voll“ angenommen (mit `VOL name ml` berichtigen). Fährt eine Spritze gegen den Anschlag, merkt der Sketch das nicht.
- **Noch nicht enthalten:** Abschaltung, wenn die Verbindung zur App abreißt (außer Heizungsregelung), und ein Drehventil mit Schrittmotor und Referenzfahrt.

## Prüfen ohne Arduino IDE
`tools/build_firmware.sh <Ordner mit ArduinoCore-avr und den Bibliotheken>` übersetzt den Sketch mit avr-gcc. Letzter Stand: 20 158 Byte Programm von 32 256, 1 002 Byte fester Arbeitsspeicher von 2 048.
