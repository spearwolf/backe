import type { CommentJson } from '@backe/ui/api.ts';
import { ArrowRight } from 'lucide-react';
import { Markdown } from '../../markdown/index.tsx';
import { m } from '../../views/issue.messages.ts';
import { StateIcon } from '../StateIcon.tsx';
import { Author, Time } from './parts.tsx';

/** Kommentare und Übergänge in der Reihenfolge des Servers. */
export function Timeline(props: {
  comments: readonly CommentJson[];
  backlog: string;
  issue: React.ComponentProps<typeof Markdown>['issue'];
}) {
  const { comments, backlog, issue } = props;
  if (comments.length === 0) return null;
  return (
    <section aria-labelledby="issue-timeline" className="space-y-3">
      <h2 id="issue-timeline" className="text-sm font-semibold">
        {m.timeline}
      </h2>
      <ol aria-label={m.timeline} className="space-y-3">
        {comments.map((c) => (
          <li key={c.file} className="space-y-1 rounded-md border p-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {c.kind === 'transition' && c.from !== undefined && c.to !== undefined ? (
                <span className="inline-flex items-center gap-1 text-foreground">
                  <span className="sr-only">{m.transition}</span>
                  <StateIcon state={c.from} />
                  <ArrowRight className="size-3.5" aria-hidden="true" />
                  <StateIcon state={c.to} />
                </span>
              ) : (
                <span className="sr-only">{m.comment}</span>
              )}
              <Author handle={c.author} />
              <Time iso={c.created} />
            </div>
            {c.body !== '' && <Markdown source={c.body} backlog={backlog} issue={issue} />}
          </li>
        ))}
      </ol>
    </section>
  );
}
