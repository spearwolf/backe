/**
 * `backe mcp` über stdio (backe.md §2.19): Start-Prüfung, dann `serveStdio` des SDK, das je
 * Verbindung die Protokoll-Generation aushandelt. stdout gehört ab hier allein dem Transport; die
 * Streams kommen von außen, damit dieses Modul den Prozess nicht kennt.
 */
import type { Readable, Writable } from 'node:stream';
import { StdioServerTransport, serveStdio } from '@modelcontextprotocol/server/stdio';
import { createBackeMcp, type McpOptions, prepareMcp } from './server.ts';

export type StdioIo = { stdin: Readable; stdout: Writable; stderr(s: string): void };

/** Löst auf, sobald `stdin` endet oder geschlossen wird, auch wenn das schon passiert ist. */
function endOf(stdin: Readable): Promise<void> {
  return new Promise((resolve) => {
    if (stdin.readableEnded || stdin.destroyed) resolve();
    stdin.once('end', () => resolve());
    stdin.once('close', () => resolve());
  });
}

/**
 * Prüft den Start (wirft den `BackeError` der CLI, bevor ein Byte auf stdout geht), bedient dann
 * den Client und endet mit stdin: Verbindung zu, Timer weg, laufende Tool-Aufrufe zu Ende. Beendet
 * nie selbst den Prozess.
 */
export async function runStdio(opts: McpOptions, io: StdioIo): Promise<void> {
  const mcp = await createBackeMcp(opts, await prepareMcp(opts));
  const ended = endOf(io.stdin);
  const handle = serveStdio(() => mcp.build(), {
    transport: new StdioServerTransport(io.stdin, io.stdout),
    onerror: (error) => io.stderr(`backe mcp: ${error.message}\n`),
  });
  await ended;
  await handle.close();
  await mcp.close();
}
