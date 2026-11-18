# Outline-Fork: eigene Anpassungen

Dieser Fork ist das originale [Outline](https://github.com/outline/outline) plus
ein kleiner Stapel eigener Commits obendrauf. Er ist für die interne Nutzung
gedacht, nicht als öffentlicher Dienst (siehe [Lizenz](#lizenz)).

## Grundregeln für Anpassungen

Damit wir jederzeit auf das Original rebasen können, gilt für jede Anpassung:

1. **Ein Feature, ein Commit** (oder wenige), Betreff beginnt mit `fork:`.
   So zeigt `git log upstream/main..main` genau unsere Änderungen.
2. **Neue Dateien statt Umbau.** Logik kommt in eigene Dateien
   (`fork*.tsx`, `server/utils/Docx*.ts`, `fork/…`). In Upstream-Dateien
   ändern wir nur die Zeilen, die das Feature einhängen (ein Import und ein
   Eintrag in einer Liste).
3. **Upstream-Dateien für Build und CI bleiben unverändert.** Der Fork hat ein
   eigenes `fork/Dockerfile` und einen eigenen Workflow
   `.github/workflows/fork-image.yml`.
4. **Keine Lizenzsperren umgehen.** Plan-Features, die Outline im Code sperrt,
   werden nicht freigeschaltet (siehe unten).

## Übersicht der Anpassungen

| Feature | Commit (Betreff) | Konfiguration |
| --- | --- | --- |
| Schriftfarbe im Editor | `fork: Add text color to the editor` | keine |
| Word-Export (.docx) | `fork: Add Word (.docx) export for documents and revisions` | keine |
| Markdown ansehen und bearbeiten | `fork: Add Markdown source view and editing` | keine |
| Versionen benennen | `fork: Allow naming versions in the document history` | keine |
| Container-Image, Rebase-Skript, diese Doku | `fork: Add container build, upstream sync and documentation` | siehe [Container](#container) |
| Git-Sync für Sammlungen | eigene Commits aus PR #1 | `GIT_SYNC_*`, siehe [Git-Sync](#git-sync-für-sammlungen) |
| OIDC-Gruppen und Berechtigungen | *in Arbeit, eigener Abschnitt folgt* | |

Die aktuelle Liste mit Hashes zeigt `fork/sync-upstream.sh --list`.

### Schriftfarbe im Editor

Text markieren, in der Formatierungsleiste auf das „A“-Symbol (Text color)
klicken und eine Farbe wählen. Es gibt sieben Voreinstellungen, die im hellen
und dunklen Design lesbar sind, und unter „Custom“ einen freien Farbwähler.
„Default“ entfernt die Farbe. Beim Einfügen aus Word oder Webseiten werden
Textfarben übernommen, Schwarz und sehr dunkle Grautöne nicht.

- Mark: `shared/editor/marks/TextColor.ts` (Name `text_color`, Attribut `color` als Hex-Wert)
- Menü: `app/editor/menus/formatting.tsx`, `app/editor/components/TextColorPicker.tsx`,
  `app/components/Icons/TextColorIcon.tsx`
- Eingehängt in: `shared/editor/nodes/index.ts`
- Einschränkung: Markdown kennt keine Farben. Im Markdown-Export und beim
  Speichern über die Markdown-Bearbeitung gehen Farben verloren. Im Word-Export
  bleiben sie erhalten.

### Word-Export (.docx)

Im Dokumentmenü unter **Export → Word** und im Versionsverlauf unter
**Export → Word** für eine einzelne Version. Das Dokument wird in echte
Word-Elemente übersetzt: Überschriften (Word-Formatvorlagen, also auch
Inhaltsverzeichnis-fähig), Aufzählungen und nummerierte Listen mit
Verschachtelung, Checklisten, Tabellen mit Kopfzeile und Zellfarben, Zitate,
Hinweis-Boxen, Code-Blöcke, Links, Hervorhebungen, Schriftfarben und
eingebettete Bilder (PNG, JPEG, GIF, BMP). Andere Bildformate und eingebettete
Inhalte wie Draw.io-Diagramme oder Videos erscheinen als Link.

- Konverter: `server/utils/DocxHelper.ts` (Bibliothek `docx`)
- Antwort und Bilder: `server/utils/docxExport.ts`
- API: `documents.export` und `revisions.export` mit
  `Accept: application/vnd.openxmlformats-officedocument.wordprocessingml.document`
- Menü: `app/actions/definitions/forkWordExport.tsx`
- Tests: `server/utils/DocxHelper.test.ts`, `server/routes/api/documents/docxExport.test.ts`

Für den strukturierten Export ganzer Sammlungen gibt es weiterhin den
Upstream-Export unter Einstellungen → Export (Markdown, HTML oder JSON als ZIP
mit Ordnerstruktur).

### Markdown ansehen und bearbeiten

Im Dokumentmenü **Edit as Markdown** (oder **View Markdown** ohne
Schreibrechte). Der Dialog zeigt den Markdown-Quelltext ohne den Titel. Mit
**Save** ersetzt der Text den Inhalt des Dokuments. Geöffnete Editoren anderer
Nutzer bekommen die Änderung live über den Collaboration-Server.

- Dialog: `app/components/MarkdownSourceDialog.tsx`
- Menü: `app/actions/definitions/forkMarkdown.tsx`, eingehängt in `app/hooks/useDocumentMenuAction.tsx`
- Nutzt die vorhandenen APIs `documents.export` und `documents.update` (Feld `text`)
- Einschränkung: Was Markdown nicht ausdrücken kann (Schrift- und Zellfarben),
  geht beim Speichern verloren. Der Dialog weist darauf hin, und Speichern ist
  nur aktiv, wenn sich der Text geändert hat.

### Versionen benennen

Im Versionsverlauf (Dokumentmenü → History) im Menü einer Version **Name
version**. Der Name, zum Beispiel „Freigegeben“ oder „v1.0“, steht danach fett
vor dem Zeitstempel. Ein leerer Name entfernt ihn. Der Server konnte das schon
(`revisions.update`), es fehlte nur die Oberfläche. Der Word-Export einer
benannten Version nutzt den Namen als Dateinamen.

- Dialog: `app/components/RevisionNameDialog.tsx`
- Menü: `app/actions/definitions/forkRevisionName.tsx`, eingehängt in
  `app/menus/RevisionMenu.tsx` und `app/scenes/Document/components/History/RevisionListItem.tsx`

Hinweis: Outline legt eine neue Version erst einige Minuten nach der letzten
Änderung an (Upstream-Verhalten). Eine frische Änderung taucht deshalb nicht
sofort im Verlauf auf.

### Git-Sync für Sammlungen

Kommt mit PR #1 (Branch `claude/project-thread-l1ysrf`). Eine Sammlung lässt
sich an ein Git-Repository anbinden. Einrichtung durch Admins unter
**Einstellungen → Integrationen → Git Sync**.

- Dokumente liegen als Markdown mit Frontmatter (`id`, `title`, `url`,
  `parent` …) im Repository, Unterdokumente als Ordner.
- Standardmäßig in beide Richtungen: Outline → Git nach einer kurzen
  Wartezeit (`GIT_SYNC_DEBOUNCE`, 30 s) oder beim nächsten Abgleich,
  Git → Outline per Abgleich (`GIT_SYNC_POLL_INTERVAL`, 300 s), stündlichem
  Cron und Push-Webhook.
- Konflikte: Outline gewinnt, die Git-Version bleibt in der Git-Historie.
  In Git gelöschte Dateien schieben das Dokument in den Papierkorb.
- Git-Tags lassen sich in Outline anlegen, auflisten und löschen.
- Zugriff nur über HTTPS mit Token, das Token liegt verschlüsselt in der
  Datenbank. Weitere Variablen: `GIT_SYNC_CACHE_DIR`,
  `GIT_SYNC_ALLOW_INSECURE_URLS` (nur für Tests).
- Code: Plugin `plugins/git-sync`, Model `server/models/CollectionGitSync.ts`
  (eingehängt mit einer Zeile in `server/models/index.ts`), Migration
  `20261118220000-create-collection-git-syncs.js`.
- Das Image enthält dafür `git` (`RUNTIME_APT_PACKAGES` in `fork/Dockerfile`).
- Grenzen: Verschieben von Dateien in Git verschiebt keine Dokumente, Anhänge
  werden verlinkt statt kopiert, kein SSH.

## Container

Bei jedem Push auf `main` (und bei Tags `fork-v*`) baut der Workflow
`.github/workflows/fork-image.yml` das Image und legt es in die GitHub Container
Registry:

```
ghcr.io/onkeldom/outline:latest      # Stand von main
ghcr.io/onkeldom/outline:sha-<hash>  # fester Stand
ghcr.io/onkeldom/outline:fork-v1.0   # bei Tag fork-v1.0
```

Das Package ist zuerst privat. Zum Ziehen auf dem Server einmal anmelden:
`echo <PAT mit read:packages> | docker login ghcr.io -u <github-user> --password-stdin`.

Das Image ist ein Ersatz für `outlinewiki/outline`, mit denselben
Umgebungsvariablen, Port 3000 und Volume `/var/lib/outline/data`. In einer
bestehenden `docker-compose.yml` reicht es, das Image auszutauschen:

```yaml
services:
  outline:
    image: ghcr.io/onkeldom/outline:latest
    env_file: ./docker.env
    ports:
      - "3000:3000"
    volumes:
      - storage-data:/var/lib/outline/data
    depends_on:
      - postgres
      - redis
```

Datenbank-Migrationen laufen wie beim Original beim Start. Lokal bauen:

```bash
docker build -f fork/Dockerfile -t outline-fork .
```

Unterschiede zum Upstream-Image: ein einziges mehrstufiges Dockerfile statt
`Dockerfile.base` plus `Dockerfile`, der Healthcheck nutzt Node statt `wget`,
und das Laufzeit-Image enthält `git` für den Git-Sync. Zusätzliche Pakete für
das Image gehören in `RUNTIME_APT_PACKAGES` in `fork/Dockerfile`, nicht in das
Upstream-`Dockerfile`.

## Auf das Original rebasen

`main` = Original + unsere `fork:`-Commits. Neue Upstream-Versionen holen wir so:

```bash
fork/sync-upstream.sh --list   # zeigt unsere Commits
fork/sync-upstream.sh          # rebased main auf upstream/main (mit Backup-Branch)
yarn install && yarn tsc && yarn test server/utils/DocxHelper.test.ts
fork/sync-upstream.sh --push   # erst wenn alles grün ist; pusht mit --force-with-lease
```

Das Skript legt vor dem Rebase einen Branch `backup/main-<datum>` an. Bei
Konflikten hält es an und erklärt die nächsten Schritte. Da unsere Änderungen
an Upstream-Dateien nur aus einzelnen Einhänge-Zeilen bestehen, sind Konflikte
meist in Sekunden gelöst. Danach baut der Workflow automatisch ein neues Image.

Wichtig: Den Button „Sync fork“ auf GitHub nicht verwenden. Er würde einen
Merge-Commit erzeugen statt unsere Commits oben zu halten.

## Lizenz

Outline steht unter der Business Source License 1.1. Erlaubt sind die Nutzung
und Veränderung, auch produktiv, für das eigene Team, also Mitarbeiter und
Auftragnehmer. Verboten ist nur, Outline Dritten als „Document Service“
anzubieten. Ab 2030-11-15 gilt für diese Version Apache 2.0.

Im Code (`shared/utils/PlanHelper.ts`) steht ausdrücklich: Wer die
Lizenzsperren umgeht oder verändert, verliert sofort die Lizenz. Deshalb
bauen wir eigene Features, schalten aber gesperrte Funktionen nicht frei.

### Was in der Community-Edition gesperrt ist

Das Team steht fest auf dem Plan `community` (`server/models/Team.ts`), der
keine Plan-Features enthält. Im Code geprüft werden:

| Plan-Feature | Was es tut | Code im Repo? |
| --- | --- | --- |
| `GroupSync` | Gruppen automatisch aus dem Identity Provider übernehmen | Ja, aber nur für Google; für OIDC fehlt ein Provider. Gesperrt in `server/policies/team.ts`, `SyncUserGroupsTask` |
| `Guests` | Externe Gäste einladen | Ja, gesperrt in `server/policies/user.ts` |
| `AuditLog` | Audit-Log für Admins (`events.list` mit `auditLog`) | API ja, gesperrt in `server/policies/team.ts` |
| `AdvancedSecurity` | Standard-Ablaufzeit für öffentliche Links | Ja, gesperrt in `server/policies/team.ts`, `server/models/Team.ts` |
| `SAML`, `CustomDomain`, `AIAnswers`, `ApiKeyManagement`, `ContentManagement`, `PremiumIntegrations` | SAML-Login, eigene Domain, KI-Antworten, zentrale API-Keys, Inhaltsverwaltung, Zusatz-Integrationen | Nein, nur als Name definiert; der Code liegt nur in der Cloud-Version |

Außerdem: PDF-Export (Server antwortet „not available in the community
edition“, Button ausgeblendet; Drucken als PDF über den Browser geht),
Confluence-Import (Button deaktiviert) und „In Desktop-App öffnen“ (nur Cloud).

Nicht gesperrt und sofort nutzbar: Gruppen in Outline anlegen und ihnen Lese-
oder Schreibrechte auf Sammlungen und einzelne Dokumente geben. Nur die
automatische Übernahme der Gruppen aus dem Identity Provider ist gesperrt.

## Tests dieses Forks

- Unit- und API-Tests: `server/utils/DocxHelper.test.ts`,
  `server/routes/api/documents/docxExport.test.ts`,
  `shared/editor/marks/TextColor.test.ts`
- Browser-Abläufe in der echten App (Skill `verify-outline`):
  `.claude/skills/verify-outline/journeys/fork-features.mjs` (Farbe, Markdown,
  Word) und `fork-name-version.mjs` (Versionen benennen)
