# Manuelle Tests — Viewer-App

Steuerungskommandos werden über das Control Panel (`control-panel.html`) gesendet.
Die App muss dazu laufen und `VITE_CONTROL_ENABLED=true` gesetzt sein.

---

## Start & Konfiguration

| ID | Testfall | Voraussetzungen | Testschritte | Erwartetes Ergebnis |
|---|---|---|---|---|
| VA-01 | App startet und lädt Konfiguration | `.env`-Datei korrekt gesetzt, Server erreichbar | 1. App starten<br>2. Startvorgang beobachten | App startet im Vollbild, erstes konfiguriertes Modul wird angezeigt; ohne Konfiguration erscheint nur das Logo |
| VA-02 | Konfigurationsänderung wird übernommen | App läuft, Appsetting in Content-App ändern | 1. Appsetting in Content-App anpassen<br>2. Bis zu 20 Sekunden warten | Viewer-App zeigt aktualisierte Konfiguration |

---

## Modulrotation

| ID | Testfall | Voraussetzungen | Testschritte | Erwartetes Ergebnis |
|---|---|---|---|---|
| VA-03 | Nach dem letzten Modul beginnt die Rotation von vorne | Mehrere Module konfiguriert | 1. Alle Module abwarten<br>2. Weiter beobachten | Rotation beginnt von vorne |
| VA-04 | Kein Modul konfiguriert | Leere Konfiguration | 1. App starten oder Konfiguration leeren | Idle-Screen wird angezeigt |

---

## Steuerungskommandos

| ID | Testfall | Voraussetzungen | Testschritte | Erwartetes Ergebnis |
|---|---|---|---|---|
| VA-05 | Pause | App läuft | 1. Control Panel: «Pause 1 min»<br>2. App beobachten | Aktuelle Anzeige endet geordnet, Idle-Screen erscheint für 1 Minute, danach Rotation fortgesetzt |
| VA-06 | Modul laden unterbricht Rotation | App läuft, Rotation aktiv | 1. Control Panel: beliebiges Modul laden<br>2. App beobachten | Aktuelles Modul bricht sofort ab, gewähltes Modul erscheint, danach Rotation fortgesetzt |
| VA-07 | Steuerungskommando während Pause | App pausiert | 1. Pause starten<br>2. Modul laden<br>3. App beobachten | Modul wird angezeigt, danach Rotation fortgesetzt |

---

## Chat-Modul

> Voraussetzung: Chatnachrichten (Text, Bild, Audio) in der Content-App vorhanden.

| ID | Testfall | Voraussetzungen | Testschritte | Erwartetes Ergebnis |
|---|---|---|---|---|
| VA-08 | Chat Light ohne Ton | — | 1. Control Panel: «Light ohne Ton» | Nachrichten erscheinen im hellen Design, keine Sprachausgabe |
| VA-09 | Chat Dark ohne Ton | — | 1. Control Panel: «Dark ohne Ton» | Nachrichten erscheinen im dunklen Design, keine Sprachausgabe |
| VA-10 | Chat mit weiblicher Stimme | — | 1. Control Panel: «Female» | Nachrichten werden mit weiblicher Stimme vorgelesen |
| VA-11 | Chat mit männlicher Stimme | — | 1. Control Panel: «Male» | Nachrichten werden mit männlicher Stimme vorgelesen |
| VA-12 | Textnachricht | Chat läuft, Textnachricht vorhanden | 1. Textnachricht im Chat beobachten | Text und Absendername werden angezeigt |
| VA-13 | Bildnachricht | Chat läuft, Bildnachricht vorhanden | 1. Bildnachricht im Chat beobachten | Bild und Absendername werden angezeigt |
| VA-14 | Sprachnachricht | Chat läuft, Sprachnachricht vorhanden | 1. Sprachnachricht im Chat beobachten | Sprachnachricht wird automatisch abgespielt |
| VA-15 | Nachrichten werden der Reihe nach angezeigt | Mehrere Nachrichten vorhanden | 1. Chat-Rotation beobachten | Nachrichten erscheinen einzeln nacheinander |
| VA-16 | Schriftgrösse gross | — | 1. Control Panel: «Schrift Gross» | Text erscheint in grosser Schrift |
| VA-17 | Schriftgrösse klein | — | 1. Control Panel: «Schrift Klein» | Text erscheint in kleiner Schrift |

---

## Zeit-Modul

| ID | Testfall | Voraussetzungen | Testschritte | Erwartetes Ergebnis |
|---|---|---|---|---|
| VA-18 | Digitale Uhr | — | 1. Control Panel: «24h» | Uhrzeit im 24h-Format wird angezeigt, Datum sichtbar |
| VA-19 | 12h-Format | — | 1. Control Panel: «12h» | Uhrzeit im 12h-Format mit AM/PM |
| VA-20 | Sekunden anzeigen | — | 1. Control Panel: «Mit Sekunden» | Sekunden werden angezeigt und aktualisieren sich |
| VA-21 | Datum ausblenden | — | 1. Control Panel: «Kein Datum» | Kein Datum sichtbar |
| VA-22 | Uhrzeit aktualisiert sich | Zeit-Modul läuft | 1. Uhrzeit beobachten | Uhrzeit stimmt und aktualisiert sich |

---

## Routine-Modul

> Voraussetzung: Routine-Termine (vergangen, aktiv, zukünftig) in der Content-App vorhanden.

| ID | Testfall | Voraussetzungen | Testschritte | Erwartetes Ergebnis |
|---|---|---|---|---|
| VA-23 | Routine ohne Ton | — | 1. Control Panel: «Ohne Ton» | Termine werden angezeigt, keine Sprachausgabe |
| VA-24 | Routine mit Ton | — | 1. Control Panel: «Mit Ton» | Aktueller und nächster Termin werden vorgelesen |
| VA-25 | Korrekter Wochentag | Routine läuft | 1. Angezeigten Wochentag mit dem aktuellen Datum vergleichen | Wochentag ist korrekt |
| VA-26 | Terminanzeige je Status | Vergangene, aktive und zukünftige Termine vorhanden | 1. Routine beobachten | Vergangene und zukünftige Termine erscheinen verblichen, aktiver Termin wird stärker hervorgehoben |
| VA-27 | Termin mit Icon | Termin mit Icon vorhanden | 1. Routine beobachten | Icon wird korrekt angezeigt |
| VA-28 | Termin ohne Icon | Termin ohne Icon vorhanden | 1. Routine beobachten | Anstelle des Icons wird der Titel angezeigt |

---

## Offline-Betrieb

| ID | Testfall | Voraussetzungen | Testschritte | Erwartetes Ergebnis |
|---|---|---|---|---|
| VA-29 | App läuft ohne Netzwerkverbindung | App läuft, Daten gecacht | 1. Netzwerkverbindung trennen<br>2. App beobachten | App läuft mit gecachten Daten weiter |
| VA-30 | Netzwerkverbindung wird wiederhergestellt | App läuft offline | 1. Netzwerkverbindung wiederherstellen<br>2. Bis zu 20 Sekunden warten | App lädt aktuelle Konfiguration |
