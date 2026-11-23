import { initLocale } from '../i18n/locale.ts';
import { nodeIo } from './io.ts';
import { checkNodeVersion } from './node-version.ts';
import { m } from './output.messages.ts';
import { run } from './run.ts';

initLocale();

const bad = checkNodeVersion(process.versions.node);
if (bad) {
  process.stderr.write(`${m.errorPrefix} ${bad}\n`);
  process.exit(1);
}

process.exitCode = await run(nodeIo());
