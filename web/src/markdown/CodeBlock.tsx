import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import type { createLowlight } from 'lowlight';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { LANGUAGES, languageOf } from './languages.ts';
import './highlight.css';

type Lowlight = ReturnType<typeof createLowlight>;

let instance: Promise<Lowlight> | undefined;
const registering = new Map<string, Promise<void>>();

/** Lowlight lädt erst beim ersten Codeblock; die Instanz ist ein Singleton. */
function lowlight(): Promise<Lowlight> {
  instance ??= import('lowlight').then((mod) => mod.createLowlight());
  return instance;
}

/** Registriert die Sprache genau einmal; parallele Aufrufe teilen sich denselben Ladevorgang. */
function ensureLanguage(low: Lowlight, name: string): Promise<void> {
  if (low.registered(name)) return Promise.resolve();
  let pending = registering.get(name);
  if (pending === undefined) {
    const load = LANGUAGES[name];
    if (load === undefined) return Promise.reject(new Error(`unknown language ${name}`));
    pending = load().then((mod) => {
      if (!low.registered(name)) low.register({ [name]: mod.default });
    });
    registering.set(name, pending);
    pending.catch(() => registering.delete(name));
  }
  return pending;
}

export function CodeBlock({ code, language }: { code: string; language?: string }) {
  const canonical = language === undefined ? undefined : languageOf(language);
  const [done, setDone] = useState<{ key: string; node: ReactNode } | undefined>();
  const key = `${canonical}\u0000${code}`;

  useEffect(() => {
    if (canonical === undefined) return;
    let cancelled = false;
    (async () => {
      const low = await lowlight();
      await ensureLanguage(low, canonical);
      if (cancelled) return;
      const tree = low.highlight(canonical, code);
      setDone({ key, node: toJsxRuntime(tree, { Fragment, jsx, jsxs }) });
    })().catch(() => {
      // Laden schlägt fehl (Chunk offline): der unformatierte Code bleibt stehen.
    });
    return () => {
      cancelled = true;
    };
  }, [canonical, code, key]);

  const highlighted = done?.key === key ? done.node : undefined;
  return (
    <pre className="markdown-code">
      <code className={canonical === undefined ? undefined : `hljs language-${canonical}`}>
        {highlighted ?? code}
      </code>
    </pre>
  );
}
