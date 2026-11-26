import { cleanup, render, waitFor } from '@testing-library/react';
import { CodeBlock } from './CodeBlock.tsx';
import { languageOf } from './languages.ts';

afterEach(cleanup);

test('unknown language stays plain', async () => {
  const { container } = render(<CodeBlock code="let x = 1" language="klingon" />);
  await new Promise((r) => setTimeout(r, 0));
  expect(container.querySelector('[class*="hljs-"]')).toBeNull();
  expect(container.querySelector('code')?.textContent).toBe('let x = 1');
});

test('known language highlights after loading', async () => {
  const { container } = render(<CodeBlock code="const x = 1;" language="ts" />);
  expect(container.querySelector('code')?.textContent).toBe('const x = 1;');
  await waitFor(() => expect(container.querySelector('.hljs-keyword')).not.toBeNull());
  expect(container.querySelector('code')?.textContent).toBe('const x = 1;');
});

test('a language change does not keep stale highlighting', async () => {
  const { container, rerender } = render(<CodeBlock code="a: 1" language="yaml" />);
  rerender(<CodeBlock code="a: 1" language="klingon" />);
  await new Promise((r) => setTimeout(r, 50));
  expect(container.querySelector('[class*="hljs-"]')).toBeNull();
});

test('extensions map to languages', () => {
  expect(languageOf('yml')).toBe('yaml');
  expect(languageOf('tsx')).toBe('typescript');
  expect(languageOf('TS')).toBe('typescript');
  expect(languageOf('nope')).toBeUndefined();
});
