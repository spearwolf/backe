import { Command } from 'commander';
import pkg from '../../package.json' with { type: 'json' };

const program = new Command('backe').version(pkg.version);

await program.parseAsync(process.argv);
