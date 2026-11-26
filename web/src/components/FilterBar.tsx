import { ALL_STATES } from '@backe/core/state.ts';
import { ChevronDown, X } from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useState } from 'react';
import { m as app } from '../app/app.messages.ts';
import {
  EMPTY_FILTER,
  type FilterError,
  LIST_MODES,
  type ListFilter,
  type ListView,
} from '../app/list-filter.ts';
import { useStore } from '../data/store-context.tsx';
import { useSignal } from '../data/use-signal.ts';
import { m } from '../views/backlog.messages.ts';
import { Button } from './ui/button.tsx';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu.tsx';
import { Input } from './ui/input.tsx';

type Option = { value: string; label?: string; depth?: number };

const keepOpen = (e: Event) => e.preventDefault();
const toggle = (values: readonly string[], value: string, on: boolean) =>
  on ? [...values, value] : values.filter((v) => v !== value);

function Trigger({ label, active, invalid }: { label: string; active?: string; invalid: boolean }) {
  return (
    <DropdownMenuTrigger asChild>
      <Button variant="outline" size="sm" aria-invalid={invalid || undefined}>
        {label}
        {active !== undefined && (
          <span className="font-normal text-muted-foreground">{active}</span>
        )}
        <ChevronDown aria-hidden="true" />
      </Button>
    </DropdownMenuTrigger>
  );
}

/** Mehrfachauswahl; Werte sind ODER-verknüpft (ui.md §2.7). */
function MultiFilter(props: {
  label: string;
  values: readonly string[];
  options: readonly Option[];
  invalid: boolean;
  onChange: (values: string[]) => void;
  extra?: ReactNode;
}) {
  const { label, values, options, invalid, onChange, extra } = props;
  return (
    <DropdownMenu>
      <Trigger
        label={label}
        invalid={invalid}
        {...(values.length > 0 ? { active: values.join(', ') } : {})}
      />
      <DropdownMenuContent align="start" className="max-h-80 overflow-auto">
        {options.map((o) => (
          <DropdownMenuCheckboxItem
            key={o.value}
            checked={values.includes(o.value)}
            onSelect={keepOpen}
            onCheckedChange={(on) => onChange(toggle(values, o.value, on === true))}
            style={o.depth ? { paddingLeft: `${0.5 + o.depth}rem` } : undefined}
          >
            {o.label ?? o.value}
          </DropdownMenuCheckboxItem>
        ))}
        {extra}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Einfachauswahl mit »beliebig«. */
function SingleFilter(props: {
  label: string;
  value: string | undefined;
  options: readonly string[];
  invalid: boolean;
  onChange: (value: string | undefined) => void;
}) {
  const { label, value, options, invalid, onChange } = props;
  return (
    <DropdownMenu>
      <Trigger
        label={label}
        invalid={invalid}
        {...(value !== undefined ? { active: value } : {})}
      />
      <DropdownMenuContent align="start" className="max-h-80 overflow-auto">
        <DropdownMenuRadioGroup
          value={value ?? ''}
          onValueChange={(v) => onChange(v === '' ? undefined : v)}
        >
          <DropdownMenuRadioItem value="">{m.anyValue}</DropdownMenuRadioItem>
          {options.map((o) => (
            <DropdownMenuRadioItem key={o} value={o}>
              {o}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Ausdrücke als Chips; Enter fügt hinzu, `×` entfernt. */
function ExprFilter(props: {
  label: string;
  placeholder: string;
  values: readonly string[];
  invalid: readonly string[];
  onChange: (values: string[]) => void;
}) {
  const { label, placeholder, values, invalid, onChange } = props;
  const [draft, setDraft] = useState('');
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    const value = draft.trim();
    if (e.key !== 'Enter' || value === '') return;
    e.preventDefault();
    if (!values.includes(value)) onChange([...values, value]);
    setDraft('');
  };
  return (
    <span className="flex flex-wrap items-center gap-1">
      {values.map((v) => (
        <span
          key={v}
          aria-invalid={invalid.includes(v) || undefined}
          className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-xs aria-invalid:border-destructive"
        >
          {v}
          <button
            type="button"
            aria-label={m.removeValue(v)}
            onClick={() => onChange(values.filter((x) => x !== v))}
            className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-3" aria-hidden="true" />
          </button>
        </span>
      ))}
      <Input
        aria-label={label}
        placeholder={placeholder}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKey}
        className="h-8 w-48 font-mono text-xs"
      />
    </span>
  );
}

function Toggle(props: { pressed: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Button
      variant={props.pressed ? 'secondary' : 'ghost'}
      size="sm"
      aria-pressed={props.pressed}
      onClick={props.onClick}
      className={props.pressed ? 'font-semibold' : ''}
    >
      {props.children}
    </Button>
  );
}

type Props = {
  filter: ListFilter;
  errors: readonly FilterError[];
  view: ListView;
  count: number;
  bodySearch: 'idle' | 'pending' | 'failed';
  onFilter: (next: ListFilter) => void;
  onView: (next: ListView) => void;
};

/** Filterleiste des Tabs Backlog mit der Semantik von `issue list` (ui.md §2.7). */
export function FilterBar({ filter, errors, view, count, bodySearch, onFilter, onView }: Props) {
  const store = useStore();
  const projects = useSignal(store.projects.keys);
  const sprints = useSignal(store.sprints.keys);
  const repos = useSignal(store.repos.keys);
  const users = useSignal(store.users.keys);
  const bad = (field: keyof ListFilter) => errors.filter((e) => e.field === field);
  const set = (patch: Partial<ListFilter>) => onFilter({ ...filter, ...patch });

  const all = filter.states.includes('all');
  const stateExtra = (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuCheckboxItem
        checked={filter.states.length === 0}
        onSelect={keepOpen}
        onCheckedChange={() => set({ states: [] })}
      >
        {m.stateOpen}
      </DropdownMenuCheckboxItem>
      <DropdownMenuCheckboxItem
        checked={all}
        onSelect={keepOpen}
        onCheckedChange={(on) => set({ states: on ? ['all'] : [] })}
      >
        {m.stateAll}
      </DropdownMenuCheckboxItem>
    </>
  );
  const projectExtra = (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuCheckboxItem
        checked={filter.exact}
        onSelect={keepOpen}
        onCheckedChange={(on) => set({ exact: on === true })}
      >
        {m.exact}
      </DropdownMenuCheckboxItem>
    </>
  );
  const sorted = [...projects].sort();
  const handles = [...users].sort();

  return (
    <div className="space-y-2 border-b p-3">
      <fieldset
        aria-label={m.filters}
        className="m-0 flex min-w-0 flex-wrap items-center gap-2 border-0 p-0"
      >
        <MultiFilter
          label={m.filterState}
          values={all ? [] : filter.states}
          options={ALL_STATES.map((value) => ({ value }))}
          invalid={bad('states').length > 0}
          onChange={(states) => set({ states })}
          extra={stateExtra}
        />
        <MultiFilter
          label={m.filterProject}
          values={filter.projects}
          options={sorted.map((value) => ({ value, depth: value.split('/').length - 1 }))}
          invalid={false}
          onChange={(projects) => set({ projects })}
          extra={projectExtra}
        />
        <MultiFilter
          label={m.filterSprint}
          values={filter.sprints}
          options={[...sprints].sort().map((value) => ({ value }))}
          invalid={false}
          onChange={(sprints) => set({ sprints })}
        />
        <MultiFilter
          label={m.filterRepo}
          values={filter.repos}
          options={[...repos].sort().map((value) => ({ value }))}
          invalid={false}
          onChange={(repos) => set({ repos })}
        />
        <SingleFilter
          label={m.filterAssignee}
          value={filter.assignee}
          options={['me', 'none', ...handles]}
          invalid={bad('assignee').length > 0}
          onChange={(assignee) => onFilter(without({ ...filter, assignee }, 'assignee'))}
        />
        <SingleFilter
          label={m.filterCreator}
          value={filter.creator}
          options={['me', ...handles]}
          invalid={bad('creator').length > 0}
          onChange={(creator) => onFilter(without({ ...filter, creator }, 'creator'))}
        />
        <SingleFilter
          label={m.filterMode}
          value={filter.mode}
          options={LIST_MODES}
          invalid={bad('mode').length > 0}
          onChange={(mode) => onFilter(without({ ...filter, mode }, 'mode'))}
        />
        <Input
          type="search"
          aria-label={m.filterText}
          placeholder={m.filterText}
          value={filter.text}
          onChange={(e) => set({ text: e.target.value })}
          className="h-8 w-64"
        />
        <Button variant="ghost" size="sm" onClick={() => onFilter(EMPTY_FILTER)}>
          {m.resetFilters}
        </Button>
      </fieldset>
      <div className="flex flex-wrap items-center gap-2">
        <ExprFilter
          label={m.filterProps}
          placeholder={m.propsPlaceholder}
          values={filter.props}
          invalid={bad('props').map((e) => e.value)}
          onChange={(props) => set({ props })}
        />
        <ExprFilter
          label={m.filterHasProps}
          placeholder={m.filterHasProps}
          values={filter.hasProps}
          invalid={[]}
          onChange={(hasProps) => set({ hasProps })}
        />
        <span className="ml-auto flex items-center gap-1">
          <Toggle pressed={view.tree} onClick={() => onView({ ...view, tree: true })}>
            {m.viewTree}
          </Toggle>
          <Toggle pressed={!view.tree} onClick={() => onView({ ...view, tree: false })}>
            {m.viewFlat}
          </Toggle>
          <span aria-hidden="true" className="mx-1 h-4 border-l" />
          <Toggle pressed={view.sort === 'rank'} onClick={() => onView({ ...view, sort: 'rank' })}>
            {m.sortRank}
          </Toggle>
          <Toggle
            pressed={view.sort === 'created'}
            onClick={() => onView({ ...view, sort: 'created' })}
          >
            {m.sortCreated}
          </Toggle>
          <span className="ml-2 text-sm text-muted-foreground tabular-nums">
            {app.issueCount(count)}
            {bodySearch === 'failed' && ` · ${m.titleOnly}`}
          </span>
        </span>
      </div>
      {errors.length > 0 && (
        <ul aria-live="polite" className="space-y-0.5 text-sm text-destructive">
          {errors.map((e) => (
            <li key={`${e.field}:${e.value}`}>{e.message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Entfernt ein auf `undefined` gesetztes optionales Feld, damit die URL es weglässt. */
function without(f: ListFilter, key: 'assignee' | 'creator' | 'mode'): ListFilter {
  if (f[key] !== undefined) return f;
  const { [key]: _gone, ...rest } = f;
  return rest;
}
