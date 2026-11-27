# Changelog

## [0.5.0](https://github.com/spearwolf/backe/compare/v0.4.0...v0.5.0) (2026-11-27)


### Neu

* Abhängigkeiten als Baum für Tastatur und Screenreader ([eb66106](https://github.com/spearwolf/backe/commit/eb6610699eb8bf15f1b354b9b7f5440ba4eaa85a))
* Abhängigkeitsgraph mit xyflow, Knoten öffnen den Issue-Tab ([ee16bc1](https://github.com/spearwolf/backe/commit/ee16bc1558613eb5024db9aef8b0559e194cf030))
* Abschnitt Abhängigkeiten im Tab Issue als eigener Chunk ([2d531ea](https://github.com/spearwolf/backe/commit/2d531ea35f0165873fe2c38d58d64c36593bbc23))
* Anhänge im Issue-Tab mit Vorschau, Tab Issue lesend fertig ([fcf8311](https://github.com/spearwolf/backe/commit/fcf8311d5061753fdb442b2d3aed8a30cb13db34))
* Anhänge per PUT hochladen in backe ui ([5c25c40](https://github.com/spearwolf/backe/commit/5c25c40fdcc8095d48596d79465386c48876a583))
* Anhangsliste der UI mit Größe und nicht geladenen LFS-Anhängen ([269ea10](https://github.com/spearwolf/backe/commit/269ea104fa322fed477ddccae60236f3b9ed7be8))
* App-Shell von backe ui mit Kopfzeile, Tabs und Theme ([e08b8ee](https://github.com/spearwolf/backe/commit/e08b8eedf07db8bf7e310ecf56656f54363e8feb))
* Ausstehend-Überlagerung im Store und Writes mit Rückfall auf /state ([0f9e73d](https://github.com/spearwolf/backe/commit/0f9e73d83d62ccb1ed26697a7b4a58d3c722e5e1))
* backe ui beobachtet Hub und Arbeitskopien der Nachbarn ([e0dedc0](https://github.com/spearwolf/backe/commit/e0dedc02da5564e6416c17991c880bdaea0b809c))
* backe ui liefert dist/ui mit SPA-Fallback und Platzhalter aus ([e7a8b70](https://github.com/spearwolf/backe/commit/e7a8b7096e8c8857bac49b44ace885099cdb3812))
* backe ui nennt das ID-Präfix je Backlog und erlaubt einen Dev-Origin ([b79c6f1](https://github.com/spearwolf/backe/commit/b79c6f138c46f97760a4ef7bd9a49c6ee0fa4baf))
* Befehl backe ui startet den lokalen Server ([41fa354](https://github.com/spearwolf/backe/commit/41fa354772d73975001d20382905059236dab1f6))
* Beschreibung, Kommentare, Anhänge und Aktionen im Issue-Tab schreiben ([b0205a0](https://github.com/spearwolf/backe/commit/b0205a008b7037b9dc4216bf6d5282bbefe65297))
* Beschreibungen von Projekten, Sprints und Repos im Zustand der UI ([299060e](https://github.com/spearwolf/backe/commit/299060e2f5741be35042444189253ace80ec4481))
* Board-Modell mit Bahnen, Spalten und Karten ([ce5f10f](https://github.com/spearwolf/backe/commit/ce5f10f70115f8886667111dba24c4a157fb9af5))
* Board-Züge als Plan, gemeinsame Warteschlange mit dem Umsortieren ([1947098](https://github.com/spearwolf/backe/commit/19470983089ea22e11485817c9b463687386de43))
* Browser-Benachrichtigungen für zugewiesene, fremd geänderte Issues und Konflikte ([3a14b11](https://github.com/spearwolf/backe/commit/3a14b11ea6d49be7899cd91c90b90b985e014bf9))
* Delta zwischen zwei Snapshots für backe ui ([7594c5c](https://github.com/spearwolf/backe/commit/7594c5c2f6843daa64165d60214f780df38e3980))
* Detailmodell des Issue-Tabs, Beziehungen live aus dem Store ([f104410](https://github.com/spearwolf/backe/commit/f104410a3e3b3edff5f3f0956f41048b393f2fac))
* Ein Push eines Nachbarn startet den Sync von backe ui ([1c2b397](https://github.com/spearwolf/backe/commit/1c2b3970e2f0201fbd4cfe0513bdb2572f6dcf7b))
* Event-Stream von backe ui mit Puffer, Wiederaufnahme und Heartbeat ([7c525b2](https://github.com/spearwolf/backe/commit/7c525b2814cdb5684dba5ac3cfbcd60dd053910c))
* Felder im Issue-Tab bearbeiten, lokaler Repo-Pfad über repo_locate ([2b35ba8](https://github.com/spearwolf/backe/commit/2b35ba84cf7cfc2645ab26e2eb26436d376a10d4))
* Filtermodell des Tabs Backlog mit URL-Form und Selektor ([37e31b5](https://github.com/spearwolf/backe/commit/37e31b52174aa2ec2f9061d234b4421fef87d595))
* Fortschritt und Body-Treffer im reinen Listenkern, Suche der UI ohne Kontextfilter ([4d9db74](https://github.com/spearwolf/backe/commit/4d9db74b3f38b8ebd556627a12b71cab6efb48d0))
* Frontend von backe ui im Paket, Smoke-Test startet die UI ([e6db120](https://github.com/spearwolf/backe/commit/e6db12002dd40c85fab7862ae5aaff26079d7004))
* GET /state liefert den Gesamtzustand eines Backlogs ([5fb2fe9](https://github.com/spearwolf/backe/commit/5fb2fe970783e513a3a59b5398b237ce859392d3))
* Highlighting mit Sprachen auf Abruf und Mermaid als eigene Chunks ([c7bb567](https://github.com/spearwolf/backe/commit/c7bb567253164db9f2a1cb716d841e6a2e533afe))
* Issue anlegen per Dialog und Tastenkürzel c ([28742fa](https://github.com/spearwolf/backe/commit/28742fa6b98b8001a7892fcfbdcc90db310f0273))
* Issue-Tab mit Feldern, Beziehungen und Zeitleiste ([9e63323](https://github.com/spearwolf/backe/commit/9e633236dbfc8489699db7ebfea7f861b723f194))
* Issue, Anhänge und Suche über die lesende API von backe ui ([4d993b5](https://github.com/spearwolf/backe/commit/4d993b5a004f1b367ebc7d6e2a501df0bd5a51da))
* Karten per Drag und Tastatur verschieben, Rücksprung und force im Board ([63ef7e6](https://github.com/spearwolf/backe/commit/63ef7e60a3a3e319a3d7ea7820d53c7951edfb96))
* Kartenmenü im Board für State, Bahn und Rang ([e3c75b8](https://github.com/spearwolf/backe/commit/e3c75b8c932f726b14475e32a49d9189d19c41e2))
* Kontext je Backlog und GET /api/backlogs in backe ui ([2e32220](https://github.com/spearwolf/backe/commit/2e32220e45f226390fc804d2bc629728120a6459))
* Kontextmenü und Umsortieren per Drag und Tastatur im Tab Backlog ([0284707](https://github.com/spearwolf/backe/commit/028470798f8a1214e559fcd397179bf5d8d48c66))
* Layout des Abhängigkeitsgraphen mit dagre ([b0ba023](https://github.com/spearwolf/backe/commit/b0ba023844ab25dd61a3b644677acb316bdcf4df))
* Listenmodell des Tabs Backlog mit Ansicht im localStorage und Beschreibungstreffern ([95c8b95](https://github.com/spearwolf/backe/commit/95c8b9516e9cc49548d793d893e97d5d24ddd90b))
* Live-Hervorhebung und Ausblenden im Listenmodell ([750f1ba](https://github.com/spearwolf/backe/commit/750f1baa82af5077cf84d5caec28e456317c4ebd))
* LiveBacklog schreibt den Snapshot per Delta fort ([d388d4a](https://github.com/spearwolf/backe/commit/d388d4a94335a990769c830f457b2ac15f8d8062))
* Markdown-Editor mit Vorschau und Bild-Upload ([588f92c](https://github.com/spearwolf/backe/commit/588f92c4c87d23b8e5232967f5041c7a8e229f77))
* Markdown-Komponente mit Bereinigung, Issue-Links und Anhangspfaden ([b608880](https://github.com/spearwolf/backe/commit/b6088807ada03ad038f957f8f536a6ba56eaeafc))
* Nachbarschaft und Baum der Abhängigkeiten aus dem Store ([9eecd95](https://github.com/spearwolf/backe/commit/9eecd9565ae17c132edd9f69f5aa71255df583e2))
* Nur-lesen blendet Schreibaktionen aus, Writes im Frontend fertig ([ca617e2](https://github.com/spearwolf/backe/commit/ca617e2d4b3083801869a1c05afb25bed038481f))
* Nur-lesen im Board, Tab Board fertig ([e75c0d7](https://github.com/spearwolf/backe/commit/e75c0d73fea24256ebfef7b531deab80140a6173))
* Optimistische Werte und erlaubte State-Wechsel aus dem Code von BK ([437aab8](https://github.com/spearwolf/backe/commit/437aab82c9553a0c4d1b2093e95a4c64c00dd870))
* Patches von backe ui nennen, wer ein Issue geändert hat ([7a1f6b4](https://github.com/spearwolf/backe/commit/7a1f6b42c67f0c06950d38d676db96e473eaab90))
* Projekte und Sprints in den Settings verwalten ([419be46](https://github.com/spearwolf/backe/commit/419be46ffa1935ff548db2bc312c37ae1b82bc65))
* Regeln für Benachrichtigungen aus Patches und Sync-Status ([8bd5c84](https://github.com/spearwolf/backe/commit/8bd5c84aa9e9f87add4c6e2aeddc387aea7b6c26))
* Repositories in den Settings anlegen, prüfen und entfernen ([ea617b5](https://github.com/spearwolf/backe/commit/ea617b56f5e40f665fbadf249f76f3471d479b5d))
* Routing und Tab-Modell im Frontend von backe ui ([069379d](https://github.com/spearwolf/backe/commit/069379d4f12fbd4bb2b41c33e5556cd0c7b3cec2))
* Schalter für Browser-Benachrichtigungen in den Settings ([33d4d53](https://github.com/spearwolf/backe/commit/33d4d530c6e5335a2b735c681180ea0aba9feed3))
* Schnell anlegen per + in Spalte und Bahn des Boards ([70d8744](https://github.com/spearwolf/backe/commit/70d87445aca94a58bba1f1eb46345b33c3a4f871))
* Server-Gerüst von backe ui mit Sitzung und Sicherheits-Headern ([e7f787c](https://github.com/spearwolf/backe/commit/e7f787ca3a4fe2223c32845cf3e21194ce2204e4))
* Settings als eigener Chunk mit den Abschnitten Oberfläche und Backlog ([8cc61c5](https://github.com/spearwolf/backe/commit/8cc61c5672bcadcf4762b33a4b4d95e216b4282e))
* Sitzung je Backlog im Frontend von backe ui ([391a67b](https://github.com/spearwolf/backe/commit/391a67bacba38645ed1ee6595aa133fabe32b25c))
* Sprache, externe Bilder und Default-Gruppierung als Einstellungen der Oberfläche ([a4f5aff](https://github.com/spearwolf/backe/commit/a4f5aff180397bbdba4fc5a991b26aca0cc1ddec))
* Store des Frontends von backe ui mit Signalen je Entität ([2d90e68](https://github.com/spearwolf/backe/commit/2d90e68189bde1e1b5743638812826bcff78ce0a))
* Suche auf dem Store mit Kurzform-IDs und unscharfen Titelwörtern ([a8d0597](https://github.com/spearwolf/backe/commit/a8d05979fd9770ce13d5d17539343785fb12a5e9))
* Suchfeld in der Tab-Leiste mit Cmd-K und Suche in Beschreibungen ([84d7e45](https://github.com/spearwolf/backe/commit/84d7e45a4a23ca15bc848e2a6f4ab51fe505f4ba))
* Tab Backlog mit Filterleiste, Baum und virtualisierter Live-Liste ([b93973c](https://github.com/spearwolf/backe/commit/b93973cfb22bfb71dfbb3efe883dc515a4d20167))
* Tab Board mit Bahnen, Spalten und Karten ([86e422d](https://github.com/spearwolf/backe/commit/86e422dad889e2f552c1c719b95ac25811f7cd0e))
* Tool-Aufrufe und Upload im Client von backe ui ([a98099b](https://github.com/spearwolf/backe/commit/a98099b9f423a60c4a7a017169d16b38c00b5563))
* Tool-Endpunkt von backe ui mit Warteschlange je Backlog ([6ace461](https://github.com/spearwolf/backe/commit/6ace4611dac2ae7d715565b42796ce666cd8fbdd))
* Users und Agents in den Settings, Aktionen nach dem Identitätsschutz ([eddcc59](https://github.com/spearwolf/backe/commit/eddcc597ce4021196f692429a674ba051e5f04eb))
* Verbindung des Frontends von backe ui über Event-Stream und fetch ([42427e2](https://github.com/spearwolf/backe/commit/42427e211e24ab6bbd67aa4064a472cac020cc80))
* Verwaltungs-Tools für backe ui: Links, Kommentare, Anhänge, Projekte, Sprints ([e9d33d9](https://github.com/spearwolf/backe/commit/e9d33d98c93f7455362acefd4efedf2babe41edb))
* Verwaltungs-Tools für backe ui: Repos und Users ([87ac8bb](https://github.com/spearwolf/backe/commit/87ac8bb00426f3d3634b8b7a941b123d7a3fc6d3))
* Watcher für Refs, Arbeitsbaum und Sync-Zustand von backe ui ([e9aed2c](https://github.com/spearwolf/backe/commit/e9aed2ca9eb7218a8182822d41fbd58f8bd84b0c))
* Werkzeugkette für das Frontend von backe ui ([5eec5a6](https://github.com/spearwolf/backe/commit/5eec5a631b7999eca526d788079cae306683055f))
* Write-Kontext, Dialog-Bausteine und Fehleranzeige im Frontend ([de587fc](https://github.com/spearwolf/backe/commit/de587fc88d02639fc939323698745aeab4628e29))


### Behoben

* Abschnitt Abhängigkeiten je Issue, Prüfstände mit stummem Beobachter ([a9c802a](https://github.com/spearwolf/backe/commit/a9c802a7df1691394e67f9f55040ab25d79c9f5d))
* Aktionen eingeklappter Settings-Abschnitte öffnen ihre Dialoge ([d25998d](https://github.com/spearwolf/backe/commit/d25998d99579d567d38c9536096298c6bfece894))
* Anhänge nutzen eine einmal geöffnete Datei und sauber kodierte Dateinamen ([eb9a9e2](https://github.com/spearwolf/backe/commit/eb9a9e2beddfef2e7ba7ae2050acce21b9f84d00))
* Anhänge zeigen kein BMP-Bild und keine hängende Ladeanzeige ([e722f01](https://github.com/spearwolf/backe/commit/e722f01c3e8a7940162209fe265ae13e2a20e6ed))
* Anhangsnamen mit einzelnem Surrogat werfen nicht mehr, Anhangspfade sind über HTTP getestet ([a9cdbb6](https://github.com/spearwolf/backe/commit/a9cdbb65a80c585a81b0e685cd24fff92df5545c))
* Anlegen-Dialog sperrt bei ungültigen Properties, Bilder robuster ([b9fa312](https://github.com/spearwolf/backe/commit/b9fa312b0b6c48477be9bc3ca6bbe417b6b0ef49))
* Ausblenden übersteht die Suchantwort, Patch-Salven verschieben die Beschreibungssuche nicht ([b174a21](https://github.com/spearwolf/backe/commit/b174a2194f7f743e4ccae6d4a4a46bb58e00d648))
* Auswahl ohne Sofort-Write, Fokus nach Writes, Force-Ablauf geschärft ([b3abf49](https://github.com/spearwolf/backe/commit/b3abf492be0c84d1a7d414327c8e783f7cb00b83))
* backe ui beantwortet kaputte Anfragen mit Sicherheits-Headern und prüft den Host robuster ([e21e38e](https://github.com/spearwolf/backe/commit/e21e38e89294545dde0c5862a989bf7fa40a1ffa))
* backe ui beendet sich auch, wenn ein Client einen Download nicht weiterliest ([7f04156](https://github.com/spearwolf/backe/commit/7f04156e57064dc1a61d0840138a94ac5646f0a6))
* backe ui lehnt Anfragen nach dem Beginn des Endes ab ([95f1aed](https://github.com/spearwolf/backe/commit/95f1aedea00e2d0a78f3ecf4f72004c58c44741a))
* backe ui liefert ein eigenes Favicon statt eines 404 ([33f588a](https://github.com/spearwolf/backe/commit/33f588a4552f5c831f063e97e7072d4e4afc0d75))
* backe ui liest den Sync-Zustand beim Start wieder nach HEAD ([ddb9f06](https://github.com/spearwolf/backe/commit/ddb9f06aff838983fddda7a5cbd9b3e13666b28d))
* backe ui nimmt -p als Kurzform von --port ([8502bf8](https://github.com/spearwolf/backe/commit/8502bf8fdf467cca65a676d1fa3a0813a474d095))
* backe ui nimmt Signale schon vor der Startzeile an ([8fc4d02](https://github.com/spearwolf/backe/commit/8fc4d02aaadb5828dd9b1c59b995611e9ce2d969))
* backe ui nutzt für laufende Antworten kein _httpMessage mehr, close maskiert keinen Fehler, deniedJson und browserCommand sind enger gefasst ([3f9586c](https://github.com/spearwolf/backe/commit/3f9586c4c49d27e80d03d1443bea349d686cb853))
* backe ui schließt auch nach einem Fehler beim Aufräumen vollständig ([337eb90](https://github.com/spearwolf/backe/commit/337eb9043c0c1364fb5498aada8d21738bccabd2))
* backe ui schließt den Server auch nach einem Fehler und nennt auf win32 keinen Befehl ([92d20ec](https://github.com/spearwolf/backe/commit/92d20ec1b825983a00b1300cf8e47f071aeb5c2b))
* backe ui zeigt Ladefehler, Tab-Leiste nach dem Tabs-Muster ([e10a0ef](https://github.com/spearwolf/backe/commit/e10a0ef00af597c0f785c3fd0295d965e6d7cc3b))
* Bahnkopf bleibt beim Scrollen stehen, Board-Meldungen ohne Zeile ([01a7100](https://github.com/spearwolf/backe/commit/01a7100af0b20497c874899e8cdc05ad461bab76))
* Baum mit benannten Listen, Hinweis auf offene Voraussetzungen und geteiltem MissingRef ([aa2b6e8](https://github.com/spearwolf/backe/commit/aa2b6e88f8b20ad31e83a3c1390b1b18e4657496))
* Baum reicht die Richtung als Prop durch statt sie aus dem Schlüssel zu lesen ([dcb804b](https://github.com/spearwolf/backe/commit/dcb804be65dcc5c457a0a06b61f8d499b7411713))
* Bearbeiteter Kommentar ohne Flackern bis zum Neuladen ([1cb51df](https://github.com/spearwolf/backe/commit/1cb51dffad28ef7be197956cbb577a4a3eb52e22))
* Benachrichtigungen: Sammelmeldung zeigt alle States, Schalter behält den Fokus ([f5048a1](https://github.com/spearwolf/backe/commit/f5048a1c4880075fe3c825ca1b6ea6ade8fc2cf7))
* Benachrichtigungsregeln: bekannte Konflikte wachsen nur, mehr Tests ([1ca9a0c](https://github.com/spearwolf/backe/commit/1ca9a0ccd8d1172527f4d13b438fb53b85f2f96e))
* Benachrichtigungsschalter: Erlaubnis nachlesen, Doppelklick sperren ([0841b52](https://github.com/spearwolf/backe/commit/0841b52a1bd055f3ce2ec8953da1347fbad4f0c8))
* Bestätigungsdialoge geben den Fokus an den Auslöser zurück ([79bc6dc](https://github.com/spearwolf/backe/commit/79bc6dcbc923ab7e42034a8b5b5f782130a7828d))
* Board ohne Remount an der Schwelle, ein Zug zur Zeit, große Zellen nachgeschärft ([e53763b](https://github.com/spearwolf/backe/commit/e53763b3a2b275fcece9b3c324fb5dbf6ed541f4))
* Board-Anzahlen für Hilfsmittel, Bahnen über die ganze Breite ([08c69af](https://github.com/spearwolf/backe/commit/08c69afe7145eb807293769d5ae21a3ad5d6a68b))
* Board-Zug behält seine Vorschau ohne Snapshot, Lücken in den Tests ([948bf33](https://github.com/spearwolf/backe/commit/948bf33dc2cf2d988d325070b66e7a12d477c170))
* Board: Fokus-Folgen vor der Zelle, Quelle nie dauerhaft gesperrt ([a438ba1](https://github.com/spearwolf/backe/commit/a438ba1eaa4d1de5a767dc75e152c3a30a3f8447))
* Config-Hinweis aus Katalogteilen, Link ohne Ziel ohne &lt;a&gt; ([92b6c45](https://github.com/spearwolf/backe/commit/92b6c456650e0b0b9456509cbe006cea508124b4))
* die Backlog-Liste von backe ui verschluckt nur noch BackeError ([7490449](https://github.com/spearwolf/backe/commit/7490449acd5196cfa81fbfc21bfa0586249470bb))
* Editor reiht Uploads ein, Cursor und Unmount abgesichert ([5e20bb0](https://github.com/spearwolf/backe/commit/5e20bb0f7e345a0eaf38b4aa6102387b29e4aabd))
* Editor-Warteschlange nach Unmount, Fehlerreste und Zeilentrennung ([1653323](https://github.com/spearwolf/backe/commit/1653323264afcb7fc7d655414976e9c8ddee30e2))
* Editoren ohne Schreibrecht weg, Uploads je Tab in einer Reihe, Body ohne Flackern ([b67522c](https://github.com/spearwolf/backe/commit/b67522cb62ddf4415c76843417dd80ceae91af03))
* ein geänderter Issue-Body landet im Event-Stream als touched ([514d04d](https://github.com/spearwolf/backe/commit/514d04d34577e7bf4004da891fe8a34b373d63ec))
* Ein nicht ladbarer Chunk zeigt eine Fehlerzeile statt einer leeren App ([870a3aa](https://github.com/spearwolf/backe/commit/870a3aa081084792e1036ca9e0ff48637132f093))
* Ein Patch rendert nur die Graphknoten neu, deren Issue sich änderte ([46fb3a1](https://github.com/spearwolf/backe/commit/46fb3a175b28f80147f107adef3d95aa9b8c372c))
* ein untergeschobenes gleichnamiges Cookie sperrt die Sitzung nicht aus ([a9b595b](https://github.com/spearwolf/backe/commit/a9b595bd26fce8375895ef63b241e7af104705b5))
* Ereignis auf dem beobachteten Verzeichnis selbst zählt als unbekannte Änderung ([5517a6c](https://github.com/spearwolf/backe/commit/5517a6c3ea80208eaa637dc9eab819fabb18ba15))
* Fehlender Parent ohne Knoten, eindeutige Schlüssel im Baum ([11f384c](https://github.com/spearwolf/backe/commit/11f384c07f8c65553d10062115e7df2a481adfcf))
* Fehlerform, Namensfreigabe und Dialogmeldungen nachgezogen ([082e80d](https://github.com/spearwolf/backe/commit/082e80d0db2bc4ac786584fa563870dadb409718))
* Fehlerkasten geteilt, Re-Entrancy-Schutz und Region für Schreibfehler ([e8afe9e](https://github.com/spearwolf/backe/commit/e8afe9e80549c054549d766f6a0d96daf4027d49))
* Filterleiste — URL-Werte ohne Option abwählbar, State in CLI-Schreibweise, Feldfehler als Beschreibung, Live-Region von Anfang an ([f5ee4e9](https://github.com/spearwolf/backe/commit/f5ee4e9513d842867f37d9dca0bb9b0f76219bfd))
* Filtermodell wie issue list — ungültige Handles, all allein, Text ungetrimmt, Kommas nur bei state ([30046dd](https://github.com/spearwolf/backe/commit/30046dde2c326097edec42898b3fa2008f33bd46))
* Fokus bleibt beim Zug in eine verborgene Zelle auf dem Board ([3273179](https://github.com/spearwolf/backe/commit/327317984a13b469be6744bbcdac09157cb93e75))
* Fokus kehrt nach »Neues Issue« dorthin zurück, wo er war ([734df1c](https://github.com/spearwolf/backe/commit/734df1cfbdb88693baacde70690d60f1defdc102))
* Fokus nach »Trotzdem abschließen«, Klick nach dem Ziehen, Portale im Board ([b9d413a](https://github.com/spearwolf/backe/commit/b9d413a963686b2fe0f499b203866dade08781a6))
* Fokus, Kontextmenü-Taste und Testdateien im Tab Backlog ([da5d00f](https://github.com/spearwolf/backe/commit/da5d00f949b7b0a58b374d2850b449e1368e937e))
* Fokusring an Menüeinträgen, Tab-Leiste ignoriert Modifikatoren, hello während einer Probe lädt nach ([ce67e8d](https://github.com/spearwolf/backe/commit/ce67e8d761e6542effed264974c20047758b3e16))
* geschrumpfte Anhänge brechen die Antwort ab, statt den Client hängen zu lassen ([49ba3ee](https://github.com/spearwolf/backe/commit/49ba3ee2277448b4b6dfa51f104e47f2a13a36b9))
* Gesperrtes Bild in einem Link ohne Ziel behält seinen Link ([b968a2e](https://github.com/spearwolf/backe/commit/b968a2e134fa4fc7b87e96f413017d76e578cc61))
* Graph mit deutschen Beschriftungen, stabilen Kanten und Kontrast ([e449949](https://github.com/spearwolf/backe/commit/e44994937c287035b6f50a6983263e92f510ffbc))
* Graph-Tests führen Animationsframes selbst aus ([c1dcd88](https://github.com/spearwolf/backe/commit/c1dcd88fa2b17daafeecbd1e6daff98fe6005b33))
* hello lädt nach gescheitertem Neuladen der Sitzung erneut ([7f4fe3a](https://github.com/spearwolf/backe/commit/7f4fe3abc070030e76127b8d7b83af0b2f20fe44))
* Hüllenprüfung des Clients sieht nackte Node-Module, ROADMAP.md aktuell ([f467d59](https://github.com/spearwolf/backe/commit/f467d594311c85897ce2e0fee817c0e4ee64d3e5))
* Hüllenprüfung des Clients sieht relative und dynamische Importe ([64996ca](https://github.com/spearwolf/backe/commit/64996ca9727b5c22b0c6d0d35ce7703df996035a))
* Issue-Tab zeigt defekte Issues als defekt und parst Markdown nicht bei jedem Patch neu ([ba88444](https://github.com/spearwolf/backe/commit/ba884448ac72003b7cabb0d105e2f4f010b1a515))
* Kartenmenü mit backlogweitem Rang, ohne falsches »ohne …«, live am Rand ([807d760](https://github.com/spearwolf/backe/commit/807d76083fc91c45771b2aeaf091f982fdc3c1c3))
* Kleinigkeiten in den Settings: Hinweise, Akzentfarbe, Agent-Dialog ([a74e2a2](https://github.com/spearwolf/backe/commit/a74e2a2dbf81936f4800b852cd28412617926b4e))
* Kontextmenü per Tastatur, Fokus und Ziele im Tab Backlog ([9218e84](https://github.com/spearwolf/backe/commit/9218e846c2f0f80947e152357a18bc128b47ad08))
* Kurzform /b/&lt;backlog&gt; behält bei der Weiterleitung ihre Filter ([cae160e](https://github.com/spearwolf/backe/commit/cae160eaad13425fb10f563ed90e95bac648711e))
* Link der xyflow-Attribution mit AA-Kontrast ([b87bc31](https://github.com/spearwolf/backe/commit/b87bc318f8e28470f7d28768cc159896b12156c1))
* Live-Kern findet Kommentare auch hinter Ereignissen ohne Dateinamen ([6a2d096](https://github.com/spearwolf/backe/commit/6a2d096d79b6c7f0dc9f600ef97e863536e98bd3))
* Live-Kern von backe ui drosselt langsame Clients, beobachtet .git nicht und sichert Hand-Edits ab ([6d4a25b](https://github.com/spearwolf/backe/commit/6d4a25b566c490adeafd965693497f3c782a77bb))
* Live-Kern von backe ui nach dem Review ([b008552](https://github.com/spearwolf/backe/commit/b0085528b349315fe11ccec3b39ef544514cb455))
* Löschreichweite gemeinsam genutzt, Tests und Doku der Overlays geschärft ([79b3efc](https://github.com/spearwolf/backe/commit/79b3efc23a61d819de3fae95b41329df496f2609))
* Markdown entfernt srcset und verlinkt Issue-IDs erst nach der Bereinigung ([b2abf75](https://github.com/spearwolf/backe/commit/b2abf7579680472d250f62e1fe02a6b2b83a0804))
* Menü-Wächter nur nach echtem Öffnen, Fokus-Wächter von Radix ([ecad80a](https://github.com/spearwolf/backe/commit/ecad80a59614cfbbf180ab265fd577d45ddad657))
* Nachbar-Watch merkt nur echte Absagen von git, nicht Startfehler ([d4ac06f](https://github.com/spearwolf/backe/commit/d4ac06f2b25a44e9a673d869af3617a4a7470da5))
* Nachbar-Watch: Fehler einer Runde beenden den Server nicht ([cb857a3](https://github.com/spearwolf/backe/commit/cb857a3a874f5f81305693dac4e5d60754fe8f08))
* Nachbar-Watch: Fehlerarten, atomarer Durchlauf, Identität über Inodes ([cbfef57](https://github.com/spearwolf/backe/commit/cbfef57c18ba1aaf9cef2544d30ece16c8c7362c))
* Nachbar-Watch: gescheiterter Start wartet den Sync ab, git-Absagen gemerkt ([0620f2e](https://github.com/spearwolf/backe/commit/0620f2e5d2108c9c43567e6d26a38d52c28bcbb5))
* Nachbar-Watch: Nachlauf ohne Lücke, neu angelegte Nachbarn, Fehler des Aufrufers ([a56c3ad](https://github.com/spearwolf/backe/commit/a56c3adc0c7329b0830f763635aa771f2f3f99d2))
* Nachbar-Watch: neue Nachbarn, fremde Repos, Start ohne Fehler ([bd9c999](https://github.com/spearwolf/backe/commit/bd9c99996cdaa3a39e9e192875a0ca7806016ac5))
* Nachbar-Watch: Vorsprung beim Start zählt, Ende wartet auf den Blick ([f9358be](https://github.com/spearwolf/backe/commit/f9358bef521ad39e86110790bdd86afdc8047a94))
* Nachbarn in backe ui: Burst über viele Runden, Tests an der echten Entprellung ([6985965](https://github.com/spearwolf/backe/commit/6985965afc826c08038d575adb6b47e40f90de70))
* Neu geklonter Nachbar auf wiederverwendeten Inodes gilt als neu ([ca2a456](https://github.com/spearwolf/backe/commit/ca2a456311f7299775f62c2dd494f7d954d8edde))
* Notifier: Titel ohne Zeilenumbrüche, Typ-Guard, Lebenszyklus-Test ([76e00de](https://github.com/spearwolf/backe/commit/76e00de25a291edcd7f5b938d987338eeacfa5b1))
* Oberflächen-Einstellungen: Bildschalter als off, Fokus nur bei Wechsel, keine Links in Links ([65bb490](https://github.com/spearwolf/backe/commit/65bb490d013cf3d359d7245fb3799b4be3106cb4))
* Rank-Warteschlange hängt nicht, wartende Züge planen neu ([833f361](https://github.com/spearwolf/backe/commit/833f361607f491586beba2126b9d52ec8fd94d15))
* Repo-Eintrag ohne Namen bekommt eine eigene Bahn ([ca0ff25](https://github.com/spearwolf/backe/commit/ca0ff25a6e61b93a495779eb0b9e22b7f589c699))
* Repositories-Abschnitt: Verweisliste reaktiv, Rahmen aus der Liste, Live-Region kurz ([d55783a](https://github.com/spearwolf/backe/commit/d55783a178f38789cd174627822ba813a9be0521))
* Runde des Sicherheitsnetzes sieht den Arbeitsbaum nur einmal an ([1e35497](https://github.com/spearwolf/backe/commit/1e354974f5c8f29198ac7cc20f661c2a934dfaec))
* Sammelknoten hängt an der Mitte aus nodes[0], strengere Layout-Tests ([683df8d](https://github.com/spearwolf/backe/commit/683df8d57db4a423f42fc32b883f9fff58d72be9))
* Schnell anlegen gibt den Entwurf an den Dialog ab, Tests schärfer ([6343f1b](https://github.com/spearwolf/backe/commit/6343f1bd19655d088dab03d110d7557778c2800a))
* Settings-Dialoge: Fokus zurück an den Auslöser, Sprint-Ende geprüft ([1272acf](https://github.com/spearwolf/backe/commit/1272acf0b69ec8ed83761161b5256683f25f5c11))
* Settings-Formulare ohne verborgenen Absende-Knopf ([a94f9c0](https://github.com/spearwolf/backe/commit/a94f9c06900d7f6766f1ab1447c0b6cb7b593101))
* Settings-Layout: Kopf so breit wie der Inhalt, Begriffe in einer Flucht ([af8f1e0](https://github.com/spearwolf/backe/commit/af8f1e0c9951cea47d10fc9542f42c43bc3d13ef))
* Settings: Abschnitt je Navigation zeigen, Sync-Ergebnis typgenau, Pull ohne Timer ([1b803dc](https://github.com/spearwolf/backe/commit/1b803dcc3201aa947d537f2415eaf20f5ba9ee8c))
* Sitzungs-Cookie von backe ui je Port benennen ([f840fca](https://github.com/spearwolf/backe/commit/f840fcaaf10c3629746a8971f9e2698e5a8e135a))
* Snapshot des Stores enthält Projekte, load zählt offene Issues als berührt ([2dc70c9](https://github.com/spearwolf/backe/commit/2dc70c93d450ca51d7ac866ec993c33664aa337a))
* Späte Ablehnung nimmt einem neueren Board-Zug den Fokus nicht ([631e3d4](https://github.com/spearwolf/backe/commit/631e3d45c2408f23b87996ac13c78d5fccaeac9c))
* Spec-Wortlaut, stabile Vorschlagslisten, editList aus einem Modul ([a46b8aa](https://github.com/spearwolf/backe/commit/a46b8aaff56e4f6819c278669df8d4b797658033))
* Speichern wartet auf laufende Bild-Uploads ([c675c08](https://github.com/spearwolf/backe/commit/c675c0867a0e2c9d37348a0c8e813ed46c49ea4b))
* Startansicht des Graphen lesbar, Sammelknoten unter der Mitte ([4ab749b](https://github.com/spearwolf/backe/commit/4ab749bdf0bd5e1b5cf05e37a164afdd7933d9b7))
* statische Auslieferung hängt nicht mehr bei vorzeitig getrenntem Client ([e9a8cd5](https://github.com/spearwolf/backe/commit/e9a8cd5387a2fef312f081ae6602402422527af6))
* statische Auslieferung nimmt den Typ vom angefragten Namen und übersteht ein verschwundenes Ziel ([eb1d4fe](https://github.com/spearwolf/backe/commit/eb1d4fe1ee68e75ec93cdf3dc22aba52885f6a4b))
* statische Dateien und Anhänge teilen eine abgesicherte Dateiauslieferung ([2c13411](https://github.com/spearwolf/backe/commit/2c13411422ac73d9242cba68779ab7a3b5251cfd))
* Strich für leere Listen, Dateien neben Drop-Flächen bleiben folgenlos ([a343318](https://github.com/spearwolf/backe/commit/a3433183783f9b04cd3720f045913df1a27fd8ee))
* Suchfeld: Pfeiltasten ohne Auswahl, Bildlauf, Live-Region und frische Treffer ([9ee4716](https://github.com/spearwolf/backe/commit/9ee4716b32dd72662d94d19d937e245c4ae9b288))
* Suchindex nur, solange die Suche offen ist ([76fbe01](https://github.com/spearwolf/backe/commit/76fbe01b4f76e1169b764439cadfea5074c95e33))
* Suchtreffer eines Repos zeigen die URL, Gruppe »User« ([1a98cd9](https://github.com/spearwolf/backe/commit/1a98cd9565a01f0babbb45ddcb9581b626265848))
* Tab Backlog behält seine Filter beim Rücksprung, Projektbaum nach Pfadsegmenten ([5b302c1](https://github.com/spearwolf/backe/commit/5b302c16231aec0640e3da8fb34dcb3476b2d0f8))
* Tab-Leiste: schmales Suchfeld auf kleinen Schirmen, benannte Navigation ([ae7b3e4](https://github.com/spearwolf/backe/commit/ae7b3e4ca76cd109d15a448db68138ceab039e36))
* Tastaturfokus holt Graphknoten außerhalb der Fläche in Sicht ([42a381f](https://github.com/spearwolf/backe/commit/42a381f90ae21a6b827882b15cb8c4eeeb6730a0))
* Test prüft die Lage des Sammelknotens genau ([c913dd9](https://github.com/spearwolf/backe/commit/c913dd9083c60e4301289dd1b09429619c741cf0))
* Texte der Mitte und gehoverter Links halten AA-Kontrast ([12888e8](https://github.com/spearwolf/backe/commit/12888e86b2c0be77fb46efaa276b0fd9bb8a85d6))
* Umsortieren an Ankern ohne rank per Batch ([74d8fa5](https://github.com/spearwolf/backe/commit/74d8fa5d49d444e22e14253f2b711604f401ed71))
* Umsortieren im Baum nur unter Geschwistern, Fokus folgt der Zeile ([91a6fd3](https://github.com/spearwolf/backe/commit/91a6fd3376b315f3436a4aadc516d50526ea62cb))
* Umsortierungen einer Sitzung gehen nacheinander hinaus ([30e2b84](https://github.com/spearwolf/backe/commit/30e2b84481c38f214a3df7c80a42ef9443471412))
* user_add speichert die Key-Zeile getrimmt ([7ff7f7b](https://github.com/spearwolf/backe/commit/7ff7f7b5b4cb79ed05ddd1a7dba4627d73d544fc))
* Users & Agents: Admin-Marke nur für Menschen, Art folgt den Rechten ([f0c7083](https://github.com/spearwolf/backe/commit/f0c7083879c9fa206ffb1ae6da072ece25250d31))
* Wachsender Sammelknoten rendert keine Issue-Knoten neu ([1f2392a](https://github.com/spearwolf/backe/commit/1f2392a08bd233c0448f2f0aff1d439c589c0a56))
* Writes und Sitzung robust nach dispose, Wertvergleich ohne Key-Reihenfolge ([db700a8](https://github.com/spearwolf/backe/commit/db700a8b3a0fa68f0ba6ae176d1c0d5b2749e3c9))
* Zahl im Sammelknoten setzt Layout und Ansicht nicht mehr zurück ([8e79f8e](https://github.com/spearwolf/backe/commit/8e79f8e9f201b12b42fe32b4fa7857641b1eb87f))
* Zeilen rendern beim Einfügen und Ausblenden nicht neu, eindeutige Keys für Projekt- und Sprint-Chips ([1bc0d5e](https://github.com/spearwolf/backe/commit/1bc0d5eb442d3a5592660104cc6ee2c8a4c0df4f))


### Schneller

* Board rendert bei Patch und Ziehen nur, was sich ändert ([6b4ba1e](https://github.com/spearwolf/backe/commit/6b4ba1e06c0ecb195e99c032db76371898c329a3))
* Board-Drag im selben Frame auch mit einigen tausend Karten ([a90774b](https://github.com/spearwolf/backe/commit/a90774baeb46bb910aca7564abfd961a35f03bbb))

## [0.4.0](https://github.com/spearwolf/backe/compare/v0.3.0...v0.4.0) (2026-11-25)


### Neu

* **cli:** Guide in der Hilfe von project und repo ([b85d269](https://github.com/spearwolf/backe/commit/b85d269d948fb5dc57497b67572b13fe6019299b))

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
