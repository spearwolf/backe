# ADR-002: Der Zustand der UI liegt in signalize, React stellt nur dar

- **Status:** akzeptiert
- **Datum:** 2026-11-27
- **Bezug:** `ui.md` §2.5, §3.6

## Kontext

Ein Patch betrifft meist ein einzelnes Issue; das Board soll mit einigen tausend Karten beim
Ziehen nicht ruckeln (`ui.md` §0.4).

## Entscheidung

Ein Signal je Entität in `@spearwolf/signalize`, Memos für Abgeleitetes, `useSignal` als Brücke
zu React; die Verbindung ist ein `@spearwolf/eventize`-Emitter. React rendert nur.

## Alternativen

- **Gesamtzustand in React-State oder Context** — jeder Patch rechnet die ganze Ansicht durch.

## Folgen

Es rendert genau neu, was sich geändert hat: die eine Zeile, die eine Karte, der eine Tab.
Stabile Optionsobjekte und Callbacks sind Pflicht, sonst kippt die Memoisierung ganzer Listen.
Ein Board-Drag bei 7 600 Karten bleibt unter einem Frame (`ui.md` §2.17).
