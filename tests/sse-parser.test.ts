import { describe, it, expect } from 'vitest';
import { parseSSEStream } from '../src/core/sse-parser.js';

/** Build a mock ReadableStreamDefaultReader from an array of text chunks. */
function makeReader(chunks: string[]): ReadableStreamDefaultReader<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return {
    async read() {
      if (index >= chunks.length) return { done: true, value: undefined };
      return { done: false, value: encoder.encode(chunks[index++]) };
    },
    releaseLock() {},
    cancel() { return Promise.resolve(); },
    closed: Promise.resolve(undefined),
  } as unknown as ReadableStreamDefaultReader<Uint8Array>;
}

async function collect(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const results: { type: string; data: Record<string, unknown> }[] = [];
  for await (const event of parseSSEStream(reader)) {
    results.push(event);
  }
  return results;
}

describe('parseSSEStream', () => {
  it('parses a valid SSE line', async () => {
    const reader = makeReader([
      'data: {"type":"message","data":{"text":"hello"}}\n',
    ]);
    const events = await collect(reader);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('message');
    expect(events[0].data).toEqual({ text: 'hello' });
  });

  it('handles multi-line events in sequence', async () => {
    const reader = makeReader([
      'data: {"type":"start","data":{}}\ndata: {"type":"end","data":{}}\n',
    ]);
    const events = await collect(reader);
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('start');
    expect(events[1].type).toBe('end');
  });

  it('silently swallows JSON parse errors', async () => {
    const reader = makeReader([
      'data: NOT_VALID_JSON\ndata: {"type":"ok","data":{}}\n',
    ]);
    const events = await collect(reader);
    // malformed line is skipped, valid line is yielded
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('ok');
  });

  it('handles EOF with empty stream (done immediately)', async () => {
    const reader = makeReader([]);
    const events = await collect(reader);
    expect(events).toHaveLength(0);
  });

  it('handles partial frames split across chunks', async () => {
    // The JSON is split across two chunks
    const reader = makeReader([
      'data: {"type":"split","da',
      'ta":{"val":1}}\n',
    ]);
    const events = await collect(reader);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('split');
    expect(events[0].data).toEqual({ val: 1 });
  });

  it('handles multiple events in sequence across chunks', async () => {
    const reader = makeReader([
      'data: {"type":"a","data":{"n":1}}\n',
      'data: {"type":"b","data":{"n":2}}\n',
      'data: {"type":"c","data":{"n":3}}\n',
    ]);
    const events = await collect(reader);
    expect(events).toHaveLength(3);
    expect(events.map(e => e.type)).toEqual(['a', 'b', 'c']);
  });

  it('ignores lines that do not start with "data: "', async () => {
    const reader = makeReader([
      'event: ping\nid: 1\ndata: {"type":"ping","data":{}}\n',
    ]);
    const events = await collect(reader);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('ping');
  });
});
