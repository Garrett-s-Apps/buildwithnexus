# Deep Agents CLI UX

This document describes the terminal and dashboard UX for the Deep Agents experience layer in the Nexus CLI.

---

## Overview

Deep Agents adds a structured execution layer on top of the core Nexus runtime. It provides:

1. **PlanningREPL** — an interactive terminal REPL that displays the current todo plan and streams agent output.
2. **StreamFormatter** — renders classified agent events (text, tool use, observations) with consistent color coding.
3. **StateVisualizer** — displays state transitions as a live timeline.
4. **DashboardServer** — a local HTTP server at `http://localhost:4201` that serves an execution trace viewer.

---

## Planning Visualization

When an agent writes a todo list, `PlanningREPL.displayPlan()` renders it:

```
  Current Plan:
  ──────────────────────────────────────────────────────────
  ✓ [1] Research competitors              (done in 1m 42s)
        Identify top 5 competitors and their pricing
  ⚙ [2] Draft positioning doc            (in progress, 4 tool calls)
        Write a 1-page positioning document
  ○ [3] Review with CEO                  (waiting for task 2)
        Get sign-off on positioning
  ──────────────────────────────────────────────────────────
```

Status icons:
- `✓` (green) — completed
- `⚙` (cyan) — in progress
- `○` (dim) — pending

---

## ReAct Stream Formatting

`PlanningREPL.displayReAct()` renders the agent's reasoning chain:

```
  Thought     I need to find recent pricing data for the top 3 competitors
  Action      search[competitor pricing 2025 SaaS]
  Obs         Found 12 results. Top result: "Enterprise SaaS pricing benchmarks..."
```

This maps to the ReAct pattern (Reason + Act) used by most modern agent frameworks.

---

## Streaming Token Output

`PlanningREPL.streamToken(token)` writes directly to `process.stdout` without buffering, preserving the feel of real-time model output.

`StreamFormatter.token(t)` additionally tracks line state for clean interleaving with tool-use events.

---

## Human Interrupt Flow

At any decision point, agents can pause for human approval:

```
  Paused — Approve deploying to production? (yes/no)
  >
```

Implementation:

```typescript
const answer = await repl.pauseForInput('Approve deploying to production? (yes/no)');
if (answer.trim().toLowerCase() !== 'yes') {
  // abort or route to alternative plan
}
```

---

## Metrics Display

After each agent run, `PlanningREPL.displayMetrics()` shows:

```
  Metrics:
    Wall clock    4m 12s
    Cost          $0.0842
    Tokens        24,193
    Checkpoints   7
    Agent         engineer
```

---

## State Transitions

`StateVisualizer.record()` renders each transition as it happens:

```
  ◎ +0.0s   idle → planning
  ◈ +3.2s   planning → executing   (3.20s)
  ◈ +18.7s  executing → checkpoint  (15.50s)
  ✓ +22.1s  checkpoint → complete   (3.40s)
```

The compact status bar (for use in long-running sessions):

```
  engineer  |  [writing]  |  3 ckpt  |  $0.0421
```

---

## Dashboard

Start the dashboard server in your session:

```typescript
import { DashboardServer } from './src/deep-agents/dashboard/server.js';

const dashboard = new DashboardServer(4201);
dashboard.start();

// Push a checkpoint from code
dashboard.pushCheckpoint(currentState);
```

Then open `http://localhost:4201` in your browser to see:

- Sidebar list of all checkpoints with agent name and cost
- Detail pane with metric cards (wall clock, cost, tokens, checkpoints)
- Raw JSON state viewer
- Auto-refresh every 3 seconds

---

## Integration Example

```typescript
import { PlanningREPL, StreamFormatter, StateVisualizer, DashboardServer } from './src/deep-agents/__init__.js';

const repl = new PlanningREPL();
const formatter = new StreamFormatter();
const visualizer = new StateVisualizer();
const dashboard = new DashboardServer();

dashboard.start();

// Display plan
repl.displayPlan(todos);

// Stream agent output
for await (const event of agentStream) {
  formatter.format(event);
  if (event.type === 'agent_switch') {
    visualizer.record({ from: prev, to: event.agentName, status: 'start', timestampMs: Date.now() });
  }
}

// Show final metrics
repl.displayMetrics(finalState);
dashboard.pushCheckpoint(finalState);

repl.close();
dashboard.stop();
```
