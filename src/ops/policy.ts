/**
 * Identitätsschutz für `users/` (backe.md §2.13 Punkt 4): wer welchen User anlegen, ändern oder
 * entfernen darf. Die Regel gilt für `applyOperation` und für die Prüfung fremder Commits.
 */
import type { User } from '../core/schemas.ts';
import type { BacklogSnapshot } from '../store/snapshot.ts';
import { violation } from './invariants.ts';

/**
 * Prüft jede Änderung an `users/<handle>.md`; sie muss bei jedem Schreiben dieser Datei aufgerufen
 * werden, auch bei reinen Body- oder unbekannten-Key-Änderungen (die Entscheidung hängt nur von
 * Akteur und den Daten davor und danach ab). Ein Verstoß ist `policy`, `schema`, `missing_ref`
 * oder `references`.
 *
 * `s` ist der Stand **nach** der Änderung: Ein neuer User steht schon darin, ein entfernter nicht
 * mehr. Jeder Aufrufer übergibt diesen Stand, damit die Prüfung fremder Commits dieselbe
 * Entscheidung trifft wie `applyOperation`.
 *
 * Für alle, auch Admins: Der `operator` eines Agents ist ein existierender Mensch (backe.md §2.12),
 * sobald er neu gesetzt wird; ein User, der noch Operator von Agents ist, wird nicht entfernt.
 * Admin ist nur, wer in `config.admins` steht und als Mensch existiert (bei einer Änderung am
 * eigenen User zählt der Stand davor); ein Agent oder ein Handle ohne User-Datei im Admin-Eintrag
 * hat keine Admin-Rechte. Einen User, dessen Handle in `config.admins` steht, legt nur ein Admin
 * an. Admins dürfen sonst alles. Alle anderen dürfen einen User ändern, wenn sie es
 * selbst sind oder wenn es ihr Agent ist (`operator`, nur wenn der Akteur ein Mensch ist), dabei
 * aber weder `kind` ändern noch den `operator` anders als dessen Mensch; einen neuen User nur
 * anlegen, wenn es ein Agent mit ihnen als `operator` ist und kein bestehender User den Handle
 * als `operator` nennt (sonst übernähme der Neue fremde Agents); entfernen nie.
 */
export function checkUserChange(
  s: BacklogSnapshot,
  actor: string,
  handle: string,
  before: User | undefined,
  after: User | undefined,
): void {
  checkRights(s, actor, handle, before, after);
  checkOperator(s, before, after);
  if (after === undefined) checkNoAgents(s, handle);
}

/** Handles der Users, die `handle` als `operator` nennen, sortiert. */
function agentsOf(s: BacklogSnapshot, handle: string): string[] {
  return [...s.users]
    .filter(([key, { data }]) => key !== handle && data.operator === handle)
    .map(([key]) => key)
    .sort();
}

/** Ein entfernter User darf keine Agents zurücklassen, deren Handle ein Neuer übernehmen könnte. */
function checkNoAgents(s: BacklogSnapshot, handle: string): void {
  const agents = agentsOf(s, handle);
  if (agents.length > 0) {
    throw violation('references', `${handle} ist Operator von ${agents.join(', ')}`, {
      ids: agents,
      hint: 'Erst die Agents entfernen oder ihren Operator ändern.',
    });
  }
}

/** Der `operator` eines neuen oder geänderten Agents ist ein existierender Mensch. */
function checkOperator(s: BacklogSnapshot, before: User | undefined, after: User | undefined) {
  if (
    after?.kind === 'agent' &&
    after.operator !== undefined &&
    (before === undefined || before.operator !== after.operator)
  ) {
    const operator = s.users.get(after.operator)?.data;
    if (operator === undefined) {
      throw violation('missing_ref', `Operator ${after.operator} nicht gefunden`, {
        ids: [after.operator],
      });
    }
    if (operator.kind !== 'human') {
      throw violation('schema', `Operator ${after.operator} ist kein Mensch`, {
        hint: 'Ein Agent hat einen verantwortlichen Menschen als operator.',
      });
    }
  }
}

/**
 * Admin ist, wer in `config.admins` steht und als Mensch existiert. Der Datensatz des Akteurs ist
 * bei einer Änderung am eigenen User der Stand davor, sonst der im Snapshot; fehlt er oder ist er
 * ein Agent, gilt der Akteur als Nicht-Admin.
 */
function isAdmin(s: BacklogSnapshot, actor: string, handle: string, before: User | undefined) {
  if (!s.config.admins.includes(actor)) return false;
  const record = actor === handle ? before : s.users.get(actor)?.data;
  return record?.kind === 'human';
}

function checkRights(
  s: BacklogSnapshot,
  actor: string,
  handle: string,
  before: User | undefined,
  after: User | undefined,
): void {
  if (isAdmin(s, actor, handle, before)) return;
  if (before !== undefined && after !== undefined) {
    const operates =
      before.kind === 'agent' &&
      before.operator === actor &&
      s.users.get(actor)?.data.kind === 'human';
    const allowed = actor === handle || operates;
    if (!allowed) {
      throw violation('policy', `${actor} darf den User ${handle} nicht ändern`, {
        hint: 'Ändern dürfen den User er selbst, bei einem Agent sein Operator und Admins.',
      });
    }
    if (before.kind !== after.kind) {
      throw violation('policy', `${actor} darf die Art von ${handle} nicht ändern`, {
        hint: 'Die Art (human/agent) ändern nur Admins.',
      });
    }
    if (before.operator !== after.operator && actor !== before.operator) {
      throw violation('policy', `${actor} darf den Operator von ${handle} nicht ändern`, {
        hint: 'Den Operator ändern nur Admins und der bisherige Operator.',
      });
    }
    return;
  }
  if (before === undefined && after !== undefined) {
    if (s.config.admins.includes(handle)) {
      throw violation('policy', `${actor} darf den User ${handle} nicht anlegen`, {
        hint: `${handle} ist als Admin eingetragen; anlegen darf ihn nur ein Admin.`,
      });
    }
    if (after.kind === 'agent' && after.operator === actor) {
      const agents = agentsOf(s, handle);
      if (agents.length === 0) return;
      throw violation('policy', `${actor} darf den User ${handle} nicht anlegen`, {
        ids: agents,
        hint: `${handle} ist als Operator von ${agents.join(', ')} eingetragen; anlegen darf ihn nur ein Admin.`,
      });
    }
    throw violation('policy', `${actor} darf den User ${handle} nicht anlegen`, {
      hint: 'Anlegen dürfen Nutzer nur eigene Agents (operator = sie selbst); Menschen legen Admins an.',
    });
  }
  throw violation('policy', `${actor} darf den User ${handle} nicht entfernen`, {
    hint: 'Nur Admins entfernen User.',
  });
}
