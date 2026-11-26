import { pendingStarts, writeQueue } from './run.ts';

test('the write queue runs one job after the other', async () => {
  const q = writeQueue();
  const log: string[] = [];
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const a = q.run(async () => {
    log.push('a+');
    await gate;
    log.push('a-');
    return 'a';
  });
  const b = q.run(async () => {
    log.push('b');
    return 'b';
  });
  release();
  expect(await Promise.all([a, b])).toEqual(['a', 'b']);
  expect(log).toEqual(['a+', 'a-', 'b']);
});

test('a failed job does not stop the write queue', async () => {
  const q = writeQueue();
  const failed = q.run(() => Promise.reject(new Error('kaputt')));
  const next = q.run(() => Promise.resolve(2));
  await expect(failed).rejects.toThrow('kaputt');
  expect(await next).toBe(2);
});

test('pending starts are settled, including one added while waiting', async () => {
  const p = pendingStarts();
  await p.settled();
  // Ein abgelehnter Start hält `settled` nicht auf und wird nicht zur unbehandelten Ablehnung.
  p.add(Promise.reject(new Error('abgelehnt')));
  const order: string[] = [];
  let finishFirst!: () => void;
  p.add(
    new Promise<void>((r) => {
      finishFirst = r;
    }).then(() => {
      order.push('first');
      p.add(Promise.reject(new Error('second')).catch(() => order.push('second')));
    }),
  );
  const settled = p.settled().then(() => order.push('settled'));
  finishFirst();
  await settled;
  expect(order).toEqual(['first', 'second', 'settled']);
});
