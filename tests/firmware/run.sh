#!/bin/bash
# Übersetzt den Sketch mit einer nachgebildeten Arduino-Umgebung für den PC und prüft seine Logik.
set -e
cd "$(dirname "$0")"
g++ -std=c++17 -O1 -w -I mock -x c++ test_fw.cpp -o /tmp/chromalog_fw_test
/tmp/chromalog_fw_test
