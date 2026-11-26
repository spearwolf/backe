import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MermaidBlock } from './MermaidBlock.tsx';

const mermaid = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn() }));
vi.mock('mermaid', () => ({ default: mermaid }));

type Callback = (entries: { isIntersecting: boolean }[]) => void;
let observers: { cb: Callback; disconnect: ReturnType<typeof vi.fn> }[] = [];

beforeEach(() => {
  observers = [];
  mermaid.initialize.mockReset();
  mermaid.render.mockReset();
  mermaid.render.mockImplementation(async (id: string) => ({
    svg: `<svg id="${id}"><text>diagram</text></svg>`,
  }));
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      disconnect = vi.fn();
      constructor(cb: Callback) {
        observers.push({ cb, disconnect: this.disconnect });
      }
      observe() {}
      unobserve() {}
    },
  );
  document.documentElement.setAttribute('data-theme', 'light');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('data-theme');
});

const show = () =>
  act(async () => {
    for (const o of observers) o.cb([{ isIntersecting: true }]);
  });

test('mermaid loads only when visible', async () => {
  const { container } = render(<MermaidBlock source="graph TD; A-->B" />);
  expect(container.querySelector('code')?.textContent).toBe('graph TD; A-->B');
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
  expect(mermaid.render).not.toHaveBeenCalled();
  await show();
  await waitFor(() => expect(mermaid.render).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(container.querySelectorAll('svg')).toHaveLength(1));
});

test('mermaid runs strict and follows the theme', async () => {
  render(<MermaidBlock source="graph TD; A-->B" />);
  await show();
  await waitFor(() =>
    expect(mermaid.initialize).toHaveBeenLastCalledWith({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'neutral',
    }),
  );
  await act(async () => {
    document.documentElement.setAttribute('data-theme', 'dark');
  });
  await waitFor(() =>
    expect(mermaid.initialize).toHaveBeenLastCalledWith({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'dark',
    }),
  );
});

test('a theme change renders again', async () => {
  const { container } = render(<MermaidBlock source="graph TD; A-->B" />);
  await show();
  await waitFor(() => expect(container.querySelectorAll('svg')).toHaveLength(1));
  await act(async () => {
    document.documentElement.setAttribute('data-theme', 'dark');
  });
  await waitFor(() => expect(mermaid.render).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(container.querySelectorAll('svg')).toHaveLength(1));
  const ids = mermaid.render.mock.calls.map((c) => c[0]);
  expect(new Set(ids).size).toBe(2);
});

test('a stale render does not land', async () => {
  let release: (v: { svg: string }) => void = () => {};
  mermaid.render.mockImplementationOnce(
    () =>
      new Promise((r) => {
        release = r;
      }),
  );
  const { container } = render(<MermaidBlock source="graph TD; A-->B" />);
  await show();
  await waitFor(() => expect(mermaid.render).toHaveBeenCalledTimes(1));
  await act(async () => {
    document.documentElement.setAttribute('data-theme', 'dark');
  });
  await waitFor(() => expect(container.querySelectorAll('svg')).toHaveLength(1));
  await act(async () => {
    release({ svg: '<svg><text>stale</text></svg>' });
  });
  expect(container.textContent).not.toContain('stale');
});

test('a syntax error shows source and message', async () => {
  mermaid.render.mockRejectedValueOnce(new Error('Parse error on line 1'));
  const { container } = render(<MermaidBlock source="not a diagram" />);
  await show();
  expect(await screen.findByText(/Parse error on line 1/)).toBeDefined();
  expect(container.querySelector('code')?.textContent).toBe('not a diagram');
});
