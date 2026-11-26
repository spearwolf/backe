/**
 * Anlegen von überall (ui.md §2.12): `useCreateIssue()` öffnet den Dialog mit einem Entwurf, die
 * Taste `c` mit dem Filter des Tabs Backlog bzw. leer (ui.md §2.6). Ohne Schreibrecht gibt es
 * weder Dialog noch Kürzel, und `useCreateIssue()` liefert `undefined`.
 */
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { type CreateDraft, draftFromFilter, EMPTY_DRAFT } from '../../app/create-draft.ts';
import { parseListFilter } from '../../app/list-filter.ts';
import { useRouter } from '../../app/router.ts';
import { parseRoute } from '../../app/routes.ts';
import { useWrites } from '../../data/write-context.tsx';
import { CreateIssueDialog } from './CreateIssueDialog.tsx';

export type CreateIssue = { open(draft?: CreateDraft): void };

const CreateIssueContext = createContext<CreateIssue | undefined>(undefined);

export function useCreateIssue(): CreateIssue | undefined {
  return useContext(CreateIssueContext);
}

const TYPING = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

/**
 * `c` ohne Modifier, nicht beim Tippen und nicht, solange ein Dialog oder Menü offen ist: Dort ist
 * `c` ein Buchstabe oder die Typeahead-Suche des Menüs.
 */
function isCreateKey(e: KeyboardEvent): boolean {
  if (e.key !== 'c' || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return false;
  if (e.repeat || e.isComposing || e.defaultPrevented) return false;
  if (e.target instanceof Element && e.target.closest(TYPING) !== null) return false;
  return document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]') === null;
}

export function CreateIssueProvider({ children }: { children: ReactNode }) {
  const { canWrite, me } = useWrites();
  const router = useRouter();
  // Jedes Öffnen ist ein neuer Dialog mit frischem Zustand, auch ein zweites `open` bei offenem.
  const [opened, setOpened] = useState<{ draft: CreateDraft; serial: number }>();
  const open = useCallback((draft: CreateDraft = EMPTY_DRAFT) => {
    setOpened((prev) => ({ draft, serial: (prev?.serial ?? 0) + 1 }));
  }, []);
  const value = useMemo(() => (canWrite ? { open } : undefined), [canWrite, open]);

  useEffect(() => {
    if (!canWrite) return;
    const onKey = (e: KeyboardEvent): void => {
      if (!isCreateKey(e)) return;
      // Sonst landet das `c` im Titelfeld, das der Dialog gleich fokussiert.
      e.preventDefault();
      const { pathname, search } = router.location.value;
      open(
        parseRoute(pathname).kind === 'backlog'
          ? draftFromFilter(parseListFilter(search), me)
          : EMPTY_DRAFT,
      );
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [canWrite, me, router, open]);

  return (
    <CreateIssueContext.Provider value={value}>
      {children}
      {canWrite && opened !== undefined && (
        <CreateIssueDialog
          key={opened.serial}
          initial={opened.draft}
          onClose={() => setOpened(undefined)}
        />
      )}
    </CreateIssueContext.Provider>
  );
}
