import { render, screen, within } from '@testing-library/react';
import { flush, view as issueView, registerIssueViewHarness } from '../../../test/issue-view.tsx';
import { testIssue } from '../../../test/state.ts';
import { m } from '../../../views/issue.messages.ts';
import { MultiPick } from './inputs.tsx';

vi.mock('../../../markdown/index.tsx', () => ({
  Markdown: ({ source }: { source: string }) => <div data-testid="markdown">{source}</div>,
}));

registerIssueViewHarness();

const pick = (values: string[], options: string[]) =>
  render(<MultiPick label="Projekte" values={values} options={options} onChange={() => {}} />);

test('without values and without options a muted dash stands in', () => {
  const { container } = pick([], []);
  expect(container.textContent).toBe(`—${m.noValues}`);
  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.queryByRole('list')).toBeNull();
});

test('values or options replace the dash', () => {
  const { container, unmount } = pick([], ['web']);
  expect(container.textContent).not.toContain('—');
  expect(screen.getByRole('button', { name: m.addTo('Projekte') })).toBeTruthy();
  unmount();
  expect(pick(['web'], ['web']).container.textContent).not.toContain('—');
});

test('the issue tab shows the dash when the backlog has no projects or sprints', async () => {
  issueView([testIssue(1)]);
  await flush();
  for (const label of [m.fieldProjects, m.fieldSprints]) {
    const row = screen.getByText(label, { selector: 'dt' }).parentElement as HTMLElement;
    expect(within(row).getByText(m.noValues)).toBeTruthy();
  }
});
