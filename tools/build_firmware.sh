#!/bin/bash
# Übersetzt den Uno-Sketch ohne Arduino IDE (nur Prüfung, es wird nichts hochgeladen).
# Aufruf: tools/build_firmware.sh <Ordner mit ArduinoCore-avr und den Bibliotheken>
# Braucht: avr-gcc, avr-libc. Die Bibliotheken liegen als Git-Klone im angegebenen Ordner:
#   ArduinoCore-avr, Servo, OneWire, Arduino-Temperature-Control-Library, Adafruit_ADS1X15, Adafruit_BusIO
set -e
LIBS="${1:?Ordner mit den Bibliotheken angeben}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${2:-/tmp/chromalog_fw}"; rm -rf "$OUT"; mkdir -p "$OUT"
CORE="$LIBS/ArduinoCore-avr"
INC="-I$CORE/cores/arduino -I$CORE/variants/standard -I$CORE/libraries/Wire/src -I$CORE/libraries/SPI/src -I$LIBS/Servo/src -I$LIBS/OneWire -I$LIBS/Arduino-Temperature-Control-Library -I$LIBS/Adafruit_ADS1X15 -I$LIBS/Adafruit_BusIO"
FL="-Os -w -mmcu=atmega328p -DF_CPU=16000000L -DARDUINO=10819 -DARDUINO_AVR_UNO -DARDUINO_ARCH_AVR -ffunction-sections -fdata-sections -flto"
CXX="-std=gnu++11 -fno-exceptions -fno-threadsafe-statics -fpermissive"
n=0; mkdir -p "$OUT/core"
# Der Arduino-Kern wird wie in der IDE als Archiv gebaut: nur benutzte Teile landen im Programm.
for f in "$CORE"/cores/arduino/*.c; do avr-gcc $FL -std=gnu11 $INC -c "$f" -o "$OUT/core/k$((n++)).o"; done
for f in "$CORE"/cores/arduino/*.S; do avr-gcc $FL -x assembler-with-cpp $INC -c "$f" -o "$OUT/core/k$((n++)).o"; done
for f in "$CORE"/cores/arduino/*.cpp; do avr-g++ $FL $CXX $INC -c "$f" -o "$OUT/core/k$((n++)).o"; done
avr-gcc-ar rcs "$OUT/core.a" "$OUT"/core/*.o
for f in "$CORE"/libraries/Wire/src/utility/*.c; do avr-gcc $FL -std=gnu11 $INC -c "$f" -o "$OUT/c$((n++)).o"; done
for f in "$CORE"/libraries/Wire/src/*.cpp "$CORE"/libraries/SPI/src/*.cpp "$LIBS"/Servo/src/avr/*.cpp "$LIBS"/OneWire/*.cpp \
         "$LIBS"/Arduino-Temperature-Control-Library/DallasTemperature.cpp "$LIBS"/Adafruit_ADS1X15/*.cpp "$LIBS"/Adafruit_BusIO/*.cpp; do
  avr-g++ $FL $CXX $INC -c "$f" -o "$OUT/c$((n++)).o"
done
avr-g++ $FL $CXX $INC -Wall -x c++ -include Arduino.h -c "$HERE/firmware/chromalog_uno/chromalog_uno.ino" -o "$OUT/sketch.o"
avr-gcc -Os -mmcu=atmega328p -flto -fuse-linker-plugin -Wl,--gc-sections "$OUT"/sketch.o "$OUT"/c*.o "$OUT/core.a" -lm -o "$OUT/chromalog_uno.elf"
avr-size "$OUT/chromalog_uno.elf"
