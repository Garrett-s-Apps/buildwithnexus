// src/cli/run-command.ts
import { tui } from './tui.js';

export async function runCommand(
  task: string,
  options: { agent: string; goal?: string; model: string }
) {
  const backendUrl = process.env.BACKEND_URL || 'http://localhost:4200';

  tui.displayHeader(task, options.agent);
  tui.displayConnecting();

  try {
    // Check backend is running
    let healthOk = false;
    try {
      const healthResponse = await fetch(`${backendUrl}/health`);
      healthOk = healthResponse.ok;
    } catch {
      // fetch threw - backend not reachable
    }

    if (!healthOk) {
      console.error(
        'Backend not responding. Start it with:\n' +
        '   buildwithnexus server'
      );
      process.exit(1);
    }

    // POST to backend
    const response = await fetch(`${backendUrl}/api/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task,
        agent_role: options.agent,
        agent_goal: options.goal || '',
      }),
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
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('No response body');
      }

      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6)) as {
                type: string;
                data: Record<string, unknown>;
              };

              const type = data.type;
              const content = (data.data['content'] as string) || '';

              if (type === 'done') {
                tui.displayEvent(type, { content: 'Task completed successfully' });
                tui.displayComplete(tui.getElapsedTime());
                process.exit(0);
              } else if (type === 'error') {
                tui.displayError(content);
                process.exit(1);
              } else {
                tui.displayEvent(type, { content });
              }
            } catch {
              // Ignore parse errors
            }
          }
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
