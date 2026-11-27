# Architekturentscheidungen

Eine Datei je Entscheidung, `NNN-<titel>.md`, fortlaufend nummeriert. Eine ADR hält fest, was
entschieden wurde, welche Alternativen verworfen wurden und warum. Sie wird nie überschrieben:
Ändert sich eine Entscheidung, entsteht eine neue ADR mit `löst ab: ADR-NNN`, die alte bekommt
den Status `abgelöst durch ADR-NNN`. Nummern werden nie neu vergeben, Dateien nie gelöscht.

Was gilt, steht in den Proposals (`docs/proposals/`); die ADRs tragen die Historie dazu.

| ADR | Titel | Status |
| --- | --- | --- |
| [ADR-001](./001-ui-als-dritter-adapter.md) | Die UI ist ein dritter Adapter über einen gemeinsamen Tool-Katalog | akzeptiert |
| [ADR-002](./002-signalize-store-react-view.md) | Der Zustand der UI liegt in signalize, React stellt nur dar | akzeptiert |
