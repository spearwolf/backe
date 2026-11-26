/**
 * Prüfstand für `MarkdownEditor`: der Editor mit eigenem Zustand, Router und Store, wie ihn die
 * Vorschau braucht. `spy` sieht jeden Wert, den der Editor meldet.
 */
import { render, screen } from '@testing-library/react';
import { useState } from 'react';
import { Router, RouterContext } from '../app/router.ts';
import { MarkdownEditor, type MarkdownEditorProps } from '../components/editor/MarkdownEditor.tsx';
import { Store } from '../data/store.ts';
import { StoreContext } from '../data/store-context.tsx';
import { testState } from './state.ts';

export type HarnessProps = Partial<MarkdownEditorProps> & {
  initial?: string;
  spy?: (v: string) => void;
};

function Harness(props: HarnessProps) {
  const [value, setValue] = useState(props.initial ?? '');
  const { initial: _i, spy, ...rest } = props;
  return (
    <MarkdownEditor
      label="Body"
      backlog="acme"
      value={value}
      onChange={(v) => {
        spy?.(v);
        setValue(v);
      }}
      {...rest}
    />
  );
}

export function setup(props: HarnessProps = {}) {
  window.history.replaceState(null, '', '/b/acme/issue/bk-t0001');
  const router = new Router(window);
  const store = new Store();
  store.load(testState([]));
  return render(
    <RouterContext.Provider value={router}>
      <StoreContext.Provider value={store}>
        <Harness {...props} />
      </StoreContext.Provider>
    </RouterContext.Provider>,
  );
}

export const png = () => new File(['x'], 'Shot.PNG', { type: 'image/png' });
export const box = () => screen.getByRole('textbox', { name: 'Body' }) as HTMLTextAreaElement;
