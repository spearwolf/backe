import { act, renderHook } from '@testing-library/react';
import { useResolvedTheme } from './use-resolved-theme.ts';

afterEach(() => document.documentElement.removeAttribute('data-theme'));

test('reads data-theme and follows changes', async () => {
  document.documentElement.setAttribute('data-theme', 'dark');
  const { result, unmount } = renderHook(() => useResolvedTheme());
  expect(result.current).toBe('dark');
  await act(async () => {
    document.documentElement.setAttribute('data-theme', 'light');
    await Promise.resolve();
  });
  expect(result.current).toBe('light');
  unmount();
});

test('falls back to light without the attribute', () => {
  const { result } = renderHook(() => useResolvedTheme());
  expect(result.current).toBe('light');
});
