import { isGitRef, isRepoName } from '@backe/core/names.ts';
import type { RepoCheckJson, RepoJson } from '@backe/ui/api.ts';
import { CircleX, Info, TriangleAlert } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { EMPTY_FILTER, listFilterSearch } from '../../app/list-filter.ts';
import { useLinkClick } from '../../app/router.ts';
import { routeHref } from '../../app/routes.ts';
import type { SettingsSection as Section } from '../../app/settings-model.ts';
import { repoReferences } from '../../app/settings-model.ts';
import { useStore } from '../../data/store-context.tsx';
import { useSignal } from '../../data/use-signal.ts';
import { useWrites } from '../../data/write-context.tsx';
import { formatDate } from '../../lib/format.ts';
import { Markdown } from '../../markdown/index.tsx';
import { m } from '../../views/settings.messages.ts';
import { IssueRef } from '../issue/IssueRef.tsx';
import { RepoPath } from '../issue/RepoPath.tsx';
import { Button } from '../ui/button.tsx';
import { Input } from '../ui/input.tsx';
import { Textarea } from '../ui/textarea.tsx';
import { ActionError } from '../write/ActionError.tsx';
import { ConfirmDialog } from '../write/ConfirmDialog.tsx';
import { useAction } from '../write/use-action.ts';
import { type DialogFocus, useDialogFocus } from './dialog-focus.ts';
import { Field, FormSubmitShim } from './fields.tsx';
import { type SectionFrame, SettingsSection, sectionId } from './SettingsSection.tsx';

type Level = RepoCheckJson['repos'][number]['findings'][number]['level'];

const LEVELS: Record<Level, { icon: typeof Info; label: () => string; destructive: boolean }> = {
  error: { icon: CircleX, label: () => m.levelError, destructive: true },
  warning: { icon: TriangleAlert, label: () => m.levelWarning, destructive: false },
  info: { icon: Info, label: () => m.levelInfo, destructive: false },
};

/** Dialog »Hinzufügen«; nur zum Öffnen gemountet, damit jedes Mal leer begonnen wird. */
function AddDialog({
  section,
  focus,
  onOpenChange,
}: {
  section: Section;
  focus: DialogFocus;
  onOpenChange: (open: boolean) => void;
}) {
  const { writes } = useWrites();
  const { busy, error, run } = useAction();
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [ref, setRef] = useState('');
  const [body, setBody] = useState('');
  const formId = `${sectionId(section)}-add-form`;
  const nameError = name !== '' && !isRepoName(name) ? m.invalidRepoName : undefined;
  const refError = ref !== '' && !isGitRef(ref) ? m.invalidRepoRef : undefined;
  const blocked = url.trim() === '' || nameError !== undefined || refError !== undefined;

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (blocked) return;
    // Leere optionale Felder gehen nicht mit: Der Server leitet den Namen selbst ab.
    const args = {
      url: url.trim(),
      ...(name === '' ? {} : { name }),
      ...(ref === '' ? {} : { ref }),
      ...(body.trim() === '' ? {} : { body }),
    };
    void run(() => writes.run('repo_add', args)).then((ok) => {
      if (ok) onOpenChange(false);
    });
  };

  return (
    <ConfirmDialog
      open
      title={m.addRepoTitle}
      confirmLabel={m.addRepo}
      busy={busy}
      confirmDisabled={blocked}
      error={error}
      formId={formId}
      onOpenChange={onOpenChange}
      onCloseAutoFocus={focus.onCloseAutoFocus}
    >
      <form id={formId} onSubmit={submit} className="space-y-3">
        <FormSubmitShim disabled={blocked || busy} />
        <Field label={m.repoUrl}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              value={url}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              onChange={(e) => setUrl(e.target.value)}
              disabled={busy}
              autoFocus
            />
          )}
        </Field>
        <Field
          label={m.repoName}
          hint={m.repoNameHint}
          {...(nameError ? { error: nameError } : {})}
        >
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              value={name}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
              className="font-mono"
            />
          )}
        </Field>
        <Field label={m.repoRef} hint={m.repoRefHint} {...(refError ? { error: refError } : {})}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              value={ref}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              onChange={(e) => setRef(e.target.value)}
              disabled={busy}
              className="font-mono"
            />
          )}
        </Field>
        <Field label={m.repoDescription}>
          {({ id, describedBy, invalid }) => (
            <Textarea
              id={id}
              value={body}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              onChange={(e) => setBody(e.target.value)}
              disabled={busy}
              rows={4}
            />
          )}
        </Field>
      </form>
    </ConfirmDialog>
  );
}

function ReferencingIssue({ id }: { id: string }) {
  const { backlog } = useWrites();
  const issue = useSignal(useStore().issues.get(id));
  return <IssueRef issue={issue ?? { id, missing: true }} backlog={backlog} />;
}

/** Bestätigung zum Entfernen; solange Issues das Repo nennen, bleibt »Entfernen« gesperrt. */
function RemoveDialog({
  name,
  focus,
  onOpenChange,
}: {
  name: string;
  focus: DialogFocus;
  onOpenChange: (o: boolean) => void;
}) {
  const { writes } = useWrites();
  const store = useStore();
  // Der Snapshot ist ein Memo über alle Issues (stabil, solange sich nichts ändert): Auch ein Patch
  // auf `repos` eines bestehenden Issues rechnet ihn neu und rendert den Dialog.
  const snapshot = useSignal(store.toSnapshot);
  const references = repoReferences(
    snapshot === undefined ? [] : [...snapshot.issues.values()].map((e) => e.data),
    name,
  );
  const { busy, error, run } = useAction();
  return (
    <ConfirmDialog
      open
      destructive
      title={m.removeRepoTitle(name)}
      confirmLabel={m.removeRepo}
      busy={busy}
      confirmDisabled={references.length > 0}
      error={error}
      onConfirm={() => {
        // Mit dem Repo verschwindet seine Zeile samt Auslöser (siehe `useDialogFocus`).
        focus.arm(true);
        void run(() => writes.run('repo_rm', { name })).then((ok) => {
          if (ok) onOpenChange(false);
          else focus.arm(false);
        });
      }}
      onOpenChange={onOpenChange}
      onCloseAutoFocus={focus.onCloseAutoFocus}
    >
      {references.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm">{m.repoStillReferenced}</p>
          <ul className="space-y-1">
            {references.map((id) => (
              <li key={id}>
                <ReferencingIssue id={id} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </ConfirmDialog>
  );
}

function RepoRow({
  name,
  canWrite,
  onRemove,
}: {
  name: string;
  canWrite: boolean;
  onRemove: (name: string, trigger: HTMLElement) => void;
}) {
  const store = useStore();
  const repo: RepoJson | undefined = useSignal(store.repos.get(name));
  const { backlog } = useWrites();
  const go = useLinkClick();
  if (repo === undefined) return null;
  const href =
    routeHref({ kind: 'backlog', backlog }) + listFilterSearch({ ...EMPTY_FILTER, repos: [name] });
  return (
    <li className="space-y-1 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <a
          href={href}
          onClick={go(href)}
          className="rounded-sm font-mono text-sm font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          {name}
        </a>
        <span className="min-w-0 break-all text-sm text-muted-foreground">{repo.url}</span>
        {repo.default_ref !== undefined && (
          <code className="font-mono text-xs">{repo.default_ref}</code>
        )}
        {canWrite && (
          <span className="ml-auto flex items-center gap-2">
            <RepoPath name={name} />
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={m.removeRepoOf(name)}
              onClick={(e) => onRemove(name, e.currentTarget)}
            >
              {m.removeRepo}
            </Button>
          </span>
        )}
      </div>
      {repo.body !== undefined && repo.body.trim() !== '' && (
        <Markdown source={repo.body} backlog={backlog} className="text-sm" />
      )}
    </li>
  );
}

function summary(result: RepoCheckJson): string {
  const findings = result.repos.reduce((n, repo) => n + repo.findings.length, 0);
  return findings === 0 ? m.checkClean : m.checkFindings(findings);
}

function CheckResult({ result }: { result: RepoCheckJson }) {
  return (
    <section aria-label={m.checkResults} className="space-y-3">
      <ul className="space-y-2">
        {result.repos.map((repo) => (
          <li
            key={repo.name}
            aria-label={repo.name}
            className="space-y-1 rounded-md border p-3 text-sm"
          >
            <span className="font-mono font-medium">{repo.name}</span>
            {repo.findings.length === 0 ? (
              <p className="text-muted-foreground">{m.checkClean}</p>
            ) : (
              <ul className="space-y-0.5">
                {repo.findings.map((f, i) => {
                  const { icon: Icon, label, destructive } = LEVELS[f.level];
                  return (
                    // biome-ignore lint/suspicious/noArrayIndexKey: feste Liste einer Antwort, nie umsortiert; Befunde können sich wiederholen
                    <li key={i} className="flex items-start gap-2">
                      <Icon
                        aria-hidden="true"
                        className={`mt-0.5 size-4 shrink-0 ${destructive ? 'text-destructive' : 'text-muted-foreground'}`}
                      />
                      <span className="font-medium">{label()}</span>
                      <span>{f.message}</span>
                    </li>
                  );
                })}
              </ul>
            )}
            {repo.github !== undefined && (
              <p className="text-muted-foreground">
                {m.githubInfo(repo.github.visibility, repo.github.archived)}
              </p>
            )}
            {repo.cached !== undefined && (
              <p className="text-muted-foreground">{m.cachedFrom(formatDate(repo.cached))}</p>
            )}
          </li>
        ))}
      </ul>
      {result.notices !== undefined && result.notices.length > 0 && (
        <div className="space-y-1 text-sm">
          <h3 className="font-semibold">{m.checkNotices}</h3>
          <ul className="list-disc pl-5 text-muted-foreground">
            {result.notices.map((n, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: feste Liste einer Antwort, nie umsortiert; Texte können sich wiederholen
              <li key={i}>{n.message}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/**
 * Abschnitt Repositories (ui.md §2.10): Liste mit Beschreibung, mit Schreibrecht lokalem Pfad,
 * »Hinzufügen«, »Entfernen« und »Prüfen«. Er setzt seinen Rahmen selbst, weil die Aktionen im Kopf
 * stehen und das Prüf-Ergebnis (flüchtig, nur hier im Zustand) im Körper.
 */
export function ReposSection({ id, title, folded, onToggle }: SectionFrame) {
  const store = useStore();
  const { writes, canWrite } = useWrites();
  const keys = useSignal(store.repos.keys);
  const names = [...keys].sort();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string>();
  const [remote, setRemote] = useState(false);
  const [result, setResult] = useState<RepoCheckJson>();
  const check = useAction();
  // Ein Repo, das per Patch verschwand und wiederkommt, öffnet den alten Dialog nicht wieder.
  useEffect(() => {
    if (removing !== undefined && !keys.includes(removing)) setRemoving(undefined);
  }, [removing, keys]);
  // Nach einem Entfernen verschwindet der Auslöser mit der Zeile; der Fokus geht an »Hinzufügen«.
  const addId = `${sectionId(id)}-add`;
  const focus = useDialogFocus(addId);
  const openRemove = (name: string, trigger: HTMLElement): void => {
    focus.opened(trigger);
    setRemoving(name);
  };

  const runCheck = (): void => {
    // Status und Ergebnis stehen im Körper; ein eingeklappter Abschnitt klappt dafür auf.
    if (folded) onToggle();
    void check.run(async () =>
      setResult(await writes.run('repo_check', remote ? { remote: true } : {})),
    );
  };

  const actions = canWrite ? (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={remote}
          className="size-4 accent-primary"
          onChange={(e) => setRemote(e.target.checked)}
        />
        {m.checkRemote}
      </label>
      <Button type="button" variant="outline" size="sm" disabled={check.busy} onClick={runCheck}>
        {m.checkRepos}
      </Button>
      <Button
        id={addId}
        type="button"
        size="sm"
        onClick={(e) => {
          focus.opened(e.currentTarget);
          setAdding(true);
        }}
      >
        {m.addRepo}
      </Button>
    </div>
  ) : undefined;

  const overlays = (
    <>
      {adding && <AddDialog section={id} focus={focus} onOpenChange={setAdding} />}
      {/* Verschwindet das Repo per Patch, schließt sich der Dialog mit ihm. */}
      {removing !== undefined && keys.includes(removing) && (
        <RemoveDialog
          name={removing}
          focus={focus}
          onOpenChange={(open) => !open && setRemoving(undefined)}
        />
      )}
    </>
  );

  return (
    <SettingsSection
      id={id}
      title={title}
      folded={folded}
      onToggle={onToggle}
      actions={actions}
      overlays={overlays}
    >
      <div className="max-w-3xl space-y-4">
        {names.length === 0 ? (
          <p className="text-sm text-muted-foreground">{m.noRepos}</p>
        ) : (
          <ul aria-label={m.repoList} className="space-y-2">
            {names.map((name) => (
              <RepoRow key={name} name={name} canWrite={canWrite} onRemove={openRemove} />
            ))}
          </ul>
        )}
        {/* Nur die Zusammenfassung ist Live-Region; die Liste liest, wer sie ansteuert. Die Region steht immer da. */}
        <p role="status" className="text-sm font-medium">
          {result === undefined ? '' : summary(result)}
        </p>
        {result !== undefined && <CheckResult result={result} />}
        <ActionError error={check.error} />
      </div>
    </SettingsSection>
  );
}
