import { lazy, Suspense } from 'react';
import type { MarkdownProps } from './Markdown.tsx';

export type { MarkdownProps };

const Lazy = lazy(() => import('./Markdown.tsx'));

/** Das Markdown-Chunk lädt bei Bedarf; bis dahin steht der Quelltext da. */
export function Markdown(props: MarkdownProps) {
  return (
    <Suspense
      fallback={
        <div className={`whitespace-pre-wrap ${props.className ?? ''}`}>{props.source}</div>
      }
    >
      <Lazy {...props} />
    </Suspense>
  );
}
