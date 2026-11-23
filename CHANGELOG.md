# Changelog

## [0.3.0](https://github.com/spearwolf/backe/compare/v0.2.0...v0.3.0) (2026-11-23)


### Neu

* **i18n:** CLI-Befehle zweisprachig ([46a0202](https://github.com/spearwolf/backe/commit/46a0202153316dccc11e42df4a0220ff3de8850b))
* **i18n:** CLI-Kern und Hilfe-Infrastruktur zweisprachig ([46ff215](https://github.com/spearwolf/backe/commit/46ff215b4fb71c9cb93e1197019bf988ef977f6e))
* **i18n:** context und git zweisprachig ([d53ce4b](https://github.com/spearwolf/backe/commit/d53ce4b468c37cebd73a0c8c8202c2a2269dd91a))
* **i18n:** Locale-Erkennung, Kataloge und zweisprachige Präfixe ([0e42d84](https://github.com/spearwolf/backe/commit/0e42d8412e07166a2b5c0e6477a1ef5e0bc4f1dd))
* **i18n:** ops, core, store zweisprachig ([332cf9b](https://github.com/spearwolf/backe/commit/332cf9be9aacd2e35dca6beda3c410b97932089e))
* **i18n:** services (Sync, Repos, Verwaltung) zweisprachig ([5b87f77](https://github.com/spearwolf/backe/commit/5b87f77d52d6f945db3265b16ae445788bc6bbbb))
* **i18n:** Services der Issue-Domäne zweisprachig ([042445e](https://github.com/spearwolf/backe/commit/042445eb1bb399e11aac8f5821c1d1a08fdad4dc))
* **mcp:** Ausgabe immer englisch ([64224fa](https://github.com/spearwolf/backe/commit/64224fab960bbc9c4098c6759b0eaf6c15665eb0))


### Behoben

* **i18n:** Restliteral, Wächter und Spec nach dem Gesamt-Review ([02017d8](https://github.com/spearwolf/backe/commit/02017d876e9816f973fe162807ff7971cd02395f))

## [0.2.0](https://github.com/spearwolf/backe/compare/v0.1.1...v0.2.0) (2026-11-23)


### Neu

* **cli:** Hilfe bei fehlendem Befehl, Argument oder Pflichtoption ([a675ff3](https://github.com/spearwolf/backe/commit/a675ff3191208ba6323698cdce1e86ccfe6e124a))
* **cli:** project create und sprint create ohne Pflicht-Titel ([b0846e7](https://github.com/spearwolf/backe/commit/b0846e7f66b5733713b18d31790b28634e77a54b))
* **cli:** Schnellstart in backe --help ([fcaca20](https://github.com/spearwolf/backe/commit/fcaca207215840eb580218bbc29ede6b4b941c7c))


### Behoben

* **cli:** Hilfetexte auf 80 Spalten, ohne Backticks, JSDoc an buildProgram ([99ea565](https://github.com/spearwolf/backe/commit/99ea565f871909b90472a6312b2586c8c32e13c1))

## [0.1.1](https://github.com/spearwolf/backe/compare/v0.1.0...v0.1.1) (2026-11-23)


### Behoben

* npm-Paket heißt @spearwolf/backe ([038905c](https://github.com/spearwolf/backe/commit/038905c46480c4964a8650be3a145d8c97b31740))


### Schneller

* weniger Git-Prozesse für Zustandsverzeichnis und HEAD-Status ([246aa67](https://github.com/spearwolf/backe/commit/246aa671b8123c52f28a8f3aa6c1d494bfc17b35))

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
