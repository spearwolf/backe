import { isSettled } from '@backe/core/state.ts';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useId } from 'react';
import type { DepTreeItem, DepTree as Tree } from '../../app/dep-graph.ts';
import { useLinkClick } from '../../app/router.ts';
import { routeHref } from '../../app/routes.ts';
import { cn } from '../../lib/utils.ts';
import { m } from '../../views/deps.messages.ts';
import { StateIcon } from '../StateIcon.tsx';

const SLOT = 'inline-flex size-6 shrink-0 items-center justify-center';

function Row(props: { item: DepTreeItem; backlog: string; onToggle: (key: string) => void }) {
  const { item, backlog, onToggle } = props;
  const go = useLinkClick();
  const { issue, id } = item;
  const settled = issue !== undefined && isSettled(issue.state);
  const href = routeHref({ kind: 'issue', backlog, id });

  return (
    <li>
      <div className="flex min-w-0 items-center gap-1 py-0.5">
        {item.expandable ? (
          <button
            type="button"
            className={cn(
              SLOT,
              'rounded-sm text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
            )}
            aria-expanded={item.open}
            aria-label={item.open ? m.hideTree(id) : m.showTree(id)}
            onClick={() => onToggle(item.key)}
          >
            {item.open ? (
              <ChevronDown aria-hidden="true" className="size-4" />
            ) : (
              <ChevronRight aria-hidden="true" className="size-4" />
            )}
          </button>
        ) : (
          <span className={SLOT} aria-hidden="true" />
        )}
        <span className="font-mono text-xs text-muted-foreground">{item.kind}</span>
        {issue && !item.cycle ? (
          <a
            href={href}
            onClick={go(href)}
            className="inline-flex min-w-0 items-center gap-2 rounded-sm text-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            <StateIcon state={issue.state} className="shrink-0 text-muted-foreground" />
            <span className="font-mono text-xs text-muted-foreground">{id}</span>
            {/* Erledigt: gedämpfter Titel statt Deckkraft; `muted-foreground` hält AA-Kontrast. */}
            <span className={cn('min-w-0 truncate', settled && 'text-muted-foreground')}>
              {issue.title}
            </span>
          </a>
        ) : (
          <span className="inline-flex items-baseline gap-2 text-sm">
            <span className="font-mono text-xs">{id}</span>
            <span className="italic text-muted-foreground">
              {issue === undefined ? m.missing : m.cycle}
            </span>
          </span>
        )}
      </div>
      {item.children.length > 0 && (
        <Items items={item.children} backlog={backlog} onToggle={onToggle} nested />
      )}
    </li>
  );
}

function Items(props: {
  items: DepTreeItem[];
  backlog: string;
  onToggle: (key: string) => void;
  labelledBy?: string;
  nested?: boolean;
}) {
  const { items, backlog, onToggle, labelledBy, nested } = props;
  return (
    <ul aria-labelledby={labelledBy} className={cn(nested && 'ml-6 border-l pl-2')}>
      {items.map((item) => (
        <Row key={item.key} item={item} backlog={backlog} onToggle={onToggle} />
      ))}
    </ul>
  );
}

/**
 * Die Abhängigkeiten als verschachtelte Listen: dieselben Daten wie der Graph, aber per Tab und
 * Screenreader zu bedienen. Keine eigene Tastaturlogik; Knöpfe und Links sind native Elemente.
 */
export function DepTree(props: { tree: Tree; backlog: string; onToggle: (key: string) => void }) {
  const { tree, backlog, onToggle } = props;
  const upId = useId();
  const downId = useId();
  return (
    <div className="flex flex-col gap-4">
      {tree.up.length > 0 && (
        <section>
          <h3 id={upId} className="mb-1 text-sm font-medium">
            {m.prerequisites}
          </h3>
          <Items items={tree.up} backlog={backlog} onToggle={onToggle} labelledBy={upId} />
        </section>
      )}
      {tree.down.length > 0 && (
        <section>
          <h3 id={downId} className="mb-1 text-sm font-medium">
            {m.dependents}
          </h3>
          <Items items={tree.down} backlog={backlog} onToggle={onToggle} labelledBy={downId} />
        </section>
      )}
      {tree.more > 0 && <p className="text-sm text-muted-foreground">{m.more(tree.more)}</p>}
    </div>
  );
}
