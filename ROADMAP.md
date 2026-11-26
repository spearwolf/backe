# Roadmap

Navigation durch das Offene. Jeder Eintrag verweist auf den Abschnitt eines Proposals, der ihn
spezifiziert; die Roadmap selbst ist kein Spec. Nummern hier sind nicht stabil und stehen nirgends
sonst.

> Offen: Reihenfolge, Termine und Prioritäten zwischen den Strängen legt der User fest.

## In Arbeit

### `backe ui` (UI)

Umsetzung nach UI §6, Status im Kopf von `docs/proposals/ui.md`.

- [x] Vorlauf in BK: reine Modul-Hülle, Tool-Katalog `src/tools/` (UI §2.2, §3.3, §4.2)
- [x] Server-Gerüst (UI §6 Schritt 1)
- [x] Live-Kern (UI §6 Schritt 2)
- [x] Server-Writes (UI §2.3.2, §6 Schritt 6)
- [x] Frontend-Gerüst (UI §6 Schritt 3)
- [x] Tab Backlog (UI §6 Schritt 4)
- [x] Tab Issue lesend (UI §6 Schritt 5)
- [x] Writes im Frontend (UI §6 Schritt 6)
- [ ] Tab Board (UI §6 Schritt 7)
- [ ] Abhängigkeitsgraph (UI §6 Schritt 8)
- [ ] Settings und Suche (UI §6 Schritt 9)
- [ ] Nachbarn und Benachrichtigungen (UI §6 Schritt 10)
- [ ] Paket, CI, Performance (UI §6 Schritt 11; BK §2.17 nach UI §4.2)

## Geplant

### Backstube (BS)

Spec im Entwurf, offene Entscheidungen in BS §4.1; Umsetzung nach BS §6.

## Offene Entscheidungen

| Frage                                            | Proposal      | Stand                                                      |
| ------------------------------------------------ | ------------- | ---------------------------------------------------------- |
| Remote Control aus einem Skript starten          | BS §4.1       | wird in F1 geprüft                                         |
| Benachrichtigung ab Stufe 2                      | BS §4.1       | Vorschlag (a) Relay-Session                                |
| Vertrauen und MCP-Freigabe in frischen Worktrees | BS §4.1       | wird in F1 geprüft                                         |
| Kontext aus `--add-dir`                          | BS §4.1       | zu prüfen                                                  |
| Modell je Phase                                  | BS §4.1       | nach Messung in F1                                         |
| Ort des Codes der Backstube                      | BS §4.1       | Vorschlag eigenes Repo                                     |
| Frontend im Hauptpaket oder eigenes Paket        | UI §4.1       | Hauptpaket bis +3 MB Tarball; gemessen in UI §6 Schritt 11 |
| `.backe/backlog.jsonc` aus der UI bearbeiten     | UI §4.1, §4.2 | erst mit einer Operation in BK                             |
| Fehlertexte in der UI-Sprache                    | UI §4.1       | erst mit Messages je Aufruf                                |

## Später — mit Bedingung

| Vorhaben                                                    | Wenn                                                               | Proposal      |
| ----------------------------------------------------------- | ------------------------------------------------------------------ | ------------- |
| Custom Git-Merge-Driver für Issue-Dateien                   | mehr als ein Replay-Konflikt pro 100 Sync-Runden im Realbetrieb    | BK §4.2       |
| Volltext-Index                                              | `issue list -q` über 1 s bei 10⁴ Issues                            | BK §4.2       |
| Graph-Patch und Statusabfrage beschleunigen                 | messbar langsam bei 10⁴ Issues                                     | BK §4.2       |
| `issue.link` zeichnet den Repo-Namen auf                    | Replay-Konflikte im Realbetrieb zeigen die Abweichung              | BK §4.2       |
| Serverseitiges Paging und Filtern in der UI                 | Ziel für `GET /state` aus UI §2.17 gerissen                        | UI §3.4, §4.3 |
| `SharedWorker` für eine Event-Verbindung aller Browser-Tabs | Grenze von sechs Verbindungen je Origin stört im Betrieb           | UI §3.1, §4.3 |
| Lease in `backe`                                            | ein zweiter Host im Betrieb                                        | BS §4.2       |
| Batch-Merges in der Merge-Queue                             | Issues warten im Mittel länger in der Queue, als ihr Verify dauert | BS §4.2       |

## Später — ohne Bedingung

- Windows-Support (BK §4.2)
- Orphan-Branch-Modus (BK §4.2)
- Watcher/Daemon mit Benachrichtigungen, TUI (BK §4.2)
- Brücke zu GitHub Issues (BK §4.2)
- Weitere MCP-Tools für die CLI-only-Befehle (BK §4.2)
- Standalone-Binaries (BK §4.2)
- Lokalen Hub auf ein später ergänztes Remote umhängen (BK §4.2)
- Zugriff auf die UI von anderen Rechnern mit echter Authentifizierung (UI §4.3)
- Ansicht für die Backstube in der UI (UI §4.3)
- `next` mit `--prop`-Filter (BS §4.2)
- CI als Verify, Kosten je Issue, `watch`-Liste ins Backlog (BS §4.2)
