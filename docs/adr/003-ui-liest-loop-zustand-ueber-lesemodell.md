# ADR-003: Die UI liest den Loop-Zustand über das Lesemodell der Backstube

- **Status:** akzeptiert
- **Datum:** 2026-11-28
- **Gilt für:** `ui.md` §2.3, §2.4.1 Punkt 6, §2.18; `backstube.md` §2.14
- **Bezug:** `ui.md` §3.11; `backstube.md` §2.6.5, §2.9.1

## Kontext

Der Tab Loop soll den Zustand der Backstube live zeigen (`ui.md` §2.18). Dieser Zustand liegt
zum Teil im Backlog (Properties der Issues), zum größeren Teil aber in der host-lokalen
SQLite-Datenbank von `backe loop` (`backstube.md` §2.9.1). `backe ui` und `backe loop run` sind
getrennte Prozesse, und der Loop läuft nicht immer.

## Entscheidung

`backe ui` öffnet `state.db` mit einer eigenen lesenden Verbindung und liest sie ausschließlich
über das Lesemodell aus `src/loop/` (`backstube.md` §2.14), dasselbe, das `backe loop status`,
`queue` und `log` mit `--format json` ausgeben. Änderungen erkennt der Server an
`PRAGMA data_version`, angestoßen durch Datei-Ereignisse im Loop-Verzeichnis und das
Sicherheitsnetz. Schreiben darf die UI nur den Pause-Zustand, über die Tools `loop_pause` und
`loop_resume`, die dieselbe Funktion wie das CLI rufen.

## Alternativen

- **Endpunkt im Loop-Prozess, den die UI abfragt** — ein zweiter Server mit Port und Protokoll,
  und ohne laufenden Loop bliebe der Tab leer.
- **Journal und Laufzustand im Backlog spiegeln** — jeder Tick wäre ein signierter Commit.
- **SQL direkt in `src/ui/`** — die Bedeutung des Schemas stünde an zwei Stellen.

## Folgen

Ein Schemawechsel von `state.db` betrifft nur `src/loop/`. Der Tab zeigt den letzten Stand auch
ohne laufenden Loop. WAL erlaubt den Leser neben dem schreibenden Loop; der Pause-Zustand ist
der einzige Write von außen und greift auch, wenn `backe loop run` nicht läuft.
