import type { IssueRefJson } from '@backe/ui/api.ts';
import { useLinkClick } from '../../app/router.ts';
import { routeHref } from '../../app/routes.ts';
import { m } from '../../views/issue.messages.ts';
import { StateIcon } from '../StateIcon.tsx';

/** Verweis auf ein anderes Issue: Link mit State, ID und Titel; eine fehlende ID bleibt Text. */
export function IssueRef(props: {
  issue: IssueRefJson | { id: string; missing: true };
  backlog: string;
}) {
  const { issue, backlog } = props;
  const go = useLinkClick();
  if ('missing' in issue) {
    return (
      <span className="inline-flex items-baseline gap-2 text-sm">
        <span className="font-mono text-xs">{issue.id}</span>
        <span className="italic text-muted-foreground">{m.missing}</span>
      </span>
    );
  }
  const href = routeHref({ kind: 'issue', backlog, id: issue.id });
  return (
    <a
      href={href}
      onClick={go(href)}
      className="inline-flex min-w-0 items-center gap-2 rounded-sm text-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
    >
      <StateIcon state={issue.state} className="shrink-0 text-muted-foreground" />
      <span className="font-mono text-xs text-muted-foreground">{issue.id}</span>
      <span className="min-w-0 truncate">{issue.title}</span>
    </a>
  );
}
