import { nodeIo } from './io.ts';
import { run } from './run.ts';

process.exitCode = await run(nodeIo());
