/**
 * Shared SSE stream parser used by all streaming call sites.
 *
 * Yields parsed { type, data } objects from a raw ReadableStreamDefaultReader.
 * Handles buffering, line splitting, 'data: ' prefix stripping, and JSON parsing.
 * Parse errors are silently skipped (recoverable); stream close ends the generator.
 */
export async function* parseSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>
): AsyncGenerator<{ type: string; data: Record<string, unknown> }> {
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try {
        const parsed = JSON.parse(line.slice(6)) as {
          type: string;
          data: Record<string, unknown>;
        };
        yield parsed;
      } catch (e) {
        // Ignore parse errors for partial / malformed JSON lines
        if (process.env.LOG_LEVEL === 'debug') console.error('SSE parse error:', e);
      }
    }
  }
}
