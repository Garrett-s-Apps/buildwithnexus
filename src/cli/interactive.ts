import * as readline from 'readline';
import chalk from 'chalk';
import { tui, type Mode } from './tui.js';
import { classifyIntent } from './intent-classifier.js';
import { hasAnyKey, reloadEnv, loadApiKeys } from '../core/config.js';

export async function interactiveMode() {
  const backendUrl = process.env.BACKEND_URL || 'http://localhost:4200';

  // Check if any API key is configured
  if (!hasAnyKey()) {
    // No keys set, run init flow
    console.log(chalk.cyan('\n🔧 First-time setup required\n'));
    const { deepAgentsInitCommand } = await import('./init-command.js');
    await deepAgentsInitCommand();

    // Reload environment from ~/.env.local
    reloadEnv();

    // Re-check after reload
    if (!hasAnyKey()) {
      console.error('Error: At least one API key is required to use buildwithnexus.');
      console.error('Please run: buildwithnexus da-init');
      process.exit(1);
    }
  }

  try {
    const response = await fetch(`${backendUrl}/health`);
    if (!response.ok) {
      console.error(chalk.red('❌ Backend not running. Start it with: buildwithnexus server'));
      process.exit(1);
    }
  } catch {
    console.error(chalk.red('❌ Cannot connect to backend at ' + backendUrl));
    process.exit(1);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (question: string): Promise<string> =>
    new Promise((resolve) => rl.question(question, resolve));

  console.clear();
  console.log(chalk.cyan('╔════════════════════════════════════════════════════════════╗'));
  console.log(
    chalk.cyan('║') +
      chalk.bold.white('        🚀 DEEP AGENTS - Autonomous Execution Engine        ') +
      chalk.cyan('║')
  );
  console.log(chalk.cyan('╚════════════════════════════════════════════════════════════╝'));
  console.log('');
  console.log(chalk.gray('Welcome! Describe what you want the AI agents to do.'));
  console.log(chalk.gray('Type "exit" to quit.\n'));

  while (true) {
    const task = await ask(chalk.bold.blue('📝 Task: '));

    if (task.toLowerCase() === 'exit') {
      console.log(chalk.yellow('\nGoodbye! 👋\n'));
      rl.close();
      process.exit(0);
    }

    if (!task.trim()) {
      console.log(chalk.red('Please enter a task.\n'));
      continue;
    }

    // Classify intent and suggest a mode
    const suggestedMode = classifyIntent(task).toUpperCase() as Mode;
    tui.displaySuggestedMode(suggestedMode, task);

    // Let user confirm or override mode
    const currentMode = await selectMode(suggestedMode, ask);

    // Enter the mode loop
    await runModeLoop(currentMode, task, backendUrl, rl, ask);
    console.log('');
  }
}

async function selectMode(suggested: Mode, ask: (q: string) => Promise<string>): Promise<Mode> {
  const modeColor: Record<Mode, (s: string) => string> = {
    PLAN: chalk.cyan,
    BUILD: chalk.green,
    BRAINSTORM: chalk.blue,
  };

  console.log('');
  console.log(
    chalk.gray('Press ') +
      chalk.bold('Enter') +
      chalk.gray(' to use ') +
      modeColor[suggested](suggested) +
      chalk.gray(' or type ') +
      chalk.bold('plan') +
      chalk.gray('/') +
      chalk.bold('build') +
      chalk.gray('/') +
      chalk.bold('brainstorm') +
      chalk.gray(' to switch: ')
  );

  const answer = await ask(chalk.gray('> '));
  const lower = answer.trim().toLowerCase();

  if (lower === 'p' || lower === 'plan') return 'PLAN';
  if (lower === 'b' || lower === 'build') return 'BUILD';
  if (lower === 'br' || lower === 'brainstorm') return 'BRAINSTORM';

  return suggested;
}

async function runModeLoop(
  mode: Mode,
  task: string,
  backendUrl: string,
  rl: readline.Interface,
  ask: (q: string) => Promise<string>
): Promise<void> {
  let currentMode = mode;

  while (true) {
    console.clear();
    printAppHeader();
    tui.displayModeBar(currentMode);
    tui.displayModeHeader(currentMode);

    if (currentMode === 'PLAN') {
      const next = await planModeLoop(task, backendUrl, rl, ask);
      if (next === 'BUILD') {
        currentMode = 'BUILD';
        continue;
      }
      if (next === 'switch') {
        currentMode = await promptModeSwitch(currentMode, ask);
        continue;
      }
      // cancelled or done
      return;
    }

    if (currentMode === 'BUILD') {
      const next = await buildModeLoop(task, backendUrl, rl, ask);
      if (next === 'switch') {
        currentMode = await promptModeSwitch(currentMode, ask);
        continue;
      }
      return;
    }

    if (currentMode === 'BRAINSTORM') {
      const next = await brainstormModeLoop(task, backendUrl, rl, ask);
      if (next === 'switch') {
        currentMode = await promptModeSwitch(currentMode, ask);
        continue;
      }
      return;
    }
  }
}

function printAppHeader() {
  console.log(chalk.cyan('╔════════════════════════════════════════════════════════════╗'));
  console.log(
    chalk.cyan('║') +
      chalk.bold.white('        🚀 DEEP AGENTS - Autonomous Execution Engine        ') +
      chalk.cyan('║')
  );
  console.log(chalk.cyan('╚════════════════════════════════════════════════════════════╝'));
  console.log('');
}

async function promptModeSwitch(current: Mode, ask: (q: string) => Promise<string>): Promise<Mode> {
  const others: Mode[] = (['PLAN', 'BUILD', 'BRAINSTORM'] as Mode[]).filter((m) => m !== current);
  console.log('');
  console.log(
    chalk.gray('Switch to: ') +
      others.map((m, i) => chalk.bold(`[${i + 1}] ${m}`)).join(chalk.gray('  ')) +
      chalk.gray('  [Enter to stay in ') +
      chalk.bold(current) +
      chalk.gray(']')
  );
  const answer = await ask(chalk.gray('> '));
  const n = parseInt(answer.trim(), 10);
  if (n === 1) return others[0];
  if (n === 2) return others[1];
  return current;
}

// ---------------------------------------------------------------------------
// PLAN MODE
// ---------------------------------------------------------------------------
async function planModeLoop(
  task: string,
  backendUrl: string,
  rl: readline.Interface,
  ask: (q: string) => Promise<string>
): Promise<'BUILD' | 'switch' | 'cancel' | 'done'> {
  console.log(chalk.bold('Task:'), chalk.white(task));
  console.log('');
  console.log(chalk.yellow('⏳ Fetching plan from backend...'));

  let steps: string[] = [];

  const keys = loadApiKeys();

  try {
    const response = await fetch(`${backendUrl}/api/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task, agent_role: 'engineer', agent_goal: '', api_key: keys.anthropic || '', openai_api_key: keys.openai || '', google_api_key: keys.google || '' }),
    });

    if (!response.ok) {
      console.error(chalk.red('Backend error — cannot fetch plan.'));
      return 'cancel';
    }

    const { run_id } = (await response.json()) as { run_id: string };
    tui.displayConnected(run_id);

    const streamResponse = await fetch(`${backendUrl}/api/stream/${run_id}`);
    const reader = streamResponse.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) throw new Error('No response body');

    let buffer = '';
    let planReceived = false;

    outer: while (true) {
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
          if (parsed.type === 'plan') {
            steps = (parsed.data['steps'] as string[]) || [];
            planReceived = true;
            break outer;
          } else if (parsed.type === 'error') {
            const errorMsg = (parsed.data['error'] as string) || (parsed.data['content'] as string) || 'Unknown error';
            tui.displayError(errorMsg);
            return 'cancel';
          }
        } catch {
          // ignore parse errors
        }
      }
    }

    reader.cancel();

    if (!planReceived || steps.length === 0) {
      console.log(chalk.yellow('No plan received from backend.'));
      steps = ['(no steps returned — execute anyway?)'];
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(chalk.red('Error: ' + msg));
    return 'cancel';
  }

  // Display the plan
  displayPlanSteps(steps);

  // Approval loop
  while (true) {
    console.log(chalk.gray('Options: ') + chalk.bold('[Y]') + chalk.gray(' Execute  ') + chalk.bold('[e]') + chalk.gray(' Edit step  ') + chalk.bold('[s]') + chalk.gray(' Switch mode  ') + chalk.bold('[Esc/n]') + chalk.gray(' Cancel'));
    const answer = (await ask(tui.displayPermissionPrompt('Execute this plan?'))).trim().toLowerCase();

    if (answer === '' || answer === 'y') {
      return 'BUILD';
    }
    if (answer === 'n' || answer === '\u001b') {
      console.log(chalk.yellow('\nExecution cancelled.\n'));
      return 'cancel';
    }
    if (answer === 'e' || answer === 'edit') {
      steps = await editPlanSteps(steps, ask);
      displayPlanSteps(steps);
      continue;
    }
    if (answer === 's' || answer === 'switch') {
      return 'switch';
    }
  }
}

function displayPlanSteps(steps: string[]) {
  console.log('');
  console.log(chalk.bold.cyan('┌─────────────────────────────────────────────────────────┐'));
  console.log(chalk.bold.cyan('│') + chalk.bold.white('  📋 Execution Plan                                      ') + chalk.bold.cyan('│'));
  console.log(chalk.bold.cyan('├─────────────────────────────────────────────────────────┤'));
  steps.forEach((step, i) => {
    const label = `  Step ${i + 1}: `;
    const maxContentWidth = 57 - label.length;
    const truncated = step.length > maxContentWidth ? step.substring(0, maxContentWidth - 3) + '...' : step;
    const line = label + truncated;
    const padded = line.padEnd(57);
    console.log(chalk.bold.cyan('│') + chalk.white(padded) + chalk.bold.cyan('│'));
  });
  console.log(chalk.bold.cyan('└─────────────────────────────────────────────────────────┘'));
  console.log('');
}

async function editPlanSteps(steps: string[], ask: (q: string) => Promise<string>): Promise<string[]> {
  console.log(chalk.gray('Enter step number to edit, or press Enter to finish editing:'));
  const numStr = await ask(chalk.bold('Step #: '));
  const n = parseInt(numStr.trim(), 10);
  if (!isNaN(n) && n >= 1 && n <= steps.length) {
    console.log(chalk.gray(`Current: ${steps[n - 1]}`));
    const updated = await ask(chalk.bold('New text: '));
    if (updated.trim()) steps[n - 1] = updated.trim();
  }
  return steps;
}

// ---------------------------------------------------------------------------
// BUILD MODE
// ---------------------------------------------------------------------------
async function buildModeLoop(
  task: string,
  backendUrl: string,
  rl: readline.Interface,
  ask: (q: string) => Promise<string>
): Promise<'switch' | 'done'> {
  console.log(chalk.bold('Task:'), chalk.white(task));
  tui.displayConnecting();

  const keys = loadApiKeys();

  try {
    const response = await fetch(`${backendUrl}/api/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task, agent_role: 'engineer', agent_goal: '', api_key: keys.anthropic || '', openai_api_key: keys.openai || '', google_api_key: keys.google || '' }),
    });

    if (!response.ok) {
      console.error(chalk.red('Backend error'));
      return 'done';
    }

    const { run_id } = (await response.json()) as { run_id: string };
    tui.displayConnected(run_id);

    console.log(chalk.bold.green('⚙️  Executing...'));
    tui.displayStreamStart();

    const streamResponse = await fetch(`${backendUrl}/api/stream/${run_id}`);
    const reader = streamResponse.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) throw new Error('No response body');

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

          const type = parsed.type;

          if (type === 'execution_complete') {
            const summary = (parsed.data['summary'] as string) || '';
            const count = (parsed.data['todos_completed'] as number) || 0;
            tui.displayResults(summary, count);
            tui.displayComplete(tui.getElapsedTime());
            break;
          } else if (type === 'done') {
            tui.displayEvent(type, { content: 'Task completed successfully' });
            tui.displayComplete(tui.getElapsedTime());
            break;
          } else if (type === 'error') {
            const errorMsg = (parsed.data['error'] as string) || (parsed.data['content'] as string) || 'Unknown error';
            tui.displayError(errorMsg);
            break;
          } else if (type !== 'plan') {
            tui.displayEvent(type, parsed.data);
          }
        } catch {
          // ignore parse errors
        }
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(chalk.red('Error: ' + msg));
  }

  // Post-execution options
  console.log('');
  console.log(
    chalk.gray('Options: ') +
      chalk.bold('[Enter]') +
      chalk.gray(' Done  ') +
      chalk.bold('[s]') +
      chalk.gray(' Switch mode')
  );
  const answer = (await ask(chalk.bold('> '))).trim().toLowerCase();
  if (answer === 's' || answer === 'switch') return 'switch';
  return 'done';
}

// ---------------------------------------------------------------------------
// BRAINSTORM MODE
// ---------------------------------------------------------------------------
async function brainstormModeLoop(
  task: string,
  backendUrl: string,
  rl: readline.Interface,
  ask: (q: string) => Promise<string>
): Promise<'switch' | 'done'> {
  console.log(chalk.bold('Starting topic:'), chalk.white(task));
  console.log(chalk.gray('Ask follow-up questions. Type "done" to exit, "switch" to change mode.\n'));

  let currentQuestion = task;

  while (true) {
    console.log(chalk.bold.blue('💡 Thinking...'));

    try {
      const keys = loadApiKeys();
      const response = await fetch(`${backendUrl}/api/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task: currentQuestion,
          agent_role: 'brainstorm',
          agent_goal: 'Generate ideas, considerations, and suggestions. Be concise and helpful.',
          api_key: keys.anthropic || '',
          openai_api_key: keys.openai || '',
          google_api_key: keys.google || '',
        }),
      });

      if (response.ok) {
        const { run_id } = (await response.json()) as { run_id: string };
        const streamResponse = await fetch(`${backendUrl}/api/stream/${run_id}`);
        const reader = streamResponse.body?.getReader();
        const decoder = new TextDecoder();

        if (reader) {
          let buffer = '';
          let responseText = '';

          outer: while (true) {
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
                const type = parsed.type;
                const data = parsed.data;

                if (type === 'done' || type === 'execution_complete') {
                  const summary = (data['summary'] as string) || '';
                  if (summary) responseText = summary;
                  break outer;
                } else if (type === 'error') {
                  const errorMsg = (data['error'] as string) || (data['content'] as string) || 'Unknown error';
                  responseText += errorMsg + '\n';
                  break outer;
                } else if (type === 'thought' || type === 'observation') {
                  const content = (data['content'] as string) || '';
                  if (content) responseText += content + '\n';
                } else if (type === 'agent_response' || type === 'agent_result') {
                  // Handle agent response events
                  const content = (data['content'] as string) || (data['result'] as string) || '';
                  if (content) responseText += content + '\n';
                } else if (type === 'action') {
                  const content = (data['content'] as string) || '';
                  if (content) responseText += content + '\n';
                } else if (type === 'agent_working') {
                  // Skip intermediate agent_working events in brainstorm mode
                } else if (type !== 'plan') {
                  // Catch-all for any other event types
                  const content = (data['content'] as string) || (data['response'] as string) || '';
                  if (content) responseText += content + '\n';
                }
              } catch {
                // ignore parse errors
              }
            }
          }
          reader.cancel();

          if (responseText.trim()) {
            tui.displayBrainstormResponse(responseText.trim());
          } else {
            console.log(chalk.gray('(No response received from agent)'));
          }
        }
      } else {
        console.log(chalk.red('Could not reach backend for brainstorm response.'));
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(chalk.red('Error: ' + msg));
    }

    const followUp = await ask(chalk.bold.blue('💬 You: '));
    const lower = followUp.trim().toLowerCase();

    if (lower === 'done' || lower === 'exit') return 'done';
    if (lower === 'switch') return 'switch';
    if (!followUp.trim()) continue;

    currentQuestion = followUp.trim();
  }
}
