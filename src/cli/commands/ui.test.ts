import { browserCommand } from './ui.ts';

test.each([
  ['linux', 'xdg-open'],
  ['darwin', 'open'],
  ['win32', undefined],
  ['freebsd', undefined],
] as const)('browserCommand on %s is %s', (platform, cmd) => {
  expect(browserCommand(platform)).toBe(cmd);
});
