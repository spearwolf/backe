/**
 * `backe mcp` über stdio (backe.md §2.19): Start-Prüfung, dann `serveStdio` des SDK, das je
 * Verbindung die Protokoll-Generation aushandelt. stdout gehört ab hier allein dem Transport; die
 * Streams kommen von außen, damit dieses Modul den Prozess nicht kennt.
 */
import type { Readable, Writable } from 'node:stream';
import { StdioServerTransport, serveStdio } from '@modelcontextprotocol/server/stdio';
import { createBackeMcp, type McpOptions, prepareMcp } from './server.ts';

export type StdioIo = { stdin: Readable; stdout: Writable; stderr(s: string): void };

/** Test-Hooks: `serveStdio` des SDK und die Server-Factory, etwa mit scheiterndem `close`. */
export type StdioDeps = { serve?: typeof serveStdio; create?: typeof createBackeMcp };

/** Löst auf, sobald `stdin` endet oder geschlossen wird, auch wenn das schon passiert ist. */
function endOf(stdin: Readable): Promise<void> {
  return new Promise((resolve) => {
    if (stdin.readableEnded || stdin.destroyed) resolve();
    stdin.once('end', () => resolve());
    stdin.once('close', () => resolve());
  });
}

/**
 * Löst auf, sobald der Transport sich schließt, etwa nach einem Fehler auf stdout oder einer zu
 * großen Nachricht. Dann pausiert er stdin, und `end` kommt womöglich nie. Den Handler, den
 * `serveStdio` gesetzt hat, ruft er weiterhin zuerst.
 */
function closeOf(transport: StdioServerTransport): Promise<void> {
  return new Promise((resolve) => {
    const sdk = transport.onclose;
    transport.onclose = () => {
      sdk?.();
      resolve();
    };
  });
}

/**
 * Prüft den Start (wirft den `BackeError` der CLI, bevor ein Byte auf stdout geht), bedient dann
 * den Client und endet mit stdin oder dem Transport: Verbindung zu, Timer weg, laufende
 * Tool-Aufrufe zu Ende. Scheitert dabei das Schließen, steht das als `backe mcp: …` auf stderr;
 * das Ende bleibt regulär (Exit 0), denn der Client ist schon weg. Beendet nie selbst den Prozess.
 */
export async function runStdio(opts: McpOptions, io: StdioIo, deps: StdioDeps = {}): Promise<void> {
  const mcp = await (deps.create ?? createBackeMcp)(opts, await prepareMcp(opts));
  const report = (error: unknown) =>
    io.stderr(`backe mcp: ${error instanceof Error ? error.message : String(error)}\n`);
  const ended = endOf(io.stdin);
  const transport = new StdioServerTransport(io.stdin, io.stdout);
  const handle = (deps.serve ?? serveStdio)(() => mcp.build(), { transport, onerror: report });
  await Promise.race([ended, closeOf(transport)]);
  await handle.close().catch(report);
  await mcp.close().catch(report);
}
