import { useEffect, useId, useRef, useState } from 'react';
import { useResolvedTheme } from '../lib/use-resolved-theme.ts';
import { m } from './mermaid.messages.ts';

let counter = 0;

type State = { svg: string } | { error: string } | undefined;

/** Bis zur Sichtbarkeit steht der Quelltext da; erst dann lädt der Mermaid-Chunk. */
export function MermaidBlock({ source }: { source: string }) {
  const theme = useResolvedTheme();
  const host = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [state, setState] = useState<State>();
  const baseId = useId().replace(/[^a-zA-Z0-9]/g, '');

  useEffect(() => {
    const el = host.current;
    if (el === null || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let stale = false;
    const id = `mermaid-${baseId}-${++counter}`;
    (async () => {
      try {
        const { default: mermaid } = await import('mermaid');
        if (stale) return;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: theme === 'dark' ? 'dark' : 'neutral',
        });
        const { svg } = await mermaid.render(id, source);
        if (!stale) setState({ svg });
      } catch (error) {
        // Mermaid lässt bei einem Fehler ein Hilfselement im Dokument zurück.
        document.getElementById(`d${id}`)?.remove();
        if (!stale) setState({ error: error instanceof Error ? error.message : String(error) });
      }
    })();
    return () => {
      stale = true;
    };
  }, [visible, theme, source, baseId]);

  if (state !== undefined && 'svg' in state) {
    // Mermaid bereinigt das SVG selbst (securityLevel strict).
    return (
      <div
        ref={host}
        className="markdown-mermaid"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: Ausgabe von Mermaid unter securityLevel strict
        dangerouslySetInnerHTML={{ __html: state.svg }}
      />
    );
  }
  return (
    <div ref={host} className="markdown-mermaid">
      {state !== undefined && 'error' in state && (
        <p role="alert" className="text-destructive text-sm">
          {m.diagramError(state.error)}
        </p>
      )}
      <pre className="markdown-code">
        <code>{source}</code>
      </pre>
    </div>
  );
}
