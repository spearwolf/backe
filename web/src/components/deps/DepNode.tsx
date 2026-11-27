import { isSettled } from '@backe/core/state.ts';
import {
  Handle,
  type Node,
  type NodeProps,
  Position,
  useReactFlow,
  useReactFlowStoreApi,
} from '@xyflow/react';
import type { CSSProperties, FocusEvent } from 'react';
import type { DepNode } from '../../app/dep-graph.ts';
import { useLinkClick } from '../../app/router.ts';
import { routeHref } from '../../app/routes.ts';
import { cn } from '../../lib/utils.ts';
import { m } from '../../views/deps.messages.ts';
import { StateIcon } from '../StateIcon.tsx';
import { DEP_NODE_HEIGHT, DEP_NODE_WIDTH } from './dep-layout.ts';

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

/**
 * Unsichtbare Andockpunkte ohne Fläche und ohne Verschiebung: So misst xyflow sie genau auf
 * der Mitte der Ober- bzw. Unterkante, dort, wo `HANDLES` in `DepGraph.tsx` sie vorgibt.
 * Die Vorgabe von xyflow (6 × 6 px, um die Hälfte über die Kante geschoben) ließe die Kanten
 * nach jeder Änderung zwischen Vorgabe und Messung um 3 px springen. Inline, weil die Styles
 * von xyflow in einer eigenen Layer nach Tailwind laden und Utilities überstimmen.
 */
export const HANDLE_STYLE: CSSProperties = {
  width: 0,
  height: 0,
  minWidth: 0,
  minHeight: 0,
  border: 0,
  transform: 'none',
  visibility: 'hidden',
};

/** Kanten kommen oben an und gehen unten ab. */
function Handles() {
  return (
    <>
      <Handle type="target" position={Position.Top} isConnectable={false} style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Bottom} isConnectable={false} style={HANDLE_STYLE} />
    </>
  );
}

/** Fokus per Tastatur; Browser ohne `:focus-visible` zählen jeden Fokus mit. */
function keyboardFocus(el: Element): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return true;
  }
}

/**
 * Holt den Knoten in die Fläche, wenn Link oder Knopf darin den Tastaturfokus bekommen und er
 * ganz oder teilweise außerhalb liegt; der Zoom bleibt. Das Auto-Pan von xyflow greift hier
 * nicht: Es hängt am fokussierbaren Knoten-Wrapper, und der ist es nicht (`nodesFocusable` aus).
 * Das Scrollen des Browsers zum Fokus setzt xyflow zurück, sonst bliebe der Fokus unsichtbar.
 * Wie bei xyflow nur für die Tastatur: Wer mit der Maus am Rand greift, will ziehen.
 */
function useReveal(x: number, y: number, width: number, height: number) {
  const { setCenter } = useReactFlow();
  const { viewportStore } = useReactFlowStoreApi();
  return (event: FocusEvent<HTMLElement>) => {
    if (!keyboardFocus(event.currentTarget)) return;
    const { transform, width: paneWidth, height: paneHeight } = viewportStore.getState();
    const [tx, ty, zoom] = transform;
    const left = tx + x * zoom;
    const top = ty + y * zoom;
    const inside =
      left >= 0 &&
      top >= 0 &&
      left + width * zoom <= paneWidth &&
      top + height * zoom <= paneHeight;
    if (!inside) void setCenter(x + width / 2, y + height / 2, { zoom });
  };
}

/** Ein Issue im Graphen: State, ID, gekürzter Titel; Link auf den Issue-Tab außer bei der Mitte. */
export function DepIssueNode(props: NodeProps<IssueFlowNode>) {
  const { data, positionAbsoluteX, positionAbsoluteY } = props;
  const { node, backlog, more, onToggle } = data;
  const go = useLinkClick();
  const reveal = useReveal(
    positionAbsoluteX,
    positionAbsoluteY,
    props.width ?? DEP_NODE_WIDTH,
    props.height ?? DEP_NODE_HEIGHT,
  );
  const { id, issue, role } = node;
  const centre = role === 'center';
  const missing = issue === undefined;
  const canExpand = node.hidden > 0 && more === 0 && !centre && !missing;
  const settled = issue !== undefined && isSettled(issue.state);
  // Gedämpfter Text hält auf der Karte AA-Kontrast, auf `accent` (Hintergrund der Mitte) nicht.
  const dim = centre ? 'text-foreground' : 'text-muted-foreground';

  const body = (
    <>
      <span className="flex min-w-0 items-center gap-2">
        {issue && <StateIcon state={issue.state} className={cn('shrink-0', dim)} />}
        <span className={cn('font-mono text-xs', dim)}>{id}</span>
        {centre && <span className={cn('text-xs', dim)}>{m.current}</span>}
      </span>
      {issue ? (
        <span
          className={cn('min-w-0 truncate text-sm group-hover:underline', settled && dim)}
          title={issue.title}
        >
          {issue.title}
        </span>
      ) : (
        <span className={cn('text-sm italic', dim)}>{m.missing}</span>
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
        onFocus={reveal}
        // Hover unterstreicht den Titel, statt die Fläche einzufärben: Auf `accent` fiele
        // gedämpfter Text unter AA-Kontrast.
        className={cn(
          bodyClass,
          'group rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring',
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
        // Mitte: `ring-foreground`, denn `ring-ring` ist der Fokusring.
        centre && 'bg-accent ring-2 ring-foreground',
        // Erledigt: gestrichelt und gedämpfter Titel statt Deckkraft; `muted-foreground` hält
        // auf der Karte AA-Kontrast, eine halbtransparente Karte nicht.
        settled && 'border-dashed',
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
              onFocus={reveal}
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
              onFocus={reveal}
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
