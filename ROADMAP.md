# Roadmap

Navigation durch das Offene. Jeder Eintrag verweist auf den Abschnitt eines Proposals, der ihn
spezifiziert; die Roadmap selbst ist kein Spec. Nummern hier sind nicht stabil und stehen nirgends
sonst.

> Offen: Reihenfolge, Termine und Prioritäten zwischen den Strängen legt der User fest.

## Geplant

### Backstube (BS)

Spec im Entwurf, offene Entscheidungen in BS §4.1; Umsetzung nach BS §6.

## Offene Entscheidungen

| Frage                                            | Proposal      | Stand                             |
| ------------------------------------------------ | ------------- | --------------------------------- |
| Remote Control aus einem Skript starten          | BS §4.1       | wird in F1 geprüft                |
| Benachrichtigung ab Stufe 2                      | BS §4.1       | Vorschlag (a) Relay-Session       |
| Sandboxing der Agents                            | BS §4.1       | Vorschlag lokal, Container später |
| Vertrauen und MCP-Freigabe in frischen Worktrees | BS §4.1       | wird in F1 geprüft                |
| Kontext aus zusätzlichen Verzeichnissen          | BS §4.1       | zu prüfen                         |
| Vorgabe für `gates.paths`                        | BS §4.1       | Vorschlag leer, Beispiel in Doku  |
| Beobachtbarkeit: CLI oder UI                     | BS §4.1       | Vorschlag CLI in F1               |
| Modell je Phase                                  | BS §4.1       | nach Messung in F1                |
| `.backe/backlog.jsonc` aus der UI bearbeiten     | UI §4.1, §4.2 | erst mit einer Operation in BK    |
| Fehlertexte in der UI-Sprache                    | UI §4.1       | erst mit Messages je Aufruf       |

## Später — mit Bedingung

| Vorhaben                                                    | Wenn                                                                            | Proposal      |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------- |
| Custom Git-Merge-Driver für Issue-Dateien                   | mehr als ein Replay-Konflikt pro 100 Sync-Runden im Realbetrieb                 | BK §4.2       |
| Volltext-Index                                              | `issue list -q` über 1 s bei 10⁴ Issues                                         | BK §4.2       |
| Graph-Patch und Statusabfrage beschleunigen                 | messbar langsam bei 10⁴ Issues                                                  | BK §4.2       |
| `issue.link` zeichnet den Repo-Namen auf                    | Replay-Konflikte im Realbetrieb zeigen die Abweichung                           | BK §4.2       |
| Serverseitiges Paging und Filtern in der UI                 | Ziel für `GET /state` aus UI §2.17 gerissen                                     | UI §3.4, §4.3 |
| `SharedWorker` für eine Event-Verbindung aller Browser-Tabs | Grenze von sechs Verbindungen je Origin stört im Betrieb                        | UI §3.1, §4.3 |
| Frontend als eigenes Paket `@spearwolf/backe-ui`            | `dist/ui/` vergrößert den Tarball um mehr als 3 MiB (Pack-Smoke-Test bricht ab) | UI §3.9       |
| Lease in `backe`                                            | ein zweiter Host im Betrieb                                                     | BS §4.2       |
| Batch-Merges in der Merge-Queue                             | Issues warten im Mittel länger in der Queue, als ihr Verify dauert              | BS §4.2       |

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
- Weitere Harnesses über ACP, Kosten je Issue (BS §4.2)
- CI als Verify, Container je Worktree, `watch`-Liste ins Backlog (BS §4.2)
