import { DEFAULT_DEP_PREFS, readDepPrefs, writeDepPrefs } from './dep-prefs.ts';

afterEach(() => localStorage.clear());

test('prefs default, survive and tolerate garbage', () => {
  expect(DEFAULT_DEP_PREFS).toEqual({ open: true, view: 'graph', parents: false });
  expect(readDepPrefs('acme')).toEqual(DEFAULT_DEP_PREFS);

  localStorage.setItem('backe-ui:acme:deps', '{broken');
  expect(readDepPrefs('acme')).toEqual(DEFAULT_DEP_PREFS);
  localStorage.setItem('backe-ui:acme:deps', JSON.stringify([true]));
  expect(readDepPrefs('acme')).toEqual(DEFAULT_DEP_PREFS);

  // Je Feld: Was taugt, bleibt; der Rest fällt auf den Default.
  localStorage.setItem(
    'backe-ui:acme:deps',
    JSON.stringify({ open: 'no', view: 'matrix', parents: true }),
  );
  expect(readDepPrefs('acme')).toEqual({ open: true, view: 'graph', parents: true });
  localStorage.setItem('backe-ui:acme:deps', JSON.stringify({ open: false, view: 'tree' }));
  expect(readDepPrefs('acme')).toEqual({ open: false, view: 'tree', parents: false });

  writeDepPrefs('acme', { open: false, view: 'tree', parents: true });
  expect(readDepPrefs('acme')).toEqual({ open: false, view: 'tree', parents: true });
  expect(readDepPrefs('other')).toEqual(DEFAULT_DEP_PREFS);
});
