import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    labelHandle: 'handle',
    labelProjectPath: 'project path',
    labelSprintSlug: 'sprint slug',
    labelRepoName: 'repo name',
    fileVanished: (path: string) => `File '${path}' vanished between listing and reading`,
    invalidName: (path: string, label: string, name: string) =>
      `${path}: invalid ${label} '${name}'`,
    parentProjectMissing: (path: string, parent: string) =>
      `${path}: parent project '${parent}' missing`,
    dirNameNotIssueId: (path: string, id: string) =>
      `${path}: directory name '${id}' is not an issue ID`,
    issueInWrongShard: (path: string, id: string, expected: string, shard: string) =>
      `${path}: issue '${id}' belongs in shard '${expected}', not '${shard}'`,
    idMismatch: (path: string, entityId: unknown, id: string) =>
      `${path}: id '${entityId}' does not match directory '${id}'`,
    noBacklogFound: (configFile: string, origin: string) =>
      `No backlog found: ${configFile} missing in ${origin}`,
    defaultOrigin: 'the source',
    invalidIssueId: (id: string) => `Invalid issue ID '${id}'`,
    invalidShard: (shard: string) => `Invalid shard '${shard}'`,
  },
  de: {
    labelHandle: 'Handle',
    labelProjectPath: 'Projekt-Pfad',
    labelSprintSlug: 'Sprint-Slug',
    labelRepoName: 'Repo-Name',
    fileVanished: (path: string) => `Datei »${path}« verschwand zwischen Auflisten und Lesen`,
    invalidName: (path: string, label: string, name: string) =>
      `${path}: ungültiger ${label} »${name}«`,
    parentProjectMissing: (path: string, parent: string) =>
      `${path}: Elternprojekt »${parent}« fehlt`,
    dirNameNotIssueId: (path: string, id: string) =>
      `${path}: Verzeichnisname »${id}« ist keine Issue-ID`,
    issueInWrongShard: (path: string, id: string, expected: string, shard: string) =>
      `${path}: Issue »${id}« gehört in den Shard »${expected}«, nicht »${shard}«`,
    idMismatch: (path: string, entityId: unknown, id: string) =>
      `${path}: id »${entityId}« passt nicht zum Verzeichnis »${id}«`,
    noBacklogFound: (configFile: string, origin: string) =>
      `Kein Backlog gefunden: ${configFile} fehlt in ${origin}`,
    defaultOrigin: 'der Quelle',
    invalidIssueId: (id: string) => `Ungültige Issue-ID »${id}«`,
    invalidShard: (shard: string) => `Ungültiger Shard »${shard}«`,
  },
});
