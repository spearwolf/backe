import type { Attachment } from '@backe/core/schemas.ts';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Router, RouterContext } from '../app/router.ts';
import type { Theme } from '../app/theme.ts';
import { UiContext } from '../app/ui-context.tsx';
import { UiPrefs } from '../app/ui-prefs.ts';
import { Store } from '../data/store.ts';
import { StoreContext } from '../data/store-context.tsx';
import { testIssue, testState } from '../test/state.ts';
import { Markdown as LazyMarkdown } from './index.tsx';
import Markdown from './Markdown.tsx';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const ID = 'bk-7f3k2';

function setup(
  source: string,
  opts: {
    attachments?: Attachment[];
    noIssue?: boolean;
    lazy?: boolean;
    /** Mit Wert steht ein `UiContext` darüber, dessen Schalter für externe Bilder so steht. */
    externalImages?: boolean;
  } = {},
) {
  window.history.replaceState(null, '', '/b/acme/issue/bk-t0001');
  const router = new Router(window);
  const store = new Store();
  store.load(testState([testIssue(1, { id: ID } as never), testIssue(2)]));
  const Comp = opts.lazy ? LazyMarkdown : Markdown;
  const markdown = (
    <RouterContext.Provider value={router}>
      <StoreContext.Provider value={store}>
        <Comp
          source={source}
          backlog="acme"
          issue={opts.noIssue ? undefined : { id: ID, attachments: opts.attachments ?? [] }}
        />
      </StoreContext.Provider>
    </RouterContext.Provider>
  );
  let prefs: UiPrefs | undefined;
  let ui = markdown;
  if (opts.externalImages !== undefined) {
    prefs = new UiPrefs('en', document.createElement('html'));
    prefs.setExternalImages(opts.externalImages);
    // Das Theme liest Markdown nicht; ein leeres Objekt genügt.
    ui = <UiContext.Provider value={{ theme: {} as Theme, prefs }}>{markdown}</UiContext.Provider>;
  }
  return { router, prefs, ...render(ui) };
}

test('renders gfm', () => {
  const { container } = setup(
    '| a | b |\n|---|---|\n| 1 | 2 |\n\n~~x~~\n\n- [x] done\n- [ ] open\n\nwww.example.com',
  );
  expect(container.querySelector('table')).not.toBeNull();
  expect(container.querySelector('del')?.textContent).toBe('x');
  const boxes = container.querySelectorAll('input[type=checkbox]');
  expect(boxes).toHaveLength(2);
  for (const box of boxes) expect(box).toHaveProperty('disabled', true);
  expect(container.querySelector('a[href="http://www.example.com"]')).not.toBeNull();
});

test('renders emoji shortcodes', () => {
  const { container } = setup(':tada:');
  expect(container.textContent).toContain('🎉');
});

test('strips active content', () => {
  const { container } = setup(
    [
      '<script>alert(1)</script>',
      '<img src=x onerror="alert(1)">',
      '[x](javascript:alert(1))',
      '<a href="data:text/html,<script>alert(1)</script>">d</a>',
      '<iframe src="https://example.com"></iframe>',
      '<style>body{display:none}</style>',
      '<div onclick="alert(1)">c</div>',
    ].join('\n\n'),
  );
  expect(container.querySelector('script, iframe, style')).toBeNull();
  expect(
    [...container.querySelectorAll('*')]
      .flatMap((e) => e.getAttributeNames())
      .filter((n) => n.startsWith('on')),
  ).toEqual([]);
  expect(
    [...container.querySelectorAll('a')].map((a) => a.getAttribute('href')),
  ).not.toContainEqual(expect.stringMatching(/^(javascript|data):/i));
});

test('keeps details and summary', () => {
  const { container } = setup('<details><summary>mehr</summary>\n\ninhalt\n\n</details>');
  expect(container.querySelector('details > summary')?.textContent).toBe('mehr');
  expect(container.querySelector('details')?.textContent).toContain('inhalt');
});

test('links existing issue ids', async () => {
  const { container, router } = setup(`siehe ${ID}.`);
  const a = container.querySelector('a');
  expect(a?.getAttribute('href')).toBe(`/b/acme/issue/${ID}`);
  await userEvent.click(a as HTMLElement);
  expect(router.location.value.pathname).toBe(`/b/acme/issue/${ID}`);
});

test('ids in code stay text', () => {
  const { container } = setup(`\`${ID}\`\n\n\`\`\`\n${ID}\n\`\`\`\n\n[${ID}](https://example.com)`);
  const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
  expect(hrefs).toEqual(['https://example.com']);
  expect(container.querySelectorAll('code')).toHaveLength(2);
});

test('unknown ids and foreign prefixes stay text', () => {
  const { container } = setup('bk-zzzzz und xy-7f3k2 und abk-7f3k2');
  expect(container.querySelector('a')).toBeNull();
});

test('relative image paths point at the attachment', () => {
  const attachments: Attachment[] = [{ name: 'trace', file: 'trace.png' }];
  const { container } = setup('![t](attachments/trace.png) ![u](./attachments/trace.png)', {
    attachments,
  });
  const srcs = [...container.querySelectorAll('img')].map((i) => i.getAttribute('src'));
  expect(srcs).toEqual([
    `/api/b/acme/issues/${ID}/attachments/trace`,
    `/api/b/acme/issues/${ID}/attachments/trace`,
  ]);
});

test('only own attachment files resolve', () => {
  const attachments: Attachment[] = [{ name: 'a', file: 'a.png' }];
  const { container } = setup(
    [
      '![1](../bk-x/attachments/a.png)',
      '![2](attachments/../issue.md)',
      '![3](attachments/unbekannt.png)',
      '![4](/etc/passwd)',
      '![5](//evil.example/x.png)',
      '![6](attachments/%2e%2e/a.png)',
      '<img src="attachments/../a.png">',
      '<picture><source srcset="../../api/b/other/issues/x/attachments/y 1x, /api/evil 2x"><img src="attachments/nope.png"></picture>',
      '<img src="attachments/nope.png" srcset="/api/evil 2x">',
    ].join('\n\n'),
    { attachments },
  );
  const withSrc = [...container.querySelectorAll('img')].filter((i) => i.hasAttribute('src'));
  expect(withSrc).toEqual([]);
  expect(container.querySelectorAll('[srcset]')).toHaveLength(0);
});

test('external images stay blocked when switched off', () => {
  const attachments: Attachment[] = [{ name: 'trace', file: 'trace.png' }];
  const { container, prefs } = setup(
    '![Logo](https://example.com/logo.png) ![t](attachments/trace.png)',
    { attachments, externalImages: false },
  );
  const srcs = [...container.querySelectorAll('img')].map((i) => i.getAttribute('src'));
  expect(srcs).toEqual([`/api/b/acme/issues/${ID}/attachments/trace`]);
  const link = screen.getByRole('link', { name: 'External image blocked: Logo' });
  expect(link.getAttribute('href')).toBe('https://example.com/logo.png');
  expect(link.getAttribute('target')).toBe('_blank');
  expect(link.getAttribute('rel')).toBe('noopener noreferrer');

  // Wieder erlaubt: Das Bild erscheint, obwohl `Markdown` selbst gemerkt ist.
  act(() => prefs?.setExternalImages(true));
  expect(container.querySelector('img[src="https://example.com/logo.png"]')).not.toBeNull();
  prefs?.dispose();
});

test('external images load without a ui context', () => {
  const { container } = setup('![Logo](https://example.com/logo.png)');
  expect(container.querySelector('img[src="https://example.com/logo.png"]')).not.toBeNull();
});

test('relative paths fall away without issue context', () => {
  const { container } = setup('![t](attachments/trace.png) [l](other.md)', { noIssue: true });
  expect(container.querySelector('img[src]')).toBeNull();
  expect(container.querySelector('a[href]')).toBeNull();
});

test('external links open in a new tab', () => {
  const { container } = setup('[x](https://example.com/a)');
  const a = container.querySelector('a');
  expect(a?.getAttribute('target')).toBe('_blank');
  expect(a?.getAttribute('rel')).toContain('noopener');
  expect(a?.getAttribute('rel')).toContain('noreferrer');
});

test('the lazy entry renders the markdown after loading', async () => {
  const { container } = setup('**fett**', { lazy: true });
  expect(await screen.findByText('fett')).toBeDefined();
  expect(container.querySelector('strong')).not.toBeNull();
});

test('raw html code and links keep their text and gain no issue link', () => {
  const { container } = setup(`a <code>${ID}</code> <a href="https://x.test">${ID}</a>`);
  expect(container.querySelector('code')?.textContent).toBe(ID);
  const anchors = [...container.querySelectorAll('a')];
  expect(anchors.map((a) => a.getAttribute('href'))).toEqual(['https://x.test']);
  expect(anchors[0]?.textContent).toBe(ID);
});

test('mermaid fences become diagrams', () => {
  const { container } = setup('```mermaid\ngraph TD; A-->B\n```\n\n```ts\nconst x = 1;\n```');
  expect(container.querySelectorAll('pre')).toHaveLength(2);
  expect(container.querySelector('.markdown-mermaid')).not.toBeNull();
  expect(container.querySelector('code.language-typescript')).not.toBeNull();
});
