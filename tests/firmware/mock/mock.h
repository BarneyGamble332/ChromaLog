// Nachbildung der Arduino-Umgebung, damit die Logik des Sketches am PC geprüft werden kann.
// Geprüft wird nur die Logik (Befehle, Grenzen, Abschaltungen), nicht die Elektrik und nicht das Zeitverhalten der Hardware.
#pragma once
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <cstdlib>
#include <math.h>
#include <strings.h>
#include <string>
typedef uint8_t byte;
typedef const char __FlashStringHelper;
#define PROGMEM
#define F(x) x
#define PSTR(x) x
#define pgm_read_ptr(p) (*(p))
#define strcasecmp_P strcasecmp
#define strcmp_P strcmp
#define HIGH 1
#define LOW 0
#define OUTPUT 1
#define INPUT 0
#define INPUT_PULLUP 2
#define A0 14
#define constrain(x, a, b) ((x) < (a) ? (a) : ((x) > (b) ? (b) : (x)))
#define _BV(b) (1 << (b))
#define WGM21 1
#define CS21 1
#define OCIE2A 1
#define ISR(v) void v()
#define TIMER2_COMPA_vect timer2_isr
#define digitalPinToPort(p) (p)
#define portOutputRegister(p) (&g_port[p])
#define digitalPinToBitMask(p) 1
#define GAIN_ONE 1
#define RATE_ADS1115_250SPS 1
inline unsigned long g_ms = 0;
inline int g_pin[20] = {0}, g_mode[20] = {0}, g_pwm[20] = {0}, g_ain[20] = {0};
inline uint8_t g_port[20] = {0}, TCCR2A, TCCR2B, OCR2A, TIMSK2;
inline float g_temp[20];
inline bool g_hasAds = false;
inline float g_adsV[4] = {0, 0, 0, 0};
inline unsigned long millis() { return g_ms; }
inline void pinMode(uint8_t p, int m) { g_mode[p] = m; if (m == INPUT_PULLUP) g_pin[p] = HIGH; }
inline void digitalWrite(uint8_t p, int v) { g_pin[p] = v; }
inline int digitalRead(uint8_t p) { return g_pin[p]; }
inline void analogWrite(uint8_t p, int v) { g_pwm[p] = v; }
inline int analogRead(uint8_t p) { return g_ain[p]; }
inline void noInterrupts() {}
inline void interrupts() {}
struct SerialMock {
  std::string out, in;
  void begin(long) {}
  int available() { return (int)in.size(); }
  char read() { char c = in[0]; in.erase(0, 1); return c; }
  void print(const char *s) { out += s; }
  void print(char c) { out += c; }
  void print(int v) { out += std::to_string(v); }
  void print(double v, int d = 2) { char b[40]; snprintf(b, sizeof b, "%.*f", d, v); out += b; }
  void println() { out += "\n"; }
  void println(const char *s) { out += s; out += "\n"; }
  void println(int v) { print(v); out += "\n"; }
  void println(double v, int d = 2) { print(v, d); out += "\n"; }
};
inline SerialMock Serial;
struct WireMock { void begin() {} };
inline WireMock Wire;
struct Servo { int pin = -1, angle = -1; bool attached() { return pin >= 0; } void attach(int p) { pin = p; } void detach() { pin = -1; } void write(int a) { angle = a; } };
struct OneWire { uint8_t pin; OneWire(uint8_t p) : pin(p) {} };
struct DallasTemperature { OneWire *w; DallasTemperature(OneWire *x) : w(x) {} void begin() {} void setWaitForConversion(bool) {} void requestTemperatures() {} float getTempCByIndex(int) { return g_temp[w->pin]; } };
struct Adafruit_ADS1115 { bool begin() { return g_hasAds; } void setGain(int) {} void setDataRate(int) {} int readADC_SingleEnded(int ch) { return ch; } float computeVolts(int ch) { return g_adsV[ch]; } };
