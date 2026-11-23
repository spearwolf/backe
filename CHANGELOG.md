# Changelog

## 0.1.0 (2026-11-23)


### Neu

* **cli:** Node-Version beim Start prüfen, Paketmetadaten für den Release ([7847d27](https://github.com/spearwolf/backe/commit/7847d27db95b4af4f23fda50d839906e95e7529b))


### Behoben

* **git:** Pfadlisten in Blöcken, Timeout beendet die Prozessgruppe, lesende Aufrufe ohne Index-Lock ([a1c5c2a](https://github.com/spearwolf/backe/commit/a1c5c2a256661b5d086ea1a2b0cca19291d1dd51))
* **git:** Zeitüberschreitung beendet den Prozessbaum, Terminal bleibt erhalten ([4f186e8](https://github.com/spearwolf/backe/commit/4f186e8338e1362ae881d1443cd4251ba7ac37ee))
* **mcp:** fields vor dem Read-Sync, Resource über runTool, Fehler beim Schließen auf stderr ([ff49ef4](https://github.com/spearwolf/backe/commit/ff49ef4b8ddc3244d4c640ed2ccc043e2f77a275))
* **services:** Anhang-Lader prüft den Pfad nach dem Öffnen erneut ([e375f9a](https://github.com/spearwolf/backe/commit/e375f9a6d409d065f00ff295bec42301e9609a4f))
* **services:** config edit startet mit dem Entwurf eines gescheiterten Edits ([c309e1b](https://github.com/spearwolf/backe/commit/c309e1b85ad7c7b0c0ceab8416fc1cf43e79fb68))
* **services:** doctor erkennt Zeitüberschreitung und meidet relatives PATH, config ohne rohe Fehler ([58122fe](https://github.com/spearwolf/backe/commit/58122fe19246464a89f94985110dd02a913a9c1b))
* **services:** ein Lader für Anhänge aus CLI und MCP ([6824c64](https://github.com/spearwolf/backe/commit/6824c64bf527c803885a2201106a51b0d2bb4da2))
* **services:** Repo-URLs ohne Schema verlieren .git, Batch-Fehler in Zeilenreihenfolge ([0067c9c](https://github.com/spearwolf/backe/commit/0067c9ca274ebca1cc457d4e692d82dac5834212))
* **sync:** Hintergrund-Sync verbraucht die Warnung im Modus warn nicht ([cefd4d2](https://github.com/spearwolf/backe/commit/cefd4d28c1515d232c0268f8287f5c51c28907fc))
* **sync:** upstream erst nach dem lokalen Abschnitt, Warnungen einmal je Commit, vollständige Taint-Keys ([2052e71](https://github.com/spearwolf/backe/commit/2052e71466837a341b6f68c761c6e207e14ed299))
