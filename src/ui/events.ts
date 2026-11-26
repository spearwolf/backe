/**
 * Event-Stream von `backe ui` (ui.md §2.4.3): Server-Sent Events über `node:http`. Jedes Ereignis
 * trägt `id: <boot>:<rev>`; der Browser schickt die letzte beim Wiederverbinden als
 * `Last-Event-ID`. Ein Kommentar alle 15 s hält die Verbindung sichtbar am Leben.
 */
import type { ServerResponse } from 'node:http';
import type { ServerEvent } from './api.ts';
import { LIVE_TIMING, type LiveBacklog } from './live.ts';
import { streaming } from './phase.ts';

/** Ein Ereignis im SSE-Format; `data` ist kompaktes JSON in einer Zeile. */
export function sseFrame(event: ServerEvent, id: string): string {
  return `id: ${id}\nevent: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

/**
 * Hängt `res` als Abonnent an `live`: Header, dann `hello` und was `subscribe` sonst schickt, danach
 * jedes Ereignis und der Heartbeat. Die Antwort zählt ab hier als strömend (`phase.ts`) und hält
 * das Ende des Servers nicht auf. `HEAD` bekommt nur die Header.
 */
export function serveEvents(res: ServerResponse, live: LiveBacklog): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  if (res.req.method === 'HEAD') {
    res.end();
    return;
  }
  const last = res.req.headers['last-event-id'];
  const off = live.subscribe(
    (event, id) => {
      res.write(sseFrame(event, id));
    },
    typeof last === 'string' ? last : undefined,
  );
  const ping = setInterval(() => res.write(': ping\n\n'), LIVE_TIMING.heartbeatMs);
  res.once('close', () => {
    clearInterval(ping);
    off();
  });
  streaming(res);
}
