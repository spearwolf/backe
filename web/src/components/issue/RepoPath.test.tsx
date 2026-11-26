import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../data/api-client.ts';
import { Store } from '../../data/store.ts';
import { StoreContext } from '../../data/store-context.tsx';
import { WriteContext } from '../../data/write-context.tsx';
import { Writes } from '../../data/writes.ts';
import { testState } from '../../test/state.ts';
import { m } from '../../views/issue.messages.ts';
import { RepoPath } from './RepoPath.tsx';

const call = vi.fn<(name: string, args: unknown) => Promise<unknown>>();

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  call.mockReset();
});

function setup() {
  const store = new Store();
  store.load(testState([]));
  const writes = new Writes(store, {
    call: call as never,
    upload: vi.fn(),
    refresh: async () => {},
  });
  render(
    <StoreContext.Provider value={store}>
      <WriteContext.Provider value={{ backlog: 'acme', canWrite: true, me: 'spw', writes }}>
        <RepoPath name="core" />
      </WriteContext.Provider>
    </StoreContext.Provider>,
  );
}

test('repo path comes from repo_locate and can be copied', async () => {
  const writeText = vi.fn(async () => {});
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
  call.mockResolvedValue({
    name: 'core',
    url: 'git@example.org:core.git',
    canonical: 'example.org/core',
    path: '/src/core',
  });
  setup();
  await userEvent.click(screen.getByRole('button', { name: m.localPathOf('core') }));
  expect(call).toHaveBeenCalledWith('repo_locate', { name: 'core' });
  const path = await screen.findByText('/src/core');
  expect(path.className).toContain('font-mono');
  // Der Knopf ist dem Pfad gewichen; der Fokus steht auf »Pfad kopieren«.
  expect(document.activeElement).toBe(screen.getByRole('button', { name: m.copyPath }));
  await userEvent.click(screen.getByRole('button', { name: m.copyPath }));
  expect(writeText).toHaveBeenCalledWith('/src/core');
  expect(screen.getByRole('status').textContent).toBe(m.copied);
});

test('a repo without local path shows the hint', async () => {
  call.mockRejectedValue(
    new ApiError(
      404,
      'not_found',
      'Kein lokaler Pfad für core',
      'backe repo locate core --path <dir>',
    ),
  );
  setup();
  await userEvent.click(screen.getByRole('button', { name: m.localPathOf('core') }));
  await act(async () => {});
  expect(screen.getByRole('alert').textContent).toContain('Kein lokaler Pfad für core');
  expect(screen.getByText('backe repo locate core --path <dir>')).toBeTruthy();
});
