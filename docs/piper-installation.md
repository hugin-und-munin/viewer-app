# Piper TTS — zentrale Installation

Installiert Piper systemweit unter `C:\Program Files\Piper\piper`, inkl.
deutschem Stimmmodell, und macht den Befehl `piper` in jedem Terminal
verfügbar.

## 1. Piper herunterladen

Offizielle Releases: https://github.com/rhasspy/piper/releases

→ Datei `piper_windows_amd64.zip` herunterladen.

## 2. Zielordner anlegen

PowerShell **als Administrator** öffnen und ausführen:

```powershell
New-Item -ItemType Directory -Force "C:\Program Files\Piper"
```

## 3. ZIP entpacken

Die ZIP-Datei enthält bereits einen Ordner `piper\` mit `piper.exe`, den
DLLs, `espeak-ng-data` usw. **Diesen Ordner als Ganzes** nach
`C:\Program Files\Piper\` entpacken/kopieren, sodass am Ende
`C:\Program Files\Piper\piper\piper.exe` existiert.

> ⚠️ Häufiger Fehler: Wenn der ZIP-Inhalt nicht in einen zusätzlichen
> Unterordner, sondern direkt hineinkopiert wird, landet alles eine Ebene zu
> tief oder zu flach. Zur Kontrolle nach dem Entpacken prüfen:
> ```powershell
> Test-Path "C:\Program Files\Piper\piper\piper.exe"
> ```
> Muss `True` ausgeben.

## 4. Deutsches Stimmmodell herunterladen (männlich)

Voice-Modelle liegen bei Hugging Face:
https://huggingface.co/rhasspy/piper-voices/tree/main/de/de_DE/thorsten/high

Zwei Dateien herunterladen:

- `de_DE-thorsten-high.onnx`
- `de_DE-thorsten-high.onnx.json`

Beide Dateien nach `C:\Program Files\Piper\piper\` legen (gleicher Ordner
wie `piper.exe`).

## 5. Weibliches Stimmmodell herunterladen

Für Deutsch gibt es aktuell keine weibliche Stimme in „high"-Qualität — die
beste verfügbare Option ist **kerstin** in „low"-Qualität:
https://huggingface.co/rhasspy/piper-voices/tree/main/de/de_DE/kerstin/low

Zwei Dateien herunterladen:

- `de_DE-kerstin-low.onnx`
- `de_DE-kerstin-low.onnx.json`

Ebenfalls nach `C:\Program Files\Piper\piper\` legen. Piper wählt die Stimme
pro Aufruf über `--model`, beide Modelle können also nebeneinander im
selben Ordner liegen.

## 6. Zu PATH hinzufügen

1. **Start-Taste** drücken, `Umgebungsvariablen` eintippen, auf
   **„Systemumgebungsvariablen bearbeiten"** klicken. Es öffnet sich das
   Fenster „Systemeigenschaften".
2. Unten im Fenster auf **„Umgebungsvariablen..."** klicken.
3. Es öffnen sich zwei Listen übereinander: oben „Benutzervariablen", unten
   „**Systemvariablen**". Für systemweit die **untere** Liste verwenden.
4. In der unteren Liste die Zeile **„Path"** suchen, anklicken (markieren),
   dann auf **„Bearbeiten..."** klicken.
5. Es öffnet sich eine Liste von Ordnerpfaden. Rechts auf **„Neu"** klicken —
   eine leere Zeile erscheint.
6. In diese Zeile genau eintippen (mit `\piper` am Ende!):
   ```
   C:\Program Files\Piper\piper
   ```
7. **Vor dem Schliessen kontrollieren**: der neue Eintrag muss jetzt als
   eigene Zeile in der Liste sichtbar sein.
8. **Dreimal „OK"** klicken (nicht „Abbrechen"!) — schliesst nacheinander:
   die Path-Liste, das Umgebungsvariablen-Fenster, das
   Systemeigenschaften-Fenster. Erst dadurch wird gespeichert.
9. **Alle** offenen PowerShell-/Terminal-Fenster schliessen — die Änderung
   gilt nur für neu gestartete Fenster.

**Kontrolle, ob es wirklich gespeichert wurde** (neues PowerShell-Fenster):

```powershell
[Environment]::GetEnvironmentVariable("Path", "Machine") -split ';' | Select-String "Piper"
```

Gibt eine Zeile mit `C:\Program Files\Piper\piper` aus, wenn es geklappt hat.
Keine Ausgabe → Schritte 1–8 wiederholen.

## 7. Testen

Neues PowerShell-Fenster öffnen:

```powershell
piper --help
```

Erscheint eine Hilfe-Ausgabe, ist Piper systemweit verfügbar. Sprachtest
männliche Stimme:

```powershell
echo "Hallo, das ist ein Test." | piper --model "C:\Program Files\Piper\piper\de_DE-thorsten-high.onnx" --output_file test-maennlich.wav
```

Sprachtest weibliche Stimme:

```powershell
echo "Hallo, das ist ein Test." | piper --model "C:\Program Files\Piper\piper\de_DE-kerstin-low.onnx" --output_file test-weiblich.wav
```

Beide `.wav`-Dateien im aktuellen Ordner zur Kontrolle abspielen.
