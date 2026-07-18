# Requirements-Taxonomie — Analyse & Umgruppierungs-Vorschlag

_Erstellt 2026-07-17. Betrifft `.shipwright/planning/01-adopted/spec.md` (66 FRs: FR-01.01–FR-01.67, 42 fehlt) sowie Verbesserungen für das Shipwright-Monorepo (Plugins `adopt`, `iterate`, `compliance`)._

_Beschlossen mit Sven 2026-07-17: **(1)** FR-IDs bleiben stabil (`FR-01.NN`), nur Umgruppieren/Umbenennen/Falten. **(2)** Ein webui-Iterate. **(3)** Ein Monorepo-Triage-Item für die Plugin-Fixes._

---

## 0. TL;DR

Die spec.md mischt **drei völlig verschiedene Flughöhen** als gleichrangige FRs:

1. **Fähigkeiten** (richtig): „Task board", „Inbox", „Embedded terminal".
2. **Endpunkte** (zu tief): „Health check (GET)", „Pending tool_use list (GET)", „Fork copy-command (POST)" — das sind HTTP-Routen, keine Requirements.
3. **Änderungs-Deltas** (gar keine Requirements): FR-01.41 poliert FR-01.38/39, FR-01.40 „completes FR-01.37", FR-01.36 „replaces FR-01.33", FR-01.67 „extends FR-01.66".

**Ursache** ist kein Zufall, sondern zwei Werkzeuge mit widersprüchlicher FR-Logik:
- `/shipwright-adopt` prägt **eine FR pro Code-Route** (`FR-01.{NN}` in Crawl-Reihenfolge, `01` hart kodiert).
- `/shipwright-iterate` prägt **eine FR pro Arbeitseinheit**, mit einer vom Agenten *geratenen* Nummer — kein `max+1`, keine Gruppierung, keine Höhenvorgabe, append-only, **nie umnummeriert**, und **kein Lint** fängt es ab.

**Harte Randbedingung (der Grund, IDs NICHT umzunummerieren):** `FR-01.NN` wird an **~1964 Stellen in 446 Dateien** referenziert, u.a. **246× im append-only `shipwright_events.jsonl`** — genau dem Event-Log, das die **Mission-View / der Per-Run-Join** liest. Das Event-Log ist ein unveränderlicher Audit-Trail; ein Renumber würde die neuen Spec-IDs dauerhaft an der Historie vorbeizeigen lassen. Requirements-IDs sind deshalb unveränderlich.

**Vorschlag:** FRs auf **Fähigkeits-Flughöhe** normieren und in **15 Feature-Areas gruppieren** (Section-Header + `Area`-Spalte) — **die stabilen `FR-01.NN`-IDs bleiben**. Endpunkte/ADRs/Iterate-Deltas wandern aus der FR-Liste in Description/Interface/AC. Ergebnis sind **zwei getrennte Tabellen**:
- eine saubere, area-gruppierte **Requirements-Tabelle** (~28–32 Fähigkeits-FRs, stabile IDs);
- eine separate **Fold-/Alias-Tabelle** (jede gefaltete alte FR → ihr Überlebt-Eltern-FR), die alle historischen Referenzen auflösbar hält, ohne die Req-Tabelle zu verunreinigen.

---

## 1. Diagnose — warum die spec.md so aussieht

### 1.1 Zwei FR-Präge-Maschinen mit inkompatibler Philosophie

**Adopt (Brownfield-Onboarding)** — die spec.md wurde am 2026-04-30 von `/shipwright-adopt` generiert. Der Feature-Inferrer macht aus **jeder erkannten Route eine FR**:

> „Each detected route becomes a feature with a generated FR-ID (`FR-01.<NN>`)"
> — `shipwright-adopt/.../feature-inference.md:96`

```python
# Auto-assign an FR-ID in sequence
item["fr_id"] = f"FR-01.{len(deduped) + 1:02d}"   # feature_inferrer.py:178-180
```

`01` ist hart kodiert (der Split), `NN` ist bloß der laufende Index über die deduplizierten Routen — **keine Semantik, keine Gruppierung, Crawl-Reihenfolge**. Der „Name" ist der Routen-/Seitentitel (`label`), also per Konstruktion Endpunkt-Höhe.

→ Daher stammt der ganze Block **FR-01.07 bis FR-01.26**: das ist praktisch eine 1:1-Abbildung der REST-Routen (`server/src/routes/*`, `server/src/external/routes.ts`).

**Iterate (laufende Änderungen)** — jeder spätere Iterate hängt an. Es gibt aber **keine mechanische Nummern-Regel**:

- Die Skill reicht dem Agenten nur einen Platzhalter `FR-XX.YY` und die Prosa-Klassifikation ADD/MODIFY/REMOVE/NONE (`path-a-feature.md:30-32, 95-116`).
- Kein `max(FR)+1`, keine „welche Area", keine Höhenvorgabe. Die Nummer wird **geraten**.
- ADD heißt wörtlich „append a new FR table row" — es wird **nur angehängt, nie umgruppiert oder umnummeriert** (REMOVE verschiebt nur in eine `### Removed Requirements`-Sektion).
- Kein Compliance-Check bewertet FR-**Granularität, Flughöhe oder Waisen-Deltas** — die Audits prüfen nur Traceability (FR↔Plan↔Test) und Test-Layer.

→ Daher die geratenen, verstreuten Nummern und die „Delta-als-FR"-Zeilen. Die bekannte Notiz „Parallel iterates collide on the same FR number" (beide picken `max(FR)+1`) ist genau dieses Loch.

### 1.2 Symptom-Taxonomie (mit Belegen aus der aktuellen spec.md)

**A) Flughöhen-Brei — drei Ebenen als Geschwister**

| Ebene | Beispiele | Problem |
|---|---|---|
| Fähigkeit (korrekt) | FR-01.01 Board · 02 Detail · 04 Inbox · 28 Terminal · 30 Triage | — |
| Endpunkt (zu tief) | FR-01.07 Health (GET) · 08 Task list (GET,POST) · 10 Launch cmd (POST) · 12 Transcript (GET) · 13 tool_use list (GET) · 14 Dismiss (POST) · 16 Action catalog (GET) · 18 Run-config (GET) · 19 Folder tree (GET) · 20 File (GET) · 21 Stub (POST) · 22 Diagnostics (GET) · 23 Profiles (GET) · 24/25 Projects · 26 Settings (GET,PUT) | Das sind Routen, keine Requirements. Die `(GET)/(POST)`-Suffixe im Namen verraten es. |
| Delta / Changelog (keine FR) | FR-01.40 „Bugfix (completes FR-01.37)" · 41 „modifies FR-01.38/39" · 36 „Replaces FR-01.33's… affordance" · 34 „Campaigns lane, **Phase 2**" · 67 „extends FR-01.66" | Gehören in Description/AC des Eltern-FR, nicht als eigene Zeile. |

**B) UI↔API-Duplikat — dieselbe Fähigkeit doppelt (Seite + Route)**

Adopt hat sowohl die Seite als auch ihre Route je zur FR gemacht:

| Fähigkeit | Seiten-FR | Routen-FR(s) |
|---|---|---|
| Diagnostics | FR-01.05 | FR-01.22 (+07 Health) |
| Settings | FR-01.06 | FR-01.26 (+27 Upload) |
| Inbox | FR-01.04 | FR-01.13 + FR-01.14 |
| Projekt-Registry | FR-01.03 | FR-01.24 + FR-01.25 (+23 Profiles) |
| Task-Detail | FR-01.02 | FR-01.12 + FR-01.19 + FR-01.20 |

**C) Namen tragen Implementierung statt Fähigkeit**

HTTP-Verben, ADR-Nummern, Iterate-Slugs, interne Symbolnamen im *Namen*:
- „Pending tool_use list (GET)" → sollte „Offene Rückfragen im Inbox".
- „Build copy-command for terminal launch (POST)" → „Task starten / fortsetzen".
- „Per-run data join (runId → FRs/tests/derived-gates/phase-timings + grade-trend)" → „Pro-Run-Kennzahlen".
- „Embedded terminal — pty + WebSocket bidi + disk-backed scrollback (ADR-067, ADR-068-A1)" → „Eingebettetes Terminal". (ADRs gehören in die Traceability-Spalte.)

**D) Nummerierung kodiert Chronologie, nicht Logik**
- **Lücke:** FR-01.42 fehlt.
- **Aus der Reihe:** 54 nach 55/56; 57 nach 58; 62 nach 63 (parallele Iterates).
- **Zerstreute Epics:** Mission Control = 54,55,56,57,58,66,67 · Campaigns = 33,34,36 · Responsive = 38,39,41 · Ship's-Log = 59,60 — jeweils über den Nummernraum verteilt, dazwischen Fremdes.

### 1.3 Die ID-Stabilitäts-Randbedingung (warum kein Renumber)

`FR-01.NN` ist an **~1964 Stellen in 446 Dateien** referenziert. Die entscheidenden sind **unveränderliche Historie**:

| Datei(en) | Referenzen | Warum unantastbar |
|---|---|---|
| `shipwright_events.jsonl` | **246** | Append-only Audit-Trail (`affected_frs`/`new_frs` pro Run). **Die Mission-View / der Per-Run-Join lesen genau das.** |
| `CHANGELOG.md` + `CHANGELOG-unreleased.d/*` | viele | Historische Release-Notes — dokumentieren, was zum Zeitpunkt galt. |
| Test-Tags, `plan.md`, `doc-sync.test.ts` | viele | Traceability FR↔Test/Plan. |

Ein harter Renumber `FR-01.NN → FR-AREA-nn` würde entweder die Historie umschreiben (falsch — das Event-Log ist Audit-Trail) oder die neuen Spec-IDs dauerhaft an den historischen Einträgen vorbeizeigen lassen — ausgerechnet die Mission Control zeigte dann „unbekannte FR". **Deshalb: IDs bleiben stabil.** Die Area wird als Gruppierung/Metadaten ausgedrückt, nicht in der ID.

---

## 2. Zielmodell

### 2.1 Prinzip — was eine FR ist (und was nicht)

> **Eine FR ist eine stabile, für Nutzer oder System **beobachtbare Fähigkeit oder Garantie** — das „Was", auf konstanter Flughöhe.**

Kein FR ist: ein einzelner HTTP-Endpunkt, ein ADR, ein Refactor, ein Bugfix, eine „Phase 2", ein Politur-Delta. Diese werden **auf** eine FR zurückgeführt, sind aber selbst keine.

Prüffrage („altitude test"): *Kann eine nicht-technische Person die Zeile als etwas lesen, das die App **kann** oder **garantiert**?* Wenn im Namen ein Verb wie GET/POST, ein `snake_case`-Symbol oder „completes/modifies FR-x" steht → ist es zu tief bzw. ein Delta.

### 2.2 Drei-Artefakt-Trennung

Die spec.md vermischt heute drei Dinge, die getrennt gehören:

| Was | Wohin | Status heute |
|---|---|---|
| **Requirements** (Fähigkeiten, „Was") | `spec.md` FR-Tabelle | vorhanden, aber verunreinigt |
| **Interface-/Endpunkt-Fläche** (die API, „Wie außen") | Description-`Interfaces`-Bullets pro FR (+ `agent_docs/architecture.md`), **jede Route → ihre FR** | Endpunkte stecken fälschlich als FRs in spec.md |
| **Änderungsgeschichte** (welcher Iterate hat was berührt) | CHANGELOG + `shipwright_events.jsonl` + AC-Provenance-Tags | **funktioniert schon gut** (die `(E) (iterate-…)`-Tags in den Acceptance Criteria sind genau richtig) |

Kernidee: Die AC-Provenance-Tags sind bereits das korrekte Änderungslog. Deltas müssen also **nicht** als neue FR existieren — sie sind schon als AC-Zeilen mit Iterate-Tag am Eltern-FR erfasst. Wir müssen sie nur konsequent dort halten statt zusätzlich als eigene FR-Zeile.

### 2.3 Area-Gruppierung + stabile IDs + Namensregeln

**ID-Schema bleibt `FR-01.NN`** — stabil, unveränderlich (§1.3). Die Area ist **keine ID**, sondern:
- ein **Section-Header** in der FR-Tabelle (`### Area BRD — Board & Task-Lifecycle`), unter dem die zugehörigen FRs gelistet sind, **und**
- eine neue **`Area`-Spalte** (3-Buchstaben-Code) für maschinelle Gruppierung/Filterung.

Neue FRs bekommen weiterhin die nächste freie `FR-01.NN` und werden in ihre Area-Section einsortiert. Innerhalb einer Area sind die Nummern also nicht zwingend zusammenhängend — das ist ok, weil die Section die Logik liefert und die Nummer nur ein stabiler Identifier ist.

**Namensregeln (für die „Name"-Spalte):**
1. Fähigkeits-Phrase, präsens, aus Nutzer-/System-Sicht. Kein GET/POST, kein `snake_case`-Symbol.
2. Kein ADR / Iterate-Slug im Namen → in die Origin-/Source-Spalte.
3. ≤ ~6 Wörter. Details in die Description.
4. Ein FR = eine Fähigkeit. „+"/„&" mit zwei unabhängigen Fähigkeiten → prüfen, ob zwei FRs (in derselben Area).

---

## 3. Konkrete Area-Taxonomie für die WebUI

15 Areas. Jede Area 1–4 Fähigkeits-FRs. Endpunkte werden zu **Interface-Bullets** *innerhalb* des FR; Deltas zu **AC-Zeilen**. **IDs der überlebenden FRs bleiben `FR-01.NN`.**

| Code | Area | Überlebende Fähigkeits-FRs (ID behalten) | Faltet ein → Ziel-FR |
|---|---|---|---|
| **BRD** | Board & Task-Lifecycle | 01 (Board), 10 (Launch/Resume) | 08, 09→01 · 11, 61→10 · 15, 32→ Lifecycle-AC von 01 |
| **TSK** | Task-Detail & Transcript | 02 (3-Pane), 35 (Markdown-Edit) | 12, 19, 20→02 |
| **TRM** | Eingebettetes Terminal | 28 (Terminal), 29 (Bild-Paste) | 44→28 (Appearance-AC) |
| **INB** | Inbox / offene Rückfragen | 04 (Inbox) | 13, 14→04 · 63→04 (Terminal-Fallback-AC) |
| **PRJ** | Projekte & Ship's-Log | 03 (Registry+Wizard), 59 (Ship's-Log) | 23, 24, 25→03 · 60→59 |
| **ACT** | Aktionen & Launch-Config | 16 (Aktions-Katalog), 27 (actions.json verwalten), 37 (slash_command) | 21→16 · 40→27 |
| **RUN** | Pipeline-Runs & Design-Gate | 45 (Design-Gate) | 18→ Interface · 58→45 · Run-Karten-Teil von 01 bleibt bei 01 |
| **CMP** | Campaigns | 33 (Campaigns-Lane) | 34, 36→33 |
| **TRG** | Triage | 30 (Triage+Promote) | — |
| **PRV** | Preview | 17 (Preview-Spawn) | — |
| **INS** | Insights: Compliance/Grade/Run-Data | 43 (Compliance-Grade), 47 (Pro-Run-Daten) | 46→47 (Interface) · 53(Grade-Teil)→43 |
| **MSN** | Mission Control | 66 (Mission-View) | 54, 55, 56, 57, 67→66 |
| **FDR** | Front Door / Intent-Wizard | 51 (Intent-Wizard) | 52→51 · 53(Wizard-Teil)→51 |
| **UX** | Design-System & Shell | 48 (Weather-Deck), 38 (Responsive), 64 (Motion), 65 (Command-Palette), 50 (Glossar/Empty-States) | 39, 41→38 |
| **PLT** | Plattform | 05 (Diagnostics), 06 (Settings), 49 (Installer), 31 (Netzwerk) | 07, 22→05 · 26→06 |

> **Alle 66 Alt-FRs sind zugeordnet.** Aus 66 Zeilen werden **29 Fähigkeits-FRs** mit **unveränderten IDs**; die 37 eingefalteten IDs leben in der Fold-Tabelle (§4) weiter.

### 3.1 Was aus einem geplatzten FR wird — Muster

**Beispiel A — Endpunkt-Cluster faltet in eine Fähigkeit (Inbox), ID von 04 bleibt:**

```
FR-01.04 — Cross-Projekt-Inbox für offene Rückfragen   [Area INB]  (Name gesäubert)
  Description: … surfaces pending AskUserQuestion + text questions …
  Interfaces:  GET /pending  (war FR-01.13)   ·  POST /dismiss (war FR-01.14)
  AC: (E) … · (E)(iterate-2026-05-15) text_question … · (E)(FR-01.63) Terminal-Fallback …
```

**Beispiel B — Delta-Kette faltet komplett weg (Responsive), ID von 38 bleibt:**

```
FR-01.38 — Responsive Tablet-/Phone-Layout   [Area UX]
  AC: (E)(iterate-2026-06-14) Tablet ≤1023 …
      (E)(iterate-2026-06-14) Phone <768 drawer …        ← war FR-01.39
      (E)(iterate-2026-06-15) Density/Clipping-Politur … ← war FR-01.41 (Delta!)
      (E)(iterate-2026-06-27) iOS-Zoom-Schutz …
```
FR-01.39 und FR-01.41 verschwinden als eigenständige Zeilen (→ Fold-Tabelle) und leben als AC-Runden von FR-01.38 weiter.

**Beispiel C — Delta-„FR" faltet in sein Eltern-FR (Actions), ID von 27 bleibt:**

```
FR-01.27 — Manage actions config (upload / reset)   [Area ACT]
  Folded deltas: FR-01.40 Per-project actions.json upload in the project edit modal + upload-route fix
  (FR-01.37 slash_command bleibt eine eigene Fähigkeit; 40s Nebenteil "completes FR-01.37" ist im git/Fold-Map dokumentiert)
```

### 3.2 Beispiel-Umbenennungen (Name: vorher → nachher, **ID bleibt**)

| ID (bleibt) | Alt-Name | Neu-Name | Area |
|---|---|---|---|
| FR-01.07 | Health check (GET) | *(Interface-Bullet von FR-01.05)* | → PLT |
| FR-01.10 | Build copy-command for terminal launch (POST) | **Task starten / fortsetzen** | BRD |
| FR-01.13 | Pending tool_use list (GET) | *(Interface-Bullet von FR-01.04)* | → INB |
| FR-01.28 | Embedded terminal — pty + WebSocket bidi + disk-backed scrollback (ADR-067, ADR-068-A1) | **Eingebettetes Terminal** | TRM |
| FR-01.47 | Per-run data join (runId → …) | **Pro-Run-Kennzahlen** | INS |
| FR-01.66 | Mission tab — live, plain-language view … | **Mission-View (Live-Session)** | MSN |

---

## 4. Migration (IDs stabil, Traceability grün)

Der Umbau ist **verhaltensneutral** — keine Code-Verhaltensänderung, nur spec.md + Traceability. Vorgehen als **ein** dedizierter webui-Iterate:

1. **Requirements-Tabelle umbauen** — Area-Section-Header + `Area`-Spalte einziehen; überlebende FRs umbenennen (Fähigkeits-Höhe); Endpunkte in `Interfaces:`-Bullets der Description falten; Deltas in AC-Zeilen des Eltern-FR falten; gefaltete Zeilen aus der Tabelle entfernen. **IDs der überlebenden FRs bleiben unverändert.**
2. **Fold-/Alias-Tabelle** als eigene Sektion `## FR-Fold-Map` anlegen — je gefaltetes altes FR → Ziel-FR + Grund (`endpoint`/`delta`/`dup`). Das ist die „Alias-Tabelle": hält die **~1964 historischen Referenzen** (CHANGELOG, Events, Kommentare) auflösbar, **ohne** die Req-Tabelle zu verunreinigen.
3. **Nur die Test-Tags der GEFALTETEN FRs** auf ihr Ziel-FR umhängen (z.B. ein Test `@fr FR-01.13` → `FR-01.04`). Überlebende FRs behalten ID **und** Tags — deren Tests bleiben unangetastet. Der Blast-Radius ist auf die gefalteten IDs begrenzt (nicht die 446 Dateien).
4. **NICHT anfassen:** `shipwright_events.jsonl`, `CHANGELOG*`, `Spec/prototype/**` — Historie/Audit-Trail bleiben, wie sie zum Zeitpunkt waren. Die Fold-Tabelle ist die Brücke.
5. **Nachziehen:** `doc-sync.test.ts` + Compliance-Traceability-Matrix neu ziehen; grün halten (Endzustand muss konsistent sein, da Schritt 1–3 atomar im selben Iterate landen).

**Warum ein Iterate, nicht zwei:** Ein Split erzeugte ein Fenster, in dem die Req-Tabelle die gefalteten FRs schon los ist, deren Test-Tags aber noch auf tote IDs zeigen → Traceability rot. Mit „IDs behalten" ist der Umfang klein genug für einen atomaren Iterate.

---

## 5. Monorepo-Verbesserungen (damit das Plugin es künftig richtig macht)

Die Wurzel liegt im Framework — deshalb hier konkrete Plugin-Änderungen. (Kanonische Quelle: `C:\01_Development\shipwright\plugins\*`.) **Als ein Triage-Item im shipwright-Repo eingestellt**, mit den drei Änderungen als Unterpunkte.

### 5.1 `shipwright-adopt` — Fähigkeits-FRs statt Routen-FRs prägen

- **Nicht mehr eine FR pro Route.** In `feature_inferrer.py` / `artifact_writer.py`: Routen **unter der Seite/Fähigkeit gruppieren, die sie bedienen** (der Crawl liefert Seiten-URLs als natürliche Fähigkeits-Anker). Pro Fähigkeit **eine** FR; die Routen werden zu **Interface-Bullets** in der Description, nicht zu Geschwister-FRs.
- **Area-Gruppierung einführen:** eine `Area`-Spalte + Section-Grouping in `artifact_writer.py` (Area aus oberstem Routen-Segment / Nav-Gruppe ableiten, Fallback `GEN`). **ID-Schema `FR-01.NN` bleibt** (stabile IDs sind bewusst — siehe die Event-Log-Kopplung).
- **Namens-Normalisierung:** `label` als Fähigkeitsname, HTTP-Verben strippen; Route in `Interfaces`, nicht in den Namen.
- **UI↔API-Dedup:** wenn Seiten-FR und Backing-Route beide entstehen, die Route als Interface unter die Seiten-FR mergen (der bestehende Crawl-vs-AST-`url`/`route`-Join ist der Andockpunkt).

### 5.2 `shipwright-iterate` — explizites „Mint-vs-Fold"-Gate

Heute rät der Agent Nummer und ADD/MODIFY frei. Ergänzen in `path-a-feature.md` / `path-b-change.md`:

- **Entscheidungs-Heuristik MINT vs FOLD (neu):**
  - FOLD (kein neuer FR-Eintrag, hänge AC an bestehenden FR), wenn der Change *completes / polishes / fixes / „Phase N of" / extends* eine existierende Fähigkeit ist — Signalwörter, die heute in Descriptions auftauchen.
  - MINT (neuer FR) **nur** bei einer genuin neuen, nutzer-/system-beobachtbaren Fähigkeit.
- **Nummern-Regel festschreiben:** neuer FR = nächste freie `FR-01.NN` (`max+1`, deterministisch — Ende der geratenen Nummern/Parallel-Kollision), einsortiert in die passende **Area-Section**. Area-Katalog in `agent_docs` pflegen.
- **Namens-Fence:** GET/POST/`snake_case`-Symbole/ADR-Nummern/Iterate-Slugs im FR-Namen verbieten (gehören in Origin/AC).
- **Höhen-Selbstcheck (F5b):** „Ist der neue FR-Name als Fähigkeit lesbar? Beschreibt er einen Endpunkt/ein Delta → FOLD, nicht MINT."

### 5.3 `shipwright-compliance` — FR-Qualitäts-Lint (neuer Check, zunächst advisory)

Heute prüft nur Traceability (Group C/D). Neuer Check (z.B. „Group E — Requirement Hygiene"), im Anti-Ratchet-Stil erst nur *advisory*:

- **Höhen-Lint:** flagge FR-Namen mit `(GET|POST|PUT|PATCH|DELETE)`, `snake_case`-Symbolen oder ADR-/Iterate-Slugs.
- **Waisen-Delta-Lint:** flagge FR-Descriptions mit `completes FR-|modifies FR-|replaces FR-|Phase \d of`, die **selbst eine eigene FR-Zeile** sind → Kandidat zum Falten.
- **Area-/Dup-Lint:** flagge FRs ohne `Area`-Zuordnung und UI↔API-Duplikate (Seite+Route zur selben Fähigkeit).
- **Baseline-Ratchet:** bestehende Verstöße einfrieren, nur neue Überschreitungen hart blocken (wie das Bloat-Baseline). So kann eine Spec schrittweise sanieren, ohne CI zu röten.

---

## 6. Umsetzung — beschlossen

1. **Webui:** ein `/shipwright-iterate` (spec-hygiene, verhaltensneutral) nach §4 — Requirements-Tabelle + Fold-Tabelle + begrenzter Test-Tag-Remap + doc-sync/Traceability.
2. **Monorepo:** Triage-Item **`trg-8e840ca0`** in `../shipwright` (source `webui-spec-audit`, kind `improvement`) mit §5.1/§5.2/§5.3 als Unterpunkten, verweist auf dieses Doc. → Outbox, wird in den nächsten Monorepo-Iterate-PR gesweept.

### Finale Umsetzung (Abweichungen vom Entwurf oben, mit Sven 2026-07-17)

- **14 Areas statt 15** — **MSN (Mission Control) → TSK gefaltet**; Area umbenannt in **„Task Detail, Mission & Transcript"** (die Mission-View ist ein Tab im Task-Detail). FR-01.66 ist der TSK-Survivor.
- **Descriptions in Business-Sprache** umgeschrieben (WAS + Verhaltens-Garantien behalten, Implementierungs-WIE raus; Iterate-Historie als einfache `**Updates:**`-Zeile).
- **`Source`-Spalte (Dateipfade) entfernt** (→ architecture.md-Territorium); `Origin` (Iterate-Slug-Provenance) behalten. Endspalten: `ID·Area·Name·Priority·Description·Origin`.
- **Abstract** auf den aktuellen Stand gebracht (Auto-Execute im eingebetteten Terminal statt Copy-Command).
- **FR-01.40 → 27** (statt 37; dominante Fläche = actions.json-Upload im Edit-Modal). **FR-01.58 → 45** (Design-Gate-Entscheidung, kein Mission-Read).
- Verifiziert: Compliance-Parser-Sim sieht exakt 29 aktive FRs (Fold-Map backtick-geschützt); Client-Suite 2695/2695 grün; 0 `@FR`-Tags → 0 Waisen; Historie (events.jsonl/CHANGELOG/prototype) byte-untouched.
