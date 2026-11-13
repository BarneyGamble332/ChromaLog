#!/usr/bin/env python3
"""Passt das von Capacitor erzeugte Android-Projekt an (wird beim automatischen Bau aufgerufen).

- Berechtigungen für Bluetooth, USB und das Speichern von Dateien
- Paketquelle JitPack (für die USB-Seriell-Bibliothek)
- Versionsnummer aus mobile/package.json, Versionscode aus der Nummer des Bau-Laufs
- feste Signatur, damit sich eine neue APK über die alte installieren lässt

Aufruf: python3 tools/android_patch.py mobile/android
"""
import json, os, re, sys

root = sys.argv[1]
here = os.path.dirname(os.path.abspath(__file__))
version = json.load(open(os.path.join(here, '..', 'mobile', 'package.json')))['version']
code = int(os.environ.get('GITHUB_RUN_NUMBER', '1'))
sha = os.environ.get('GITHUB_SHA', '')[:7]


def edit(path, fn):
    p = os.path.join(root, path)
    s = open(p, encoding='utf-8').read()
    n = fn(s)
    assert n != s, 'keine Änderung in ' + path
    open(p, 'w', encoding='utf-8').write(n)
    print('angepasst:', path)


PERMS = '''
    <!-- ChromaLog: Bluetooth Low Energy, USB-Gerät, Dateien in "Dokumente" -->
    <uses-permission android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30" />
    <uses-permission android:name="android.permission.BLUETOOTH_ADMIN" android:maxSdkVersion="30" />
    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" android:maxSdkVersion="30" />
    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" android:maxSdkVersion="30" />
    <uses-permission android:name="android.permission.BLUETOOTH_SCAN" android:usesPermissionFlags="neverForLocation" />
    <uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />
    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="32" />
    <uses-feature android:name="android.hardware.usb.host" android:required="false" />
    <uses-feature android:name="android.hardware.bluetooth_le" android:required="false" />
</manifest>'''
edit('app/src/main/AndroidManifest.xml', lambda s: s.replace('</manifest>', PERMS.lstrip('\n'), 1) if 'BLUETOOTH_SCAN' not in s else s + ' ')

edit('build.gradle', lambda s: re.sub(r'(allprojects\s*\{\s*repositories\s*\{\s*google\(\)\s*mavenCentral\(\))', r"\1\n        maven { url 'https://jitpack.io' }", s, count=1))


def app_gradle(s):
    s = re.sub(r'versionCode \d+', 'versionCode %d' % code, s, count=1)
    s = re.sub(r'versionName "[^"]*"', 'versionName "%s%s"' % (version, ('-' + sha) if sha else ''), s, count=1)
    sign = '''android {
    signingConfigs {
        debug {
            storeFile file('../../chromalog-debug.p12')
            storePassword 'chromalog'
            keyAlias 'chromalog'
            keyPassword 'chromalog'
            storeType 'pkcs12'
        }
    }'''
    return s.replace('android {', sign, 1)


edit('app/build.gradle', app_gradle)
