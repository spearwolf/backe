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
 * Akteur und den Daten davor und danach ab). Ein Verstoß ist `policy`, `schema` oder `missing_ref`.
 *
 * Für alle, auch Admins: Der `operator` eines Agents ist ein existierender Mensch (backe.md §2.12),
 * sobald er neu gesetzt wird. Admins (`config.admins`) dürfen sonst alles. Alle anderen dürfen
 * einen User ändern, wenn sie es selbst sind oder wenn es ihr Agent ist (`operator`), dabei aber
 * weder `kind` ändern noch den `operator` anders als dessen Mensch; einen neuen User nur anlegen,
 * wenn es ein Agent mit ihnen als `operator` ist; entfernen nie.
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

function checkRights(
  s: BacklogSnapshot,
  actor: string,
  handle: string,
  before: User | undefined,
  after: User | undefined,
): void {
  if (s.config.admins.includes(actor)) return;
  if (before !== undefined && after !== undefined) {
    const allowed = actor === handle || (before.kind === 'agent' && before.operator === actor);
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
    if (after.kind === 'agent' && after.operator === actor) return;
    throw violation('policy', `${actor} darf den User ${handle} nicht anlegen`, {
      hint: 'Anlegen dürfen Nutzer nur eigene Agents (operator = sie selbst); Menschen legen Admins an.',
    });
  }
  throw violation('policy', `${actor} darf den User ${handle} nicht entfernen`, {
    hint: 'Nur Admins entfernen User.',
  });
}
