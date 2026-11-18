import { execFileSync } from 'node:child_process';
import pkg from '../../package.json' with { type: 'json' };

test('backe --version prints the package version', () => {
  const out = execFileSync('node', ['dist/cli.js', '--version'], { encoding: 'utf8' });
  expect(out).toBe(`${pkg.version}\n`);
});
