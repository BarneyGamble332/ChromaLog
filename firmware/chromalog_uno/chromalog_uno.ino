/*
 * ChromaLog – allgemeiner Sketch für den Arduino Uno          Version 0.1
 *
 * Der Sketch macht zwei Dinge:
 *  1. UV-Detektor wie in Stufe 1: ADS1115 (A0 = Messdiode, A1 = Referenzdiode),
 *     UV-LED über MOSFET, DS18B20. Er sendet die Extinktion als Datenzeile.
 *  2. Baukasten: Die App meldet Bauteile an (CFG) und stellt sie (SET).
 *     Dafür muss der Sketch nicht geändert werden.
 *
 * Benötigte Bibliotheken (Arduino IDE → Bibliotheksverwalter):
 *   Servo, OneWire, DallasTemperature, Adafruit ADS1X15 (bringt Adafruit BusIO mit)
 *
 * Feste Anschlüsse:
 *   D3        MOSFET-Gate der UV-LED
 *   D2        DS18B20 des Detektors (4,7 kΩ nach +5 V)
 *   A4 / A5   I2C zum ADS1115 (Adresse 0x48)
 *   D0 / D1   USB-Verbindung, nicht belegen
 *
 * Frei für Bauteile: D4 … D13, A0 … A3
 *   PWM (Leistung, Gleichstrommotor) geht nur an D5 und D6.
 *   Servos an jedem freien Pin. Höchstens 4 Servos, 2 Schrittmotoren, 2 Heizungen, 8 Bauteile.
 *
 * Befehle (eine Zeile, 115200 Baud):
 *   CFG <name> <ART> <pins> [max] [schritte_je_ml]   Bauteil anmelden, pins z. B. 9 oder 4/7/8
 *        ART: SWITCH pin | BUTTON pin | SERVO pin | PWM pin | MOTOR pwm/richtung
 *             STEPPER step/dir[/enable] | SYRINGE step/dir[/enable] | HEATER ausgang/ds18b20
 *             SENSOR analogpin | LIMIT pin
 *   SET <name> <wert>     SWITCH 0/1 · SERVO Winkel 0–180 · PWM 0–100 % · MOTOR −100…100 %
 *                         STEPPER/SYRINGE ml/min (negativ = rückwärts bzw. füllen)
 *                         HEATER Solltemperatur in °C (0 = aus)
 *   VOL <name> <ml>       Füllstand einer Spritze setzen
 *   CLEAR                 alle Bauteile abmelden und ausschalten
 *   LED 0|1 · ZERO (oder n) · DARK (oder d) · RATE <Hz> · STOP (alle Pumpen und Heizungen aus)
 *
 * Meldungen:
 *   READY ChromaLog-Uno <version>                  nach dem Start
 *   D,<t_s>,<extinktion_AU>,,,<temp_C>,,,          Datenzeile
 *   V,<name>,<wert>                                Füllstand, Ist-Temperatur, Sensor, Endschalter (1 = betätigt)
 *   # Text                                         Hinweise und Fehler
 *
 * Sicherheit: Die Heizung regelt hier im Arduino, auch ohne Verbindung zur App.
 * Über HEATER_MAX_C oder bei Fühlerfehler schaltet sie ab.
 * Noch nicht enthalten: Endschalter an den Spritzenpumpen, Drehventil mit Referenzfahrt.
 */
#include <Wire.h>
#include <Servo.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <Adafruit_ADS1X15.h>

#define FW_VERSION "0.1"
const uint8_t PIN_LED = 3;
const uint8_t PIN_DS18B20 = 2;
const float HEATER_MAX_C = 70.0;      // höchste erlaubte Solltemperatur
const float HEATER_HYST_C = 0.3;      // Schaltabstand der Heizung
const uint8_t MAX_PARTS = 8, MAX_SERVO = 4, MAX_STEP = 2, MAX_HEAT = 2, NOPIN = 255;

enum Kind : uint8_t { K_NONE, K_SWITCH, K_BUTTON, K_SERVO, K_PWM, K_MOTOR, K_STEPPER, K_SYRINGE, K_HEATER, K_SENSOR, K_LIMIT };
const char KN0[] PROGMEM = "SWITCH"; const char KN1[] PROGMEM = "BUTTON"; const char KN2[] PROGMEM = "SERVO"; const char KN3[] PROGMEM = "PWM";
const char KN4[] PROGMEM = "MOTOR"; const char KN5[] PROGMEM = "STEPPER"; const char KN6[] PROGMEM = "SYRINGE"; const char KN7[] PROGMEM = "HEATER";
const char KN8[] PROGMEM = "SENSOR"; const char KN9[] PROGMEM = "LIMIT";
const char *const KIND_NAMES[] PROGMEM = { KN0, KN1, KN2, KN3, KN4, KN5, KN6, KN7, KN8, KN9 };

struct Part {
  char key[11];
  Kind kind;
  uint8_t pin[3];
  uint8_t slot;          // Platz in der Servo-, Schrittmotor- oder Heizungstabelle
  float val;             // Sollwert
  float par;             // SYRINGE: Spritzenvolumen in ml
  float spm;             // Schritte je ml (0 = Wert ist Schritte je Sekunde)
  float aux;             // SYRINGE: Füllstand in ml · HEATER: Ist-Temperatur
  unsigned long tOff;    // BUTTON: Ende des Impulses
};
struct Stepper { volatile uint8_t *port; uint8_t mask; volatile uint32_t rate; uint32_t acc; volatile long count; volatile bool high; long seen; };
struct Heater { OneWire *wire; DallasTemperature *sensor; };

Part parts[MAX_PARTS];
uint8_t nParts = 0, nServo = 0, nStep = 0, nHeat = 0;
Servo servos[MAX_SERVO];
Stepper steppers[MAX_STEP];
Heater heaters[MAX_HEAT];

Adafruit_ADS1115 ads;
OneWire detWire(PIN_DS18B20);
DallasTemperature detTemp(&detWire);
bool hasAds = false, ledOn = false, zeroReq = false, darkReq = false;
float sumI = 0, sumR = 0, darkI = 0, darkR = 0, ratio0 = 1, tempC = NAN;
uint16_t nAvg = 0;
unsigned long dataMs = 1000, tData = 0, tSlow = 0, tVol = 0;
char line[72];
uint8_t lineLen = 0;

/* Schrittimpulse: Timer 2 läuft mit 10 kHz. Jeder Motor zählt seine Rate (Schritte/s × 1000) auf. */
ISR(TIMER2_COMPA_vect) {
  for (uint8_t i = 0; i < MAX_STEP; i++) {
    Stepper &s = steppers[i];
    if (s.high) { *s.port &= ~s.mask; s.high = false; }
    if (s.rate) {
      s.acc += s.rate;
      if (s.acc >= 10000000UL) { s.acc -= 10000000UL; *s.port |= s.mask; s.high = true; s.count++; }
    }
  }
}

uint8_t parsePin(const char *s) {
  if (!s || !*s || *s == '-') return NOPIN;
  if (*s == 'A' || *s == 'a') { int n = atoi(s + 1); return (n >= 0 && n <= 3) ? (uint8_t)(A0 + n) : NOPIN; }
  int n = atoi(s);
  return (n >= 4 && n <= 13) ? (uint8_t)n : NOPIN;
}
void parsePins(char *s, uint8_t *out) {
  out[0] = out[1] = out[2] = NOPIN;
  for (uint8_t i = 0; s && i < 3; i++) { char *q = strchr(s, '/'); if (q) *q = 0; out[i] = parsePin(s); s = q ? q + 1 : NULL; }
}
Kind parseKind(const char *s) {
  for (uint8_t i = 0; i < 10; i++) if (strcasecmp_P(s, (const char *)pgm_read_ptr(&KIND_NAMES[i])) == 0) return (Kind)(i + 1);
  return K_NONE;
}
Part *findPart(const char *key) {
  for (uint8_t i = 0; i < nParts; i++) if (strcmp(parts[i].key, key) == 0) return &parts[i];
  return NULL;
}
void fail(const __FlashStringHelper *msg, const char *key) { Serial.print(F("# FEHLER ")); if (key) { Serial.print(key); Serial.print(F(": ")); } Serial.println(msg); }

float setStepper(Part &p, float v) {
  if (p.kind == K_SYRINGE) { if (v > 0 && p.aux <= 0) v = 0; if (v < 0 && p.aux >= p.par) v = 0; }
  float sps = p.spm > 0 ? fabs(v) / 60.0 * p.spm : fabs(v);
  if (sps > 5000) sps = 5000;
  if (p.pin[1] != NOPIN) digitalWrite(p.pin[1], v < 0 ? HIGH : LOW);
  if (p.pin[2] != NOPIN) digitalWrite(p.pin[2], sps > 0 ? LOW : HIGH);       // Enable ist bei den üblichen Treibern LOW-aktiv
  uint32_t r = (uint32_t)(sps * 1000.0 + 0.5);
  noInterrupts(); steppers[p.slot].rate = r; interrupts();
  return v;
}
void setPart(Part &p, float v) {
  switch (p.kind) {
    case K_SWITCH: digitalWrite(p.pin[0], v != 0 ? HIGH : LOW); break;
    case K_BUTTON: digitalWrite(p.pin[0], HIGH); p.tOff = millis() + 200; if (!p.tOff) p.tOff = 1; break;
    case K_SERVO: v = constrain(v, 0, 180); if (!servos[p.slot].attached()) servos[p.slot].attach(p.pin[0]); servos[p.slot].write((int)(v + 0.5)); break;
    case K_PWM: v = constrain(v, 0, 100); analogWrite(p.pin[0], (int)(v * 2.55 + 0.5)); break;
    case K_MOTOR: v = constrain(v, -100, 100); if (p.pin[1] != NOPIN) digitalWrite(p.pin[1], v < 0 ? HIGH : LOW); analogWrite(p.pin[0], (int)(fabs(v) * 2.55 + 0.5)); break;
    case K_STEPPER: case K_SYRINGE: v = setStepper(p, v); break;
    case K_HEATER: if (v > HEATER_MAX_C) v = HEATER_MAX_C; if (v <= 0) { v = 0; digitalWrite(p.pin[0], LOW); } break;
    default: return;
  }
  p.val = v;
}
void partOff(Part &p) {
  if (p.kind == K_SERVO) { servos[p.slot].detach(); return; }
  if (p.kind == K_BUTTON) { digitalWrite(p.pin[0], LOW); p.tOff = 0; return; }
  if (p.kind != K_SENSOR && p.kind != K_LIMIT) setPart(p, 0);
}
void clearParts() {
  for (uint8_t i = 0; i < nParts; i++) partOff(parts[i]);
  for (uint8_t i = 0; i < nHeat; i++) { delete heaters[i].sensor; delete heaters[i].wire; }
  nParts = nServo = nStep = nHeat = 0;
}

void cmdCfg(char *key, char *kindStr, char *pinStr, char *a, char *b) {
  if (!key || !kindStr) { fail(F("CFG name ART pins"), NULL); return; }
  Kind k = parseKind(kindStr);
  if (k == K_NONE) { fail(F("unbekannte ART"), key); return; }
  uint8_t pins[3]; parsePins(pinStr, pins);
  Part *old = findPart(key);
  if (old) {
    if (old->kind == k && old->pin[0] == pins[0] && old->pin[1] == pins[1] && old->pin[2] == pins[2]) {
      if (a && k == K_SYRINGE) old->par = atof(a);
      if (b) old->spm = atof(b);
      Serial.print(F("# OK ")); Serial.println(key); return;
    }
    fail(F("anders angemeldet, erst CLEAR senden"), key); return;
  }
  if (nParts >= MAX_PARTS) { fail(F("zu viele Bauteile"), key); return; }
  if (pins[0] == NOPIN) { fail(F("Pin fehlt oder nicht erlaubt (D4-D13, A0-A3)"), key); return; }
  if ((k == K_PWM || k == K_MOTOR) && pins[0] != 5 && pins[0] != 6) { fail(F("PWM nur an D5 oder D6"), key); return; }
  if (k == K_SENSOR && pins[0] < A0) { fail(F("SENSOR braucht A0-A3"), key); return; }
  if ((k == K_STEPPER || k == K_SYRINGE) && pins[1] == NOPIN) { fail(F("step/dir angeben"), key); return; }
  if (k == K_HEATER && pins[1] == NOPIN) { fail(F("ausgang/fuehler angeben"), key); return; }
  if (k == K_SERVO && nServo >= MAX_SERVO) { fail(F("zu viele Servos"), key); return; }
  if ((k == K_STEPPER || k == K_SYRINGE) && nStep >= MAX_STEP) { fail(F("zu viele Schrittmotoren"), key); return; }
  if (k == K_HEATER && nHeat >= MAX_HEAT) { fail(F("zu viele Heizungen"), key); return; }

  Part &p = parts[nParts];
  strncpy(p.key, key, sizeof(p.key) - 1); p.key[sizeof(p.key) - 1] = 0;
  p.kind = k; p.pin[0] = pins[0]; p.pin[1] = pins[1]; p.pin[2] = pins[2];
  p.val = 0; p.tOff = 0; p.slot = 0; p.aux = NAN;
  p.par = a ? atof(a) : 0; p.spm = b ? atof(b) : 0;
  switch (k) {
    case K_SWITCH: case K_BUTTON: case K_PWM: pinMode(pins[0], OUTPUT); digitalWrite(pins[0], LOW); break;
    case K_MOTOR: pinMode(pins[0], OUTPUT); digitalWrite(pins[0], LOW); if (pins[1] != NOPIN) pinMode(pins[1], OUTPUT); break;
    case K_SERVO: p.slot = nServo++; break;
    case K_STEPPER: case K_SYRINGE: {
      p.slot = nStep++;
      pinMode(pins[0], OUTPUT); digitalWrite(pins[0], LOW); pinMode(pins[1], OUTPUT);
      if (pins[2] != NOPIN) { pinMode(pins[2], OUTPUT); digitalWrite(pins[2], HIGH); }
      Stepper &s = steppers[p.slot];
      noInterrupts(); s.port = portOutputRegister(digitalPinToPort(pins[0])); s.mask = digitalPinToBitMask(pins[0]); s.rate = 0; s.acc = 0; s.count = 0; s.high = false; s.seen = 0; interrupts();
      if (k == K_SYRINGE) { if (p.par <= 0) p.par = 60; p.aux = p.par; }      // Füllstand unbekannt: als voll angenommen, mit VOL berichtigen
      break;
    }
    case K_HEATER:
      p.slot = nHeat++;
      pinMode(pins[0], OUTPUT); digitalWrite(pins[0], LOW);
      heaters[p.slot].wire = new OneWire(pins[1]); heaters[p.slot].sensor = new DallasTemperature(heaters[p.slot].wire);
      heaters[p.slot].sensor->begin(); heaters[p.slot].sensor->setWaitForConversion(false); heaters[p.slot].sensor->requestTemperatures();
      break;
    case K_SENSOR: pinMode(pins[0], INPUT); break;
    case K_LIMIT: pinMode(pins[0], INPUT_PULLUP); break;
    default: break;
  }
  nParts++;
  Serial.print(F("# OK ")); Serial.println(key);
}

void stopAll() {
  for (uint8_t i = 0; i < nParts; i++) {
    Kind k = parts[i].kind;
    if (k == K_STEPPER || k == K_SYRINGE || k == K_MOTOR || k == K_HEATER) setPart(parts[i], 0);
  }
}
void handleLine(char *s) {
  char *c = strtok(s, " \t"); if (!c) return;
  char *a1 = strtok(NULL, " \t"), *a2 = strtok(NULL, " \t"), *a3 = strtok(NULL, " \t"), *a4 = strtok(NULL, " \t"), *a5 = strtok(NULL, " \t");
  if (!strcasecmp_P(c, PSTR("SET"))) {
    Part *p = a1 ? findPart(a1) : NULL;
    if (!p) { fail(F("unbekanntes Bauteil"), a1); return; }
    setPart(*p, a2 ? atof(a2) : 0);
  } else if (!strcasecmp_P(c, PSTR("CFG"))) cmdCfg(a1, a2, a3, a4, a5);
  else if (!strcasecmp_P(c, PSTR("CLEAR"))) { clearParts(); Serial.println(F("# OK CLEAR")); }
  else if (!strcasecmp_P(c, PSTR("VOL"))) { Part *p = a1 ? findPart(a1) : NULL; if (p && p->kind == K_SYRINGE && a2) p->aux = constrain(atof(a2), 0, p->par); else fail(F("VOL name ml"), a1); }
  else if (!strcasecmp_P(c, PSTR("LED"))) { ledOn = a1 && atoi(a1) != 0; digitalWrite(PIN_LED, ledOn ? HIGH : LOW); sumI = sumR = 0; nAvg = 0; }
  else if (!strcasecmp_P(c, PSTR("ZERO")) || !strcmp_P(c, PSTR("n"))) zeroReq = true;
  else if (!strcasecmp_P(c, PSTR("DARK")) || !strcmp_P(c, PSTR("d"))) darkReq = true;
  else if (!strcasecmp_P(c, PSTR("RATE"))) { float hz = a1 ? atof(a1) : 1; hz = constrain(hz, 0.2, 10); dataMs = (unsigned long)(1000.0 / hz); }
  else if (!strcasecmp_P(c, PSTR("STOP"))) stopAll();
  else if (!strcasecmp_P(c, PSTR("FLOW")) || !strcasecmp_P(c, PSTR("PCTB")) || !strcasecmp_P(c, PSTR("VALVE"))) { Serial.print(F("# ")); Serial.print(c); Serial.println(F(" hat an diesem Aufbau noch keine Wirkung")); }
  else fail(F("unbekannter Befehl"), c);
}
void readSerial() {
  while (Serial.available()) {
    char ch = Serial.read();
    if (ch == '\n' || ch == '\r') { if (lineLen) { line[lineLen] = 0; handleLine(line); lineLen = 0; } }
    else if (lineLen < sizeof(line) - 1) line[lineLen++] = ch;
  }
}

void sendData(unsigned long now) {
  bool haveA = false; float absorbance = 0;
  if (hasAds && nAvg) {
    float i = sumI / nAvg, r = sumR / nAvg;
    if (darkReq) { darkI = i; darkR = r; darkReq = false; Serial.println(F("# OK Dunkelwert")); }
    float den = r - darkR, ratio = den > 0.001 ? (i - darkI) / den : 0;
    if (zeroReq && ratio > 0) { ratio0 = ratio; zeroReq = false; }
    if (ledOn && ratio > 0 && ratio0 > 0) { absorbance = -log10(ratio / ratio0); haveA = true; }
  }
  sumI = sumR = 0; nAvg = 0;
  Serial.print(F("D,")); Serial.print(now / 1000.0, 3); Serial.print(',');
  if (haveA) Serial.print(absorbance, 6);
  Serial.print(F(",,,"));
  if (!isnan(tempC)) Serial.print(tempC, 2);
  Serial.println(F(",,,"));
}
void slowTasks() {
  float t = detTemp.getTempCByIndex(0); tempC = (t > -100 && t < 125) ? t : NAN; detTemp.requestTemperatures();
  for (uint8_t i = 0; i < nParts; i++) {
    Part &p = parts[i];
    if (p.kind == K_HEATER) {
      DallasTemperature *ds = heaters[p.slot].sensor;
      float th = ds->getTempCByIndex(0); ds->requestTemperatures();
      bool ok = th > -100 && th < 125; p.aux = ok ? th : NAN;
      if (!ok || th > HEATER_MAX_C + 5) { digitalWrite(p.pin[0], LOW); if (p.val > 0) { p.val = 0; fail(F("Heizung aus: Fuehler oder Uebertemperatur"), p.key); } }
      else if (p.val > 0) { if (th < p.val - HEATER_HYST_C) digitalWrite(p.pin[0], HIGH); else if (th > p.val) digitalWrite(p.pin[0], LOW); }
      else digitalWrite(p.pin[0], LOW);
      if (ok) { Serial.print(F("V,")); Serial.print(p.key); Serial.print(','); Serial.println(th, 2); }
    } else if (p.kind == K_SYRINGE) { Serial.print(F("V,")); Serial.print(p.key); Serial.print(','); Serial.println(p.aux, 2); }
    else if (p.kind == K_SENSOR) { Serial.print(F("V,")); Serial.print(p.key); Serial.print(','); Serial.println(analogRead(p.pin[0]) * (5.0 / 1023.0), 4); }
    else if (p.kind == K_LIMIT) { Serial.print(F("V,")); Serial.print(p.key); Serial.print(','); Serial.println(digitalRead(p.pin[0]) == LOW ? 1 : 0); }
  }
}
void updateVolumes() {
  for (uint8_t i = 0; i < nParts; i++) {
    Part &p = parts[i];
    if (p.kind != K_SYRINGE || p.spm <= 0) continue;
    Stepper &s = steppers[p.slot];
    noInterrupts(); long c = s.count; interrupts();
    long d = c - s.seen; s.seen = c;
    if (d) p.aux += (p.val > 0 ? -1.0 : 1.0) * d / p.spm;
    if ((p.val > 0 && p.aux <= 0) || (p.val < 0 && p.aux >= p.par)) { p.aux = constrain(p.aux, 0, p.par); setPart(p, 0); }
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_LED, OUTPUT); digitalWrite(PIN_LED, LOW);
  Wire.begin();
  hasAds = ads.begin();
  if (hasAds) { ads.setGain(GAIN_ONE); ads.setDataRate(RATE_ADS1115_250SPS); }
  detTemp.begin(); detTemp.setWaitForConversion(false); detTemp.requestTemperatures();
  noInterrupts(); TCCR2A = _BV(WGM21); TCCR2B = _BV(CS21); OCR2A = 199; TIMSK2 = _BV(OCIE2A); interrupts();   // 16 MHz / 8 / 200 = 10 kHz
  Serial.print(F("READY ChromaLog-Uno ")); Serial.println(F(FW_VERSION));
  if (!hasAds) Serial.println(F("# ADS1115 nicht gefunden: keine Extinktion"));
}
void loop() {
  readSerial();
  unsigned long now = millis();
  for (uint8_t i = 0; i < nParts; i++) if (parts[i].kind == K_BUTTON && parts[i].tOff && (long)(now - parts[i].tOff) >= 0) { digitalWrite(parts[i].pin[0], LOW); parts[i].tOff = 0; }
  if (hasAds) { sumI += ads.computeVolts(ads.readADC_SingleEnded(0)); sumR += ads.computeVolts(ads.readADC_SingleEnded(1)); nAvg++; }
  if (now - tVol >= 100) { tVol = now; updateVolumes(); }
  if (now - tData >= dataMs) { tData = now; sendData(now); }
  if (now - tSlow >= 1000) { tSlow = now; slowTasks(); }
}
