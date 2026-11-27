import { isSettled } from '@backe/core/state.ts';
import { Handle, type Node, type NodeProps, Position } from '@xyflow/react';
import type { CSSProperties } from 'react';
import type { DepNode } from '../../app/dep-graph.ts';
import { useLinkClick } from '../../app/router.ts';
import { routeHref } from '../../app/routes.ts';
import { cn } from '../../lib/utils.ts';
import { m } from '../../views/deps.messages.ts';
import { StateIcon } from '../StateIcon.tsx';

export type IssueNodeData = {
  node: DepNode;
  backlog: string;
  /** Knoten im Sammelknoten; mit Sammelknoten klappt nichts weiter auf. */
  more: number;
  onToggle: (id: string) => void;
};
export type IssueFlowNode = Node<IssueNodeData, 'issue'>;
export type MoreFlowNode = Node<{ count: number }, 'more'>;

/**
 * xyflow setzt `pointer-events: none` auf Knoten, die weder ziehbar noch auswählbar sind; Links
 * und Knöpfe darin brauchen die Ereignisse zurück. Inline, weil auch jsdom es lesen muss.
 */
const POINTER: CSSProperties = { pointerEvents: 'auto' };

const BOX = 'flex h-full w-full items-stretch rounded-md border bg-card text-card-foreground';
const BUTTON =
  'nopan rounded-sm px-1 font-mono text-xs leading-none text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring';

/** Unsichtbare Andockpunkte: Kanten kommen oben an und gehen unten ab. */
function Handles() {
  return (
    <>
      <Handle type="target" position={Position.Top} isConnectable={false} className="invisible" />
      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        className="invisible"
      />
    </>
  );
}

/** Ein Issue im Graphen: State, ID, gekürzter Titel; Link auf den Issue-Tab außer bei der Mitte. */
export function DepIssueNode({ data }: NodeProps<IssueFlowNode>) {
  const { node, backlog, more, onToggle } = data;
  const go = useLinkClick();
  const { id, issue, role } = node;
  const centre = role === 'center';
  const missing = issue === undefined;
  const canExpand = node.hidden > 0 && more === 0 && !centre && !missing;

  const body = (
    <>
      <span className="flex min-w-0 items-center gap-2">
        {issue && <StateIcon state={issue.state} className="shrink-0 text-muted-foreground" />}
        <span className="font-mono text-xs text-muted-foreground">{id}</span>
        {centre && <span className="text-xs text-muted-foreground">{m.current}</span>}
      </span>
      {issue ? (
        <span className="min-w-0 truncate text-sm" title={issue.title}>
          {issue.title}
        </span>
      ) : (
        <span className="text-sm italic text-muted-foreground">{m.missing}</span>
      )}
      {node.open && <span className="sr-only">{m.openPrerequisite}</span>}
    </>
  );
  const bodyClass = 'flex min-w-0 flex-1 flex-col justify-center gap-0.5 px-2 py-1';

  let content = <div className={bodyClass}>{body}</div>;
  if (!centre && !missing) {
    const href = routeHref({ kind: 'issue', backlog, id });
    content = (
      <a
        href={href}
        onClick={go(href)}
        className={cn(
          bodyClass,
          'rounded-md outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
        )}
      >
        {body}
      </a>
    );
  }

  return (
    <div
      data-dep-node={id}
      data-role={role}
      aria-current={centre ? 'true' : undefined}
      style={POINTER}
      className={cn(
        BOX,
        centre && 'bg-accent ring-2 ring-ring',
        issue && isSettled(issue.state) && 'opacity-60',
        node.open && 'border-2 border-foreground',
      )}
    >
      <Handles />
      {content}
      {(canExpand || node.expanded) && (
        <span className="flex flex-col justify-center gap-1 pr-1">
          {canExpand && (
            <button
              type="button"
              className={BUTTON}
              aria-label={m.expand(id, node.hidden)}
              onClick={() => onToggle(id)}
            >
              +{node.hidden}
            </button>
          )}
          {node.expanded && (
            <button
              type="button"
              className={BUTTON}
              aria-label={m.collapse(id)}
              onClick={() => onToggle(id)}
            >
              −
            </button>
          )}
        </span>
      )}
    </div>
  );
}

/** Sammelknoten: nennt nur die Zahl der nicht gezeigten Issues. */
export function DepMoreNode({ data }: NodeProps<MoreFlowNode>) {
  return (
    <div
      data-dep-node="more"
      className={cn(BOX, 'items-center justify-center border-dashed text-sm text-muted-foreground')}
    >
      {m.more(data.count)}
    </div>
  );
}
