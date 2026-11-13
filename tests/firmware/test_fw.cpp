// Logiktest des Uno-Sketches am PC. Start: tests/firmware/run.sh
#include "mock.h"
#include "../../firmware/chromalog_uno/chromalog_uno.ino"
static int fails = 0, checks = 0;
#define CHECK(c, msg) do { checks++; if (!(c)) { fails++; printf("FEHLER  %s  (Zeile %d)\n", msg, __LINE__); } } while (0)
static void send(const char *c) { Serial.in += c; Serial.in += "\n"; readSerial(); }
static void run(unsigned long ms) { for (unsigned long i = 0; i < ms; i++) { g_ms++; for (int k = 0; k < 10; k++) timer2_isr(); loop(); } }
static bool said(const char *s) { return Serial.out.find(s) != std::string::npos; }
static void quiet() { Serial.out.clear(); }
static Part &P(const char *k) { return *findPart(k); }
static bool nearf(double a, double b, double tol) { return fabs(a - b) <= tol; }

int main() {
  for (int i = 0; i < 20; i++) g_temp[i] = -127;
  g_hasAds = true; g_adsV[0] = 2.0f; g_adsV[1] = 2.5f; g_temp[2] = 22.5f;
  setup();
  CHECK(said("READY ChromaLog-Uno"), "F-01 meldet READY nach dem Start");

  // Anmelden und Pin-Regeln
  quiet(); send("CFG servo3 SERVO 11"); send("SET servo3 90");
  CHECK(said("# OK servo3") && servos[P("servo3").slot].pin == 11 && servos[P("servo3").slot].angle == 90, "F-02 Servo wird angemeldet und gestellt");
  send("SET servo3 250"); CHECK(servos[P("servo3").slot].angle == 180, "F-02 Servo-Winkel wird auf 180 begrenzt");
  quiet(); send("CFG heiz PWM 9"); CHECK(said("FEHLER") && !findPart("heiz"), "F-03 PWM an D9 wird abgelehnt");
  quiet(); send("CFG x SWITCH 3"); CHECK(said("FEHLER") && !findPart("x"), "F-03 fester Pin D3 wird abgelehnt");
  quiet(); send("CFG x SWITCH 1"); CHECK(said("FEHLER"), "F-03 USB-Pin D1 wird abgelehnt");
  send("CFG luefter PWM 5"); send("SET luefter 50"); CHECK(g_pwm[5] == 127 || g_pwm[5] == 128, "F-04 PWM 50 % ergibt halbe Aussteuerung (127 oder 128 von 255)");
  send("CFG mot MOTOR 6/12"); send("SET mot -40"); CHECK(g_pwm[6] == 102 && g_pin[12] == HIGH, "F-04 Motor rückwärts: Richtung HIGH, 40 %");
  send("CFG rel SWITCH 13"); send("SET rel 1"); CHECK(g_pin[13] == HIGH, "F-04 Schalter an");
  quiet(); send("SET gibtsnicht 1"); CHECK(said("FEHLER"), "F-05 unbekanntes Bauteil wird gemeldet");
  quiet(); send("QUATSCH"); CHECK(said("FEHLER"), "F-05 unbekannter Befehl wird gemeldet");
  send("CLEAR"); CHECK(nParts == 0 && g_pwm[5] == 0 && g_pwm[6] == 0 && g_pin[13] == LOW && servos[0].pin == -1, "F-06 CLEAR schaltet alles aus");

  // Spritzenpumpe: 1000 Schritte je ml, 6 ml/min = 100 Schritte je Sekunde
  send("CFG pa SYRINGE 4/7/8 60 1000"); send("VOL pa 10"); send("SET pa 6");
  CHECK(g_pin[7] == LOW && g_pin[8] == LOW, "F-10 Fördern: Richtung LOW, Treiber freigegeben");
  run(10000);
  CHECK(nearf(steppers[P("pa").slot].count, 1000, 2), "F-10 10 s mit 6 ml/min ergeben 1000 Schritte");
  CHECK(nearf(P("pa").aux, 9.0, 0.01), "F-10 Füllstand sinkt von 10 auf 9 ml");
  quiet(); run(1100); CHECK(said("V,pa,"), "F-10 Füllstand wird gemeldet");
  send("SET pa 0"); CHECK(steppers[P("pa").slot].rate == 0 && g_pin[8] == HIGH, "F-10 Stopp sperrt den Treiber");
  send("VOL pa 0.05"); send("SET pa 6"); run(1000);
  CHECK(P("pa").val == 0 && P("pa").aux == 0 && steppers[P("pa").slot].rate == 0, "F-11 leere Spritze hält an");
  send("SET pa 6"); CHECK(P("pa").val == 0, "F-11 leere Spritze lässt sich nicht weiter fördern");
  send("VOL pa 59.9"); send("SET pa -60"); CHECK(g_pin[7] == HIGH, "F-11 Füllen: Richtung HIGH"); run(500);
  CHECK(P("pa").val == 0 && nearf(P("pa").aux, 60, 0.001), "F-11 volle Spritze hält an");
  send("SET pa 999999"); CHECK(steppers[P("pa").slot].rate == 5000000UL, "F-12 Schrittrate wird auf 5000 je Sekunde begrenzt"); send("SET pa 0");

  // Endschalter: stoppt nur die eingestellte Richtung
  send("VOL pa 30"); send("CFG ende LIMIT 12 pa 1"); send("SET pa 6"); run(100);
  CHECK(P("pa").val == 6, "F-20 ohne Endschalter läuft die Pumpe");
  quiet(); g_pin[12] = LOW; run(2);
  CHECK(P("pa").val == 0 && P("pa").aux == 0 && said("E,LIMIT,ende"), "F-20 Endschalter hält an, setzt Füllstand 0 und meldet sich");
  send("SET pa -6"); run(50); CHECK(P("pa").val == -6, "F-20 Gegenrichtung bleibt bei gedrücktem Endschalter erlaubt");
  send("SET pa 0"); g_pin[12] = HIGH;
  quiet(); send("CFG e2 LIMIT 10 fehlt 1"); CHECK(said("FEHLER") && !findPart("e2"), "F-21 Endschalter mit unbekanntem Ziel wird abgelehnt");

  // Heizung: Regelung, Begrenzung, Fühlerfehler
  send("CFG h HEATER 5/9"); g_temp[9] = 25; send("SET h 40"); run(1100);
  CHECK(g_pin[5] == HIGH, "F-30 Heizung an unter dem Sollwert");
  g_temp[9] = 40.2f; run(1100); CHECK(g_pin[5] == LOW, "F-30 Heizung aus über dem Sollwert");
  g_temp[9] = 39.8f; run(1100); CHECK(g_pin[5] == LOW, "F-30 innerhalb des Schaltabstands bleibt sie aus");
  g_temp[9] = 39.6f; run(1100); CHECK(g_pin[5] == HIGH, "F-30 unter Sollwert minus Schaltabstand wieder an");
  send("SET h 90"); CHECK(P("h").val == 70, "F-31 Sollwert wird auf 70 °C begrenzt");
  quiet(); g_temp[9] = -127; run(1100); CHECK(g_pin[5] == LOW && P("h").val == 0 && said("FEHLER"), "F-32 Fühlerfehler schaltet die Heizung ab");
  g_temp[9] = 30; send("SET h 40"); run(1100); quiet(); g_temp[9] = 76; run(1100);
  CHECK(g_pin[5] == LOW && P("h").val == 0, "F-32 Übertemperatur schaltet die Heizung ab");

  // Lecksensor stoppt alles, auch die Heizung
  g_temp[9] = 30; send("SET h 40"); send("SET pa -6"); send("CFG leck LIMIT 13 ALL"); run(1100);
  quiet(); g_pin[13] = LOW; run(1100);
  CHECK(P("pa").val == 0 && P("h").val == 0 && g_pin[5] == LOW && said("E,STOP,leck"), "F-40 Lecksensor stoppt Pumpen und Heizung");
  size_t first = Serial.out.find("E,STOP,leck"); CHECK(Serial.out.find("E,STOP,leck", first + 1) == std::string::npos, "F-40 Lecksensor meldet nur einmal");
  g_pin[13] = HIGH;

  // Verbindungsüberwachung: Pumpen halten an, Heizung regelt weiter
  send("SET h 40"); send("SET pa -6"); send("WATCHDOG 2"); run(1500); CHECK(P("pa").val == -6, "F-50 innerhalb der Frist läuft die Pumpe");
  send("PING"); run(1500); CHECK(P("pa").val == -6, "F-50 Lebenszeichen verlängert die Frist");
  quiet(); run(2200); CHECK(P("pa").val == 0 && said("Pumpen angehalten"), "F-50 ohne Lebenszeichen halten die Pumpen an");
  CHECK(P("h").val == 40 && g_pin[5] == HIGH, "F-50 Heizung regelt ohne Verbindung weiter");
  send("WATCHDOG 0"); send("SET pa -6"); run(5000); CHECK(P("pa").val == -6, "F-50 Überwachung lässt sich abschalten");
  send("STOP"); CHECK(P("pa").val == 0 && P("h").val == 0, "F-51 STOP hält Pumpen an und schaltet Heizungen aus");

  // Detektor: Extinktion und Datenzeile
  send("RATE 1"); send("LED 1"); CHECK(g_pin[3] == HIGH, "F-60 LED an");
  run(1100); send("ZERO"); run(1100); quiet(); run(1100);
  { size_t a = Serial.out.find("D,"), b = Serial.out.find("\n", a); std::string l = Serial.out.substr(a, b - a);
    int commas = 0; for (char c : l) commas += c == ',';
    CHECK(commas == 8, "F-60 Datenzeile hat 9 Felder");
    double t, uv; CHECK(sscanf(l.c_str(), "D,%lf,%lf", &t, &uv) == 2 && fabs(uv) < 1e-5, "F-60 nach Autozero ist die Extinktion 0");
    CHECK(l.find(",22.50,") != std::string::npos, "F-60 Temperatur steht in der Datenzeile"); }
  g_adsV[0] = 1.0f; quiet(); run(2200);
  { size_t a = Serial.out.rfind("D,"); double t, uv = -1; sscanf(Serial.out.c_str() + a, "D,%lf,%lf", &t, &uv);
    CHECK(nearf(uv, 0.30103, 0.0001), "F-61 halbes Licht ergibt Extinktion 0,301"); }
  send("LED 0"); quiet(); run(1100);
  { size_t a = Serial.out.rfind("D,"); CHECK(Serial.out.compare(a, 2, "D,") == 0 && Serial.out.find(",,,", a) < Serial.out.find("\n", a) && Serial.out[Serial.out.find(",", a + 2) + 1] == ',', "F-62 bei ausgeschalteter LED bleibt das Extinktionsfeld leer"); }

  // Grenze der Bauteil-Anzahl
  send("CLEAR"); char buf[40]; for (int i = 0; i < 8; i++) { snprintf(buf, sizeof buf, "CFG s%d SWITCH %d", i, 4 + i); send(buf); }
  quiet(); send("CFG s9 SWITCH 13"); CHECK(nParts == 8 && said("FEHLER"), "F-70 mehr als 8 Bauteile werden abgelehnt");

  printf("%d Prüfungen, %d Fehler\n", checks, fails);
  return fails ? 1 : 0;
}
