import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import { remarkIssueLinks } from './issue-links.ts';

function html(md: string, known = ['bk-7f3k2']): string {
  return renderToStaticMarkup(
    createElement(
      ReactMarkdown,
      {
        urlTransform: (url: string) => url,
        remarkPlugins: [
          [
            remarkIssueLinks,
            {
              prefix: 'bk',
              exists: (id: string) => known.includes(id),
              href: (id: string) => `/i/${id}`,
            },
          ],
        ],
      },
      md,
    ),
  );
}

test('turns a known id into a link', () => {
  expect(html('see bk-7f3k2 now')).toContain('<a href="/i/bk-7f3k2">bk-7f3k2</a>');
});

test('accepts six character ids', () => {
  expect(html('bk-7f3k2a', ['bk-7f3k2a'])).toContain('href="/i/bk-7f3k2a"');
});

test('respects word boundaries', () => {
  expect(html('abk-7f3k2 bk-7f3k2x foo-bk-7f3k2 bk-7f3k2a')).not.toContain('<a');
});

test('skips code, inline code and existing links', () => {
  const out = html(
    '`bk-7f3k2`\n\n```\nbk-7f3k2\n```\n\n[bk-7f3k2](https://x.test)\n\n[r][1]\n\n[1]: https://x.test',
  );
  expect(out).not.toContain('/i/bk-7f3k2');
});

test('leaves unknown ids and the ambiguous letters alone', () => {
  expect(html('bk-zzzzz bk-ilou1')).not.toContain('<a');
});
