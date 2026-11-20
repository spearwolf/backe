import { nodeIo } from './io.ts';
import { checkNodeVersion } from './node-version.ts';
import { run } from './run.ts';

const bad = checkNodeVersion(process.versions.node);
if (bad) {
  process.stderr.write(`Fehler: ${bad}\n`);
  process.exit(1);
}

process.exitCode = await run(nodeIo());
