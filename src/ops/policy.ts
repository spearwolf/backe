/**
 * Identitätsschutz für `users/` (backe.md §2.13 Punkt 4): wer welchen User anlegen, ändern oder
 * entfernen darf. Die Regel gilt für `applyOperation` und für die Prüfung fremder Commits.
 */
import type { User } from '../core/schemas.ts';
import type { BacklogSnapshot } from '../store/snapshot.ts';
import { violation } from './invariants.ts';

/**
 * Admins (`config.admins`) dürfen alles. Alle anderen dürfen einen User ändern, wenn sie es selbst
 * sind oder wenn es ihr Agent ist (`operator`); einen neuen User nur anlegen, wenn es ein Agent
 * mit ihnen als `operator` ist; entfernen nie. Ein Verstoß ist `policy`.
 */
export function checkUserChange(
  s: BacklogSnapshot,
  actor: string,
  handle: string,
  before: User | undefined,
  after: User | undefined,
): void {
  if (s.config.admins.includes(actor)) return;
  if (before !== undefined && after !== undefined) {
    if (actor === handle || (before.kind === 'agent' && before.operator === actor)) return;
    throw violation('policy', `${actor} darf den User ${handle} nicht ändern`, {
      hint: 'Ändern dürfen den User er selbst, bei einem Agent sein Operator und Admins.',
    });
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
