import { Plus } from 'lucide-react';
import { useId } from 'react';
import { BOARD_GROUPS, type BoardGroup, type BoardView } from '../../app/board-model.ts';
import { EMPTY_DRAFT } from '../../app/create-draft.ts';
import { m } from '../../views/board.messages.ts';
import { Button } from '../ui/button.tsx';
import { useCreateIssue } from '../write/create-context.tsx';
import { m as w } from '../write/write.messages.ts';

const GROUP_LABEL: Record<BoardGroup, () => string> = {
  sprint: () => m.groupSprint,
  project: () => m.groupProject,
  repo: () => m.groupRepo,
  none: () => m.groupNone,
};

/** Werkzeugleiste des Boards: Gruppierung, Spalte `backlog`, mit Schreibrecht »Neues Issue«. */
export function BoardToolbar({
  view,
  onView,
}: {
  view: BoardView;
  onView: (next: BoardView) => void;
}) {
  const create = useCreateIssue();
  const groupId = useId();
  return (
    <div className="flex flex-wrap items-center gap-4 border-b p-3 text-sm">
      <span className="flex items-center gap-2">
        {/* `htmlFor` statt Umschließen: Sonst trüge der Name der Auswahl auch die gewählte Option. */}
        <label htmlFor={groupId}>{m.lanes}</label>
        <select
          id={groupId}
          className="h-8 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
          value={view.group}
          onChange={(e) => onView({ ...view, group: e.target.value as BoardGroup })}
        >
          {BOARD_GROUPS.map((group) => (
            <option key={group} value={group}>
              {GROUP_LABEL[group]()}
            </option>
          ))}
        </select>
      </span>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          className="size-4 accent-foreground"
          checked={view.showBacklog}
          onChange={(e) => onView({ ...view, showBacklog: e.target.checked })}
        />
        {m.showBacklog}
      </label>
      {create !== undefined && (
        <Button
          size="sm"
          className="ml-auto"
          // Der Knopf selbst als Rückkehr: Nicht jeder Browser fokussiert einen geklickten Knopf.
          onClick={(e) => {
            const button = e.currentTarget;
            create.open(EMPTY_DRAFT, () => button);
          }}
        >
          <Plus aria-hidden="true" />
          {w.newIssue}
        </Button>
      )}
    </div>
  );
}
