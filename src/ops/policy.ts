/**
 * Identitätsschutz für `users/` (backe.md §2.13 Punkt 4): wer welchen User anlegen, ändern oder
 * entfernen darf. Die Regel gilt für `applyOperation` und für die Prüfung fremder Commits.
 */

import type { User } from '../core/schemas.ts';
import { sameKey, sshFingerprint } from '../core/ssh.ts';
import type { BacklogSnapshot } from '../store/snapshot.ts';
import { isAdmin } from './admin.ts';
import { violation } from './invariants.ts';
import { m } from './policy.messages.ts';

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
 * sobald er neu gesetzt wird; ein User, der noch Operator von Agents ist, wird weder entfernt noch
 * zum Agent. Ein Key steht bei genau einem User (`keys` und `revoked_keys` aller User, verglichen
 * nach Typ und Blob, nicht nach Kommentar); ein widerrufener Key bleibt widerrufen und wird weder
 * gelöscht noch wieder aktiv.
 *
 * Admin ist nur, wer in `config.admins` steht und als Mensch existiert (bei einer Änderung am
 * eigenen User zählt der Stand davor); ein Agent oder ein Handle ohne User-Datei im Admin-Eintrag
 * hat keine Admin-Rechte. Bestimmt der Aufrufer den Admin-Status aus einem anderen Stand
 * (`verify`: dem Stand, gegen den der Commit beurteilt wird), übergibt er ihn als `opts.admin`.
 * Einen User, dessen Handle in `config.admins` steht oder der früher schon einmal entfernt wurde
 * (`opts.removedBefore`), legt nur ein Admin an. Admins dürfen sonst alles.
 * Alle anderen dürfen einen User ändern, wenn sie es selbst sind oder wenn es ihr Agent ist
 * (`operator`, nur wenn der Akteur ein Mensch ist), dabei aber weder `kind` noch `operator`
 * ändern (den Operator wechseln nur Admins, auch der bisherige Operator nicht); einen neuen User
 * nur anlegen, wenn es ein Agent mit ihnen als `operator` ist und kein bestehender User den Handle
 * als `operator` nennt (sonst übernähme der Neue fremde Agents); entfernen nie.
 */
export function checkUserChange(
  s: BacklogSnapshot,
  actor: string,
  handle: string,
  before: User | undefined,
  after: User | undefined,
  opts: { removedBefore?: boolean; admin?: boolean } = {},
): void {
  const admin = opts.admin ?? actorIsAdmin(s, actor, handle, before);
  checkRights(s, actor, handle, before, after, {
    admin,
    removedBefore: opts.removedBefore === true,
  });
  checkOperator(s, before, after);
  if (after !== undefined) {
    checkKeysUnique(s, handle, before, after);
    checkRevocations(before, after);
  }
  if (after === undefined) checkNoAgents(s, handle);
  else if (after.kind === 'agent') checkOperatorStaysHuman(s, handle);
}

/** Ein neu hinzugekommener Key gehört keinem anderen User, weder aktiv noch widerrufen. */
function checkKeysUnique(
  s: BacklogSnapshot,
  handle: string,
  before: User | undefined,
  after: User,
): void {
  for (const key of after.keys ?? []) {
    if ((before?.keys ?? []).some((old) => sameKey(old, key))) continue;
    for (const [other, { data }] of s.users) {
      if (other === handle) continue;
      const taken = [...(data.keys ?? []), ...(data.revoked_keys ?? []).map((r) => r.key)];
      if (taken.some((k) => sameKey(k, key))) {
        throw violation('policy', m.keyTaken(sshFingerprint(key), other), {
          hint: m.keyTakenHint,
        });
      }
    }
  }
}

/**
 * Ein widerrufener Key bleibt widerrufen: nicht gelöscht, nicht wieder aktiv. Neu widerrufen wird
 * nur ein Key, den der User vorher hatte; sonst sperrte der Widerruf fremde Keys für alle.
 */
function checkRevocations(before: User | undefined, after: User): void {
  for (const { key } of after.revoked_keys ?? []) {
    if ((before?.revoked_keys ?? []).some((r) => sameKey(r.key, key))) continue;
    if (!(before?.keys ?? []).some((k) => sameKey(k, key))) {
      throw violation('policy', m.revokeOnlyOwn(sshFingerprint(key)), {
        hint: m.revokeOnlyOwnHint,
      });
    }
  }
  for (const { key } of before?.revoked_keys ?? []) {
    const stays = (after.revoked_keys ?? []).some((r) => sameKey(r.key, key));
    const active = (after.keys ?? []).some((k) => sameKey(k, key));
    if (!stays || active) {
      throw violation('policy', m.revocationFinal(sshFingerprint(key)), {
        hint: m.revocationFinalHint,
      });
    }
  }
}

/** Wer von anderen Users als `operator` genannt wird, bleibt Mensch. */
function checkOperatorStaysHuman(s: BacklogSnapshot, handle: string): void {
  const agents = agentsOf(s, handle);
  if (agents.length > 0) {
    throw violation('references', m.operatorStaysHuman(handle, agents.join(', ')), {
      ids: agents,
      hint: m.removeAgentsHint,
    });
  }
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
    throw violation('references', m.operatorOf(handle, agents.join(', ')), {
      ids: agents,
      hint: m.removeAgentsHint,
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
      throw violation('missing_ref', m.operatorNotFound(after.operator), {
        ids: [after.operator],
      });
    }
    if (operator.kind !== 'human') {
      throw violation('schema', m.operatorNotHuman(after.operator), {
        hint: m.operatorNotHumanHint,
      });
    }
  }
}

/**
 * Admin ist, wer in `config.admins` steht und als Mensch existiert. Der Datensatz des Akteurs ist
 * bei einer Änderung am eigenen User der Stand davor, sonst der im Snapshot; fehlt er oder ist er
 * ein Agent, gilt der Akteur als Nicht-Admin.
 */
function actorIsAdmin(s: BacklogSnapshot, actor: string, handle: string, before: User | undefined) {
  return isAdmin(s.config, actor, actor === handle ? before : s.users.get(actor)?.data);
}

function checkRights(
  s: BacklogSnapshot,
  actor: string,
  handle: string,
  before: User | undefined,
  after: User | undefined,
  { admin, removedBefore }: { admin: boolean; removedBefore: boolean },
): void {
  if (admin) return;
  if (before !== undefined && after !== undefined) {
    const operates =
      before.kind === 'agent' &&
      before.operator === actor &&
      s.users.get(actor)?.data.kind === 'human';
    const allowed = actor === handle || operates;
    if (!allowed) {
      throw violation('policy', m.mayNotChangeUser(actor, handle), {
        hint: m.mayNotChangeUserHint,
      });
    }
    if (before.kind !== after.kind) {
      throw violation('policy', m.mayNotChangeKind(actor, handle), {
        hint: m.mayNotChangeKindHint,
      });
    }
    if (before.operator !== after.operator) {
      throw violation('policy', m.mayNotChangeOperator(actor, handle), {
        hint: m.mayNotChangeOperatorHint,
      });
    }
    return;
  }
  if (before === undefined && after !== undefined) {
    if (removedBefore) {
      throw violation('policy', m.mayNotRecreate(actor, handle), {
        hint: m.mayNotRecreateHint(handle),
      });
    }
    if (s.config.admins.includes(handle)) {
      throw violation('policy', m.mayNotCreate(actor, handle), {
        hint: m.mayNotCreateAdminHint(handle),
      });
    }
    if (after.kind === 'agent' && after.operator === actor) {
      const agents = agentsOf(s, handle);
      if (agents.length === 0) return;
      throw violation('policy', m.mayNotCreate(actor, handle), {
        ids: agents,
        hint: m.mayNotCreateOperatorHint(handle, agents.join(', ')),
      });
    }
    throw violation('policy', m.mayNotCreate(actor, handle), {
      hint: m.mayNotCreateHint,
    });
  }
  throw violation('policy', m.mayNotRemove(actor, handle), {
    hint: m.mayNotRemoveHint,
  });
}
