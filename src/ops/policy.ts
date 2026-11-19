/**
 * Identitätsschutz für `users/` (backe.md §2.13 Punkt 4): wer welchen User anlegen, ändern oder
 * entfernen darf. Die Regel gilt für `applyOperation` und für die Prüfung fremder Commits.
 */
import type { User } from '../core/schemas.ts';
import { sameKey, sshFingerprint } from '../core/ssh.ts';
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
 * sobald er neu gesetzt wird; ein User, der noch Operator von Agents ist, wird weder entfernt noch
 * zum Agent. Ein Key steht bei genau einem User (`keys` und `revoked_keys` aller User, verglichen
 * nach Typ und Blob, nicht nach Kommentar); ein widerrufener Key bleibt widerrufen und wird weder
 * gelöscht noch wieder aktiv.
 *
 * Admin ist nur, wer in `config.admins` steht und als Mensch existiert (bei einer Änderung am
 * eigenen User zählt der Stand davor); ein Agent oder ein Handle ohne User-Datei im Admin-Eintrag
 * hat keine Admin-Rechte. Einen User, dessen Handle in `config.admins` steht oder der früher schon
 * einmal entfernt wurde (`opts.removedBefore`), legt nur ein Admin an. Admins dürfen sonst alles.
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
  opts: { removedBefore?: boolean } = {},
): void {
  checkRights(s, actor, handle, before, after, opts.removedBefore === true);
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
  for (const key of after.keys) {
    if ((before?.keys ?? []).some((old) => sameKey(old, key))) continue;
    for (const [other, { data }] of s.users) {
      if (other === handle) continue;
      const taken = [...data.keys, ...(data.revoked_keys ?? []).map((r) => r.key)];
      if (taken.some((k) => sameKey(k, key))) {
        throw violation('policy', `Key ${sshFingerprint(key)} gehört schon ${other}`, {
          hint: 'Jeder Key gehört genau einem User.',
        });
      }
    }
  }
}

/** Ein widerrufener Key bleibt widerrufen: nicht gelöscht, nicht wieder aktiv. */
function checkRevocations(before: User | undefined, after: User): void {
  for (const { key } of before?.revoked_keys ?? []) {
    const stays = (after.revoked_keys ?? []).some((r) => sameKey(r.key, key));
    const active = after.keys.some((k) => sameKey(k, key));
    if (!stays || active) {
      throw violation('policy', `Der Widerruf von ${sshFingerprint(key)} ist endgültig`, {
        hint: 'Einen widerrufenen Key neu zu vergeben ist nicht möglich; einen neuen Key anlegen.',
      });
    }
  }
}

/** Wer von anderen Users als `operator` genannt wird, bleibt Mensch. */
function checkOperatorStaysHuman(s: BacklogSnapshot, handle: string): void {
  const agents = agentsOf(s, handle);
  if (agents.length > 0) {
    throw violation(
      'references',
      `${handle} ist Operator von ${agents.join(', ')}; ein Operator bleibt Mensch`,
      {
        ids: agents,
        hint: 'Erst die Agents entfernen oder ihren Operator ändern.',
      },
    );
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
  removedBefore: boolean,
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
    if (before.operator !== after.operator) {
      throw violation('policy', `${actor} darf den Operator von ${handle} nicht ändern`, {
        hint: 'Den Operator ändern nur Admins.',
      });
    }
    return;
  }
  if (before === undefined && after !== undefined) {
    if (removedBefore) {
      throw violation('policy', `${actor} darf den User ${handle} nicht neu anlegen`, {
        hint: `${handle} wurde früher entfernt; neu anlegen darf ihn nur ein Admin.`,
      });
    }
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
