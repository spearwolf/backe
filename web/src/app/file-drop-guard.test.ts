import { guardFileDrops } from './file-drop-guard.ts';

/** jsdom kennt kein `DragEvent`: ein Ereignis mit den nötigen Teilen von `dataTransfer`. */
function dragEvent(type: 'dragover' | 'drop', types: string[]) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const dataTransfer = { types, dropEffect: 'copy' };
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  return { event: event as DragEvent, dataTransfer };
}

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = '';
});

test('a file nobody takes is held back from the browser', () => {
  dispose = guardFileDrops(window);
  const el = document.body.appendChild(document.createElement('div'));
  const over = dragEvent('dragover', ['Files']);
  el.dispatchEvent(over.event);
  expect(over.event.defaultPrevented).toBe(true);
  // Kein Ziel hier: Der Zeiger zeigt das, statt ein Ablegen anzubieten.
  expect(over.dataTransfer.dropEffect).toBe('none');
  const drop = dragEvent('drop', ['Files']);
  el.dispatchEvent(drop.event);
  expect(drop.event.defaultPrevented).toBe(true);
});

test('a drop area that took the file keeps it as it is', () => {
  dispose = guardFileDrops(window);
  const el = document.body.appendChild(document.createElement('div'));
  el.addEventListener('dragover', (e) => {
    e.preventDefault();
    (e as DragEvent & { dataTransfer: { dropEffect: string } }).dataTransfer.dropEffect = 'copy';
  });
  const over = dragEvent('dragover', ['Files']);
  el.dispatchEvent(over.event);
  expect(over.dataTransfer.dropEffect).toBe('copy');
});

test('other drags and a disposed guard leave the default alone', () => {
  dispose = guardFileDrops(window);
  const text = dragEvent('drop', ['text/plain']);
  document.body.dispatchEvent(text.event);
  expect(text.event.defaultPrevented).toBe(false);
  dispose();
  dispose = undefined;
  const file = dragEvent('drop', ['Files']);
  document.body.dispatchEvent(file.event);
  expect(file.event.defaultPrevented).toBe(false);
});
