import { withDeferredSignals } from './signals.ts';

test('nested sections raise the first signal once after the outermost ends', async () => {
  const raised: string[] = [];
  await withDeferredSignals(
    async () => {
      await withDeferredSignals(
        async () => {
          process.emit('SIGINT');
          process.emit('SIGTERM');
        },
        { raise: (s) => raised.push(s) },
      );
      expect(raised).toEqual([]);
    },
    { raise: (s) => raised.push(s) },
  );
  expect(raised).toEqual(['SIGINT']);
});

test('foreign listeners are detached during the section and restored afterwards', async () => {
  const seen: string[] = [];
  const own = () => seen.push('cli');
  process.on('SIGINT', own);
  await withDeferredSignals(
    async () => {
      process.emit('SIGINT');
      expect(seen).toEqual([]);
    },
    { raise: () => {} },
  );
  expect(process.listeners('SIGINT')).toContain(own);
  process.off('SIGINT', own);
});

test('a throwing section restores the listeners and still raises the signal', async () => {
  const raised: string[] = [];
  const own = () => {};
  process.once('SIGTERM', own);
  const before = process.rawListeners('SIGTERM');
  await expect(
    withDeferredSignals(
      async () => {
        process.emit('SIGTERM');
        throw new Error('boom');
      },
      { raise: (s) => raised.push(s) },
    ),
  ).rejects.toThrow('boom');
  expect(raised).toEqual(['SIGTERM']);
  expect(process.rawListeners('SIGTERM')).toEqual(before);
  process.off('SIGTERM', own);
});

test('overlapping sections restore the listeners only when the last one ends', async () => {
  const raised: string[] = [];
  const own = () => {};
  process.on('SIGINT', own);
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = withDeferredSignals(() => held, { raise: (s) => raised.push(`a:${s}`) });
  await withDeferredSignals(async () => {}, { raise: (s) => raised.push(`b:${s}`) });
  expect(process.listeners('SIGINT')).not.toContain(own);
  process.emit('SIGINT');
  release();
  await first;
  expect(process.listeners('SIGINT')).toContain(own);
  expect(raised).toEqual(['a:SIGINT']);
  process.off('SIGINT', own);
});

test('without a signal nothing is raised', async () => {
  const raised: string[] = [];
  expect(await withDeferredSignals(async () => 42, { raise: (s) => raised.push(s) })).toBe(42);
  expect(raised).toEqual([]);
});

test('without raise the deferred signal reaches the restored listeners', async () => {
  const delivered = new Promise<string>((resolve) => {
    process.once('SIGINT', (s) => resolve(s));
  });
  await withDeferredSignals(async () => {
    process.emit('SIGINT');
  });
  expect(await delivered).toBe('SIGINT');
});
