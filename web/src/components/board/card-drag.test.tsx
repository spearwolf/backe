import { pressedCard } from './card-drag.tsx';

/** Ein Board-Ausschnitt: eine Zelle mit einer Karte samt Link, daneben das `+` der Zelle. */
function boardDom(): { root: HTMLElement; link: HTMLElement; li: HTMLElement; plus: HTMLElement } {
  const root = document.createElement('div');
  root.innerHTML = `
    <ul data-lane="s1" data-column="todo">
      <li data-card="bk-1" data-lane="s1"><a href="#"><span>Titel</span></a></li>
    </ul>
    <button data-quick-create>+</button>`;
  document.body.append(root);
  return {
    root,
    link: root.querySelector('span') as HTMLElement,
    li: root.querySelector('li') as HTMLElement,
    plus: root.querySelector('button') as HTMLElement,
  };
}

afterEach(() => {
  document.body.innerHTML = '';
});

test('a press on a card yields its node and data with the column of its cell', () => {
  const { root, link, li } = boardDom();
  expect(pressedCard(root, link)).toEqual({
    node: li,
    data: { type: 'card', id: 'bk-1', lane: 's1', column: 'todo' },
  });
});

test('a press outside any card, outside the board or without an element is none', () => {
  const { root, plus, li } = boardDom();
  expect(pressedCard(root, plus)).toBeUndefined();
  // Ein Portal (Kartenmenü) hängt außerhalb des Boards im DOM.
  const portal = document.createElement('div');
  portal.innerHTML = '<li data-card="bk-2" data-lane="s1"><span>Menü</span></li>';
  document.body.append(portal);
  expect(pressedCard(root, portal.querySelector('span'))).toBeUndefined();
  expect(pressedCard(root, null)).toBeUndefined();
  expect(pressedCard(root, window)).toBeUndefined();
  // Eine Karte ohne Zelle darum: keine Spalte, kein Ziehen.
  li.parentElement?.removeAttribute('data-column');
  expect(pressedCard(root, li)).toBeUndefined();
});
