import { isAdmin } from '@backe/ops/admin.ts';
import type { UserJson } from '@backe/ui/api.ts';
import { Bot, ShieldCheck, User } from 'lucide-react';
import { useEffect, useState } from 'react';
import { settingsRights } from '../../app/settings-model.ts';
import { useStore } from '../../data/store-context.tsx';
import { useSignal } from '../../data/use-signal.ts';
import { useWrites } from '../../data/write-context.tsx';
import { formatDate } from '../../lib/format.ts';
import { m } from '../../views/settings.messages.ts';
import { Badge } from '../ui/badge.tsx';
import { Button } from '../ui/button.tsx';
import { useDialogFocus } from './dialog-focus.ts';
import { type SectionFrame, SettingsSection, sectionId, toggleId } from './SettingsSection.tsx';
import { usersOf } from './settings-memos.ts';
import {
  AddUserDialog,
  CreateAgentDialog,
  RemoveUserDialog,
  RevokeKeyDialog,
} from './users-dialogs.tsx';

type Revoking = { handle: string; fingerprint: string };

function UserItem({
  user,
  admin,
  canRevoke,
  canRemove,
  onRevoke,
  onRemove,
}: {
  user: UserJson;
  admin: boolean;
  canRevoke: boolean;
  canRemove: boolean;
  onRevoke: (target: Revoking, trigger: HTMLElement) => void;
  onRemove: (handle: string, trigger: HTMLElement) => void;
}) {
  const { handle } = user;
  const active = user.fingerprints ?? [];
  const revoked = user.revoked ?? [];
  const Kind = user.kind === 'agent' ? Bot : User;
  return (
    <li aria-label={handle} className="space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <code className="font-mono text-sm font-medium">{handle}</code>
        <span className="text-sm">{user.name}</span>
        <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
          <Kind aria-hidden="true" className="size-4" />
          {user.kind === 'agent' ? m.kindAgent : m.kindHuman}
        </span>
        {admin && (
          <Badge variant="outline">
            <ShieldCheck aria-hidden="true" />
            {m.adminMark}
          </Badge>
        )}
        {user.operator !== undefined && (
          <span className="text-sm text-muted-foreground">{m.operatedBy(user.operator)}</span>
        )}
        {canRemove && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ml-auto"
            aria-label={m.removeUserOf(handle)}
            onClick={(e) => onRemove(handle, e.currentTarget)}
          >
            {m.removeUser}
          </Button>
        )}
      </div>
      {active.length === 0 ? (
        <p className="text-sm text-muted-foreground">{m.noActiveKey}</p>
      ) : (
        <ul aria-label={m.activeKeys} className="space-y-1">
          {active.map((fingerprint) => (
            <li key={fingerprint} className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 font-mono text-xs break-all">{fingerprint}</code>
              {canRevoke && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={m.revokeKeyOf(fingerprint)}
                  onClick={(e) => onRevoke({ handle, fingerprint }, e.currentTarget)}
                >
                  {m.revokeKey}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {revoked.length > 0 && (
        <ul aria-label={m.revokedKeys} className="space-y-1 text-muted-foreground">
          {revoked.map((r) => (
            <li key={r.fingerprint} className="flex flex-wrap items-center gap-2 text-xs">
              <s>
                <code className="font-mono break-all">{r.fingerprint}</code>
              </s>
              <span>{m.revokedAt(formatDate(r.revoked))}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * Abschnitt Users & Agents (ui.md §2.10): je User Handle, Name, Art, Operator und Keys. Aktionen
 * stehen nur da, wo die Policy sie für mich nicht sicher ablehnt (`settingsRights`); was dennoch
 * scheitert, meldet der Dialog wie jeden Fehler.
 */
export function UsersSection({ id, title, folded, onToggle }: SectionFrame) {
  const store = useStore();
  const { canWrite, me } = useWrites();
  const users = useSignal(usersOf(store));
  const config = useSignal(store.config);
  const admins = config ?? { admins: [] };
  const rights = settingsRights({ canWrite, me, users, config: admins });
  const canAdd = rights.addHuman || rights.addAgent !== false;
  const [adding, setAdding] = useState(false);
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<Revoking>();
  const [removing, setRemoving] = useState<string>();
  // Ein Key oder User, der per Patch verschwand und wiederkommt, öffnet den alten Dialog nicht wieder.
  const revokingOpen =
    revoking !== undefined &&
    users.some(
      (u) => u.handle === revoking.handle && (u.fingerprints ?? []).includes(revoking.fingerprint),
    );
  const removingOpen = removing !== undefined && users.some((u) => u.handle === removing);
  useEffect(() => {
    if (revoking !== undefined && !revokingOpen) setRevoking(undefined);
  }, [revoking, revokingOpen]);
  useEffect(() => {
    if (removing !== undefined && !removingOpen) setRemoving(undefined);
  }, [removing, removingOpen]);
  // Widerrufen und Entfernen nehmen ihren Auslöser mit; dann geht der Fokus an den ersten Knopf im
  // Kopf, und wer keinen hat (ein Agent widerruft den eigenen Key), an den Klappknopf.
  const addId = `${sectionId(id)}-add`;
  const createId = `${sectionId(id)}-create-agent`;
  const focus = useDialogFocus(canAdd ? addId : rights.createAgent ? createId : toggleId(id));
  const humans = users.filter((u) => u.kind === 'human');

  const actions =
    canAdd || rights.createAgent ? (
      <div className="flex flex-wrap items-center gap-2">
        {rights.createAgent && (
          <Button
            id={createId}
            type="button"
            variant="outline"
            size="sm"
            onClick={(e) => {
              focus.opened(e.currentTarget);
              setCreating(true);
            }}
          >
            {m.createAgent}
          </Button>
        )}
        {canAdd && (
          <Button
            id={addId}
            type="button"
            size="sm"
            onClick={(e) => {
              focus.opened(e.currentTarget);
              setAdding(true);
            }}
          >
            {m.addUser}
          </Button>
        )}
      </div>
    ) : undefined;

  return (
    <SettingsSection id={id} title={title} folded={folded} onToggle={onToggle} actions={actions}>
      <div className="max-w-3xl">
        {users.length === 0 ? (
          <p className="text-sm text-muted-foreground">{m.noUsers}</p>
        ) : (
          <ul aria-label={m.userList} className="space-y-2">
            {users.map((user) => (
              <UserItem
                key={user.handle}
                user={user}
                // `user.admin` folgt nur `admins`; Admin ist aber nur ein Mensch (BK §2.13).
                admin={isAdmin(admins, user.handle, user)}
                canRevoke={rights.revokeKey(user)}
                canRemove={rights.removeUser(user)}
                onRevoke={(target, trigger) => {
                  focus.opened(trigger);
                  setRevoking(target);
                }}
                onRemove={(handle, trigger) => {
                  focus.opened(trigger);
                  setRemoving(handle);
                }}
              />
            ))}
          </ul>
        )}
      </div>
      {adding && me !== null && (
        <AddUserDialog
          section={id}
          rights={rights}
          me={me}
          humans={humans}
          focus={focus}
          onOpenChange={setAdding}
        />
      )}
      {creating && <CreateAgentDialog section={id} focus={focus} onOpenChange={setCreating} />}
      {/* Verschwindet Key oder User per Patch, schließt sich sein Dialog mit. */}
      {revoking !== undefined && revokingOpen && (
        <RevokeKeyDialog
          handle={revoking.handle}
          fingerprint={revoking.fingerprint}
          focus={focus}
          onOpenChange={(o) => !o && setRevoking(undefined)}
        />
      )}
      {removing !== undefined && removingOpen && (
        <RemoveUserDialog
          handle={removing}
          focus={focus}
          onOpenChange={(o) => !o && setRemoving(undefined)}
        />
      )}
    </SettingsSection>
  );
}
