// src/cli/run-command.ts
import { tui } from './tui.js';
import { validateBackendUrl } from '../core/config.js';
import { buildRunPayload, checkServerHealth } from '../core/api.js';
import { parseSSEStream } from '../core/sse-parser.js';

export async function runCommand(
  task: string,
  options: { agent: string; goal?: string; model: string }
) {
  const backendUrl = process.env.BACKEND_URL || 'http://localhost:4200';

  // Validate backend URL security before transmitting API keys
  const urlCheck = validateBackendUrl(backendUrl);
  if (!urlCheck.valid) {
    console.error(`\n${urlCheck.error}`);
    process.exit(1);
  }

  tui.displayHeader(task, options.agent);
  tui.displayConnecting();

  try {
    // Check backend is running
    if (!(await checkServerHealth(backendUrl))) {
      console.error(
        'Backend not responding. Start it with:\n' +
        '   buildwithnexus server'
      );
      process.exit(1);
    }

    // POST to backend
    const payload = buildRunPayload(task, options.agent, options.goal || '');
    const response = await fetch(`${backendUrl}/api/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error('Backend error');
      console.error(await response.text());
      process.exit(1);
    }

    const { run_id } = (await response.json()) as { run_id: string };
    tui.displayConnected(run_id);
    tui.displayStreamStart();

    // Connect to Server-Sent Events stream
    const eventSourceUrl = `${backendUrl}/api/stream/${run_id}`;

    try {
      const response = await fetch(eventSourceUrl);
      const reader = response.body?.getReader();

      if (!reader) {
        throw new Error('No response body');
      }

      for await (const parsed of parseSSEStream(reader)) {
        const type = parsed.type;
        const eventContent = (parsed.data['content'] as string) || '';

        if (type === 'done') {
          tui.displayEvent(type, { content: 'Task completed successfully' });
          tui.displayComplete(tui.getElapsedTime());
          process.exit(0);
        } else if (type === 'error') {
          tui.displayError(eventContent);
          process.exit(1);
        } else {
          tui.displayEvent(type, { content: eventContent });
        }
      }
    } catch (error: unknown) {
      console.error(
        '\nStream error. Make sure backend is running:\n' +
        '   buildwithnexus server'
      );
      process.exit(1);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Error:', message);
    process.exit(1);
  }
}
