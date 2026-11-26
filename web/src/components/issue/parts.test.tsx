import { cleanup, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { RelationGroup } from './parts.tsx';

afterEach(cleanup);

test('a relation group hands its ref to its section', () => {
  const ref = createRef<HTMLElement>();
  render(
    <RelationGroup ref={ref} title="depends_on" footer={<p>unten</p>}>
      <li>bk-1</li>
    </RelationGroup>,
  );
  const section = screen.getByRole('region', { name: 'depends_on' });
  expect(ref.current).toBe(section);
  expect(section.textContent).toContain('unten');
});
