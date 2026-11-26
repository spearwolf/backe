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

/** Status und Header des Event-Streams. */
export function writeEventHead(res: ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
  });
}

/**
 * Hängt `res` als Abonnent an `live`: Header, dann `hello` und was `subscribe` sonst schickt, danach
 * jedes Ereignis und der Heartbeat. Die Antwort zählt ab hier als strömend (`phase.ts`) und hält
 * das Ende des Servers nicht auf. Ist der Client schon weg — er kann gehen, während der Watcher
 * startet, und sein `close` kommt dann nie wieder —, meldet sich nichts an.
 *
 * Kommt der Client mit dem Lesen nicht nach (`write` meldet einen vollen Puffer), hält der Stream
 * alles Weitere zurück, statt es im Speicher zu stapeln; nach `drain` folgt `reset` statt der
 * übersprungenen Ereignisse, und der Client lädt `/state` neu. Heartbeats fallen dabei weg.
 */
export function serveEvents(res: ServerResponse, live: LiveBacklog): void {
  if (res.destroyed || res.req.socket.destroyed) return;
  writeEventHead(res);
  let congested = false;
  let skipped = false;
  const send = (text: string, droppable: boolean) => {
    if (congested) {
      if (!droppable) skipped = true;
      return;
    }
    if (!res.write(text)) congested = true;
  };
  const onDrain = () => {
    congested = false;
    if (!skipped) return;
    skipped = false;
    send(sseFrame({ event: 'reset', data: {} }, live.eventId), false);
  };
  res.on('drain', onDrain);
  const last = res.req.headers['last-event-id'];
  const off = live.subscribe(
    (event, id) => send(sseFrame(event, id), false),
    typeof last === 'string' ? last : undefined,
  );
  const ping = setInterval(() => send(': ping\n\n', true), LIVE_TIMING.heartbeatMs);
  res.once('close', () => {
    clearInterval(ping);
    res.off('drain', onDrain);
    off();
  });
  streaming(res);
}
