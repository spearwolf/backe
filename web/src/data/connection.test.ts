import { describe, expect, it, vi } from 'vitest';
import { fakeEventSources } from '../test/fake-event-source.ts';
import { Connection, type ConnectionStatus } from './connection.ts';

function setup() {
  const sources = fakeEventSources();
  const fetch = vi.fn(async () => new Response(JSON.stringify({ rev: 1 })));
  const conn = new Connection('main', { eventSource: sources.create, fetch });
  return { sources, conn, fetch };
}

describe('Connection', () => {
  it('status is connecting until the stream opens', () => {
    const { sources, conn } = setup();
    const seen: ConnectionStatus[] = [];
    conn.on('status', (s) => seen.push(s));
    expect(conn.status).toBe('connecting');
    conn.open();
    conn.open();
    expect(sources.all).toHaveLength(1);
    expect(conn.status).toBe('connecting');
    sources.last()?.emitOpen();
    expect(conn.status).toBe('open');
    expect(seen).toEqual(['connecting', 'open']);
  });

  it('events are forwarded with their data', () => {
    const { sources, conn } = setup();
    const got: unknown[] = [];
    conn.on('hello', (d) => got.push(['hello', d]));
    conn.on('patch', (d) => got.push(['patch', d]));
    conn.on('sync', (d) => got.push(['sync', d]));
    conn.on('reset', () => got.push(['reset']));
    conn.open();
    const es = sources.last();
    es?.emitEvent('hello', { rev: 3, head: 'abc' });
    es?.emitEvent('patch', { rev: 4 });
    es?.emitEvent('sync', { ahead: 1 });
    es?.emitEvent('reset', {});
    expect(got).toEqual([
      ['hello', { rev: 3, head: 'abc' }],
      ['patch', { rev: 4 }],
      ['sync', { ahead: 1 }],
      ['reset'],
    ]);
  });

  it('broken event data counts as reset', () => {
    const { sources, conn } = setup();
    const got: string[] = [];
    conn.on('reset', () => got.push('reset'));
    conn.on('patch', () => got.push('patch'));
    conn.open();
    sources.last()?.emitEvent('patch', '{not json');
    expect(got).toEqual(['reset']);
  });

  it('a reconnecting stream goes offline and back to open', () => {
    const { sources, conn } = setup();
    conn.open();
    const es = sources.last();
    es?.emitOpen();
    es?.emitError();
    expect(conn.status).toBe('offline');
    es?.emitOpen();
    expect(conn.status).toBe('open');
    expect(sources.all).toHaveLength(1);
  });

  it('a closed stream goes offline and stays quiet', () => {
    const { sources, conn } = setup();
    const got: unknown[] = [];
    conn.on('patch', (d) => got.push(d));
    conn.open();
    const es = sources.last();
    es?.emitOpen();
    es?.emitError(true);
    expect(conn.status).toBe('offline');
    es?.emitEvent('patch', { rev: 9 });
    expect(got).toEqual([]);
    expect(sources.all).toHaveLength(1);
    conn.open();
    expect(sources.all).toHaveLength(1);
  });

  it('close stops all events', () => {
    const { sources, conn } = setup();
    const got: unknown[] = [];
    conn.on('patch', (d) => got.push(d));
    conn.on('status', (s) => got.push(s));
    conn.open();
    const es = sources.last();
    conn.close();
    expect(es?.closed).toBe(true);
    es?.emitOpen();
    es?.emitEvent('patch', { rev: 1 });
    es?.emitError();
    expect(got).toEqual(['connecting']);
  });

  it('the events url encodes the backlog', () => {
    const sources = fakeEventSources();
    const conn = new Connection('a/b c', { eventSource: sources.create });
    conn.open();
    expect(sources.last()?.url).toBe('/api/b/a%2Fb%20c/events');
  });

  it('state fetches the state url', async () => {
    const { conn, fetch } = setup();
    expect(await conn.state()).toEqual({ rev: 1 });
    expect(fetch).toHaveBeenCalledWith('/api/b/main/state');
  });
});
