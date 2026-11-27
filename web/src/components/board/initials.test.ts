import { initialsOf } from './initials.ts';

test.each([
  ['Wolfger Schramm', 'spw', 'WS'],
  [undefined, 'spw', 'SP'],
  [undefined, 'claude-bot', 'CB'],
  ['Ada', 'ada', 'AD'],
  ['', 'x', 'X'],
  ['  Anna  Maria Schmidt ', 'anna', 'AS'],
  [undefined, 'élodie_roux', 'ÉR'],
])('initials of %s/%s', (name, handle, expected) => {
  expect(initialsOf(handle, name)).toBe(expected);
});
