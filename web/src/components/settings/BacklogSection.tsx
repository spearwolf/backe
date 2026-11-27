import type { StateJson } from '@backe/ui/api.ts';
import { RefreshCw } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import { m as app } from '../../app/app.messages.ts';
import { type SyncOutcomeView, syncOutcomeView, syncStatusView } from '../../app/sync-status.ts';
import { useStore } from '../../data/store-context.tsx';
import { useSignal } from '../../data/use-signal.ts';
import { useWrites } from '../../data/write-context.tsx';
import { formatBytes, formatDate } from '../../lib/format.ts';
import { m } from '../../views/settings.messages.ts';
import { Button } from '../ui/button.tsx';
import { ActionError } from '../write/ActionError.tsx';
import { useAction } from '../write/use-action.ts';

type Config = StateJson['config'];

const yesNo = (v: boolean) => (v ? m.yes : m.no);

/** Beschreibungsliste in zwei Spalten; die Einträge sind `[Begriff, Wert]`. */
function Terms({ items }: { items: ReadonlyArray<readonly [string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
      {items.map(([term, value]) => (
        <div key={term} className="contents">
          <dt className="text-muted-foreground">{term}</dt>
          <dd className="min-w-0 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Properties({ props }: { props: Config['props'] }) {
  const headingId = useId();
  const entries = Object.entries(props);
  return (
    <div className="space-y-2">
      <h3 id={headingId} className="text-sm font-semibold">
        {m.properties}
      </h3>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">{m.noProperties}</p>
      ) : (
        <table aria-labelledby={headingId} className="w-full text-left text-sm">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-1 pr-4 font-normal">{m.propKey}</th>
              <th className="py-1 pr-4 font-normal">{m.propType}</th>
              <th className="py-1 font-normal">{m.propDescription}</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(([key, decl]) => (
              <tr key={key} className="border-t align-top">
                <td className="py-1 pr-4">
                  <code className="font-mono">{key}</code>
                </td>
                <td className="py-1 pr-4">
                  {decl.values === undefined
                    ? decl.type
                    : `${decl.type}: ${decl.values.join(', ')}`}
                </td>
                <td className="py-1">{decl.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** `backlog.jsonc` lesend; ändern geht nur von Hand und mit `backe commit` (ui.md §2.10). */
function ConfigBlock({ config }: { config: Config }) {
  const { sync, attachments } = config;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{m.configReadOnly}</p>
      <Terms
        items={[
          [m.name, config.name],
          [
            m.idPrefix,
            <code key="prefix" className="font-mono">
              {config.id_prefix}
            </code>,
          ],
          [m.admins, config.admins.join(', ')],
          [m.strictWorkflow, yesNo(config.workflow.strict)],
          [m.sync, m.syncSettings(sync.mode, sync.remote, sync.branch, sync.pull_interval)],
          [m.verify, config.verify],
          [
            m.attachments,
            attachments.max_bytes === null
              ? m.unlimited
              : m.maxBytes(formatBytes(attachments.max_bytes)),
          ],
          [m.lfs, yesNo(attachments.lfs)],
          [m.propsStrict, yesNo(config.props_strict)],
        ]}
      />
      <Properties props={config.props} />
    </div>
  );
}

function outcomeText(outcome: SyncOutcomeView): string {
  return outcome.skipped
    ? m.syncSkipped
    : m.syncDone(outcome.fetched, outcome.replayed, outcome.pushed);
}

/** »Jetzt synchronisieren« mit eigener Ergebnis- und Fehlerfläche. */
function SyncNow() {
  const { writes } = useWrites();
  const action = useAction();
  const [outcome, setOutcome] = useState<SyncOutcomeView>();
  const sync = () => {
    setOutcome(undefined);
    void action.run(async () => setOutcome(syncOutcomeView(await writes.run('sync_now', {}))));
  };
  return (
    <div className="space-y-2">
      <Button type="button" variant="outline" size="sm" disabled={action.busy} onClick={sync}>
        <RefreshCw aria-hidden="true" />
        {m.syncNow}
      </Button>
      {/* Die Live-Region steht immer da: Erst eingefügte Regionen lesen Screenreader oft nicht vor. */}
      <div role="status" className="text-sm">
        {outcome !== undefined && (
          <>
            <p>{outcomeText(outcome)}</p>
            {outcome.notices.length > 0 && (
              <ul className="list-disc pl-5 text-muted-foreground">
                {outcome.notices.map((notice) => (
                  <li key={notice}>{notice}</li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
      <ActionError error={action.error} />
    </div>
  );
}

/** Sync-Status und Konflikte (BK §2.16.4); Konflikte lösen bleibt im CLI. */
function SyncBlock({ sync, canWrite }: { sync: Record<string, unknown>; canWrite: boolean }) {
  const status = syncStatusView(sync);
  const when = (iso: string | null) => (iso === null ? m.never : formatDate(iso));
  return (
    <div className="space-y-3">
      <Terms
        items={[
          [m.remote, status.remote ?? m.noRemote],
          [m.mode, status.mode],
          [m.unpushed, String(status.unpushed)],
          [m.lastAttempt, when(status.lastAttempt)],
          [m.lastSuccess, when(status.lastSuccess)],
          [m.lastError, status.lastError ?? m.none],
          [m.running, yesNo(status.running)],
        ]}
      />
      {status.conflicts.length > 0 && (
        <div className="space-y-2">
          <ul aria-label={m.conflicts} className="space-y-2 text-sm">
            {status.conflicts.map((c) => (
              <li key={c.id} className="rounded-md border p-2">
                <div className="flex flex-wrap gap-x-3">
                  <code className="font-mono">{c.id}</code>
                  {c.created !== null && (
                    <span className="text-muted-foreground">{formatDate(c.created)}</span>
                  )}
                </div>
                <p>{c.subject}</p>
                <p className="text-muted-foreground">{c.reason}</p>
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted-foreground">
            {m.resolveHint} <code className="font-mono text-foreground">backe sync resolve</code>
          </p>
        </div>
      )}
      {canWrite && <SyncNow />}
    </div>
  );
}

/** Abschnitt Backlog (ui.md §2.10): Config lesend, Sync-Status, mit Schreibrecht `sync_now`. */
export function BacklogSection() {
  const store = useStore();
  const config = useSignal(store.config);
  const sync = useSignal(store.sync);
  const { canWrite } = useWrites();
  if (config === undefined) return <p className="text-sm text-muted-foreground">{app.loading}</p>;
  return (
    <div className="max-w-3xl space-y-6">
      <ConfigBlock config={config} />
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">{m.syncStatus}</h3>
        {sync === null ? (
          <p className="text-sm text-muted-foreground">{m.noWorkingCopy}</p>
        ) : (
          <SyncBlock sync={sync} canWrite={canWrite} />
        )}
      </div>
    </div>
  );
}
