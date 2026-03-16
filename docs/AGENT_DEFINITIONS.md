# Agent Definitions

This document describes how to define, load, and customize agents for the Deep Agents experience layer.

---

## File Format

Agent definitions are YAML files stored in `~/.buildwithnexus/agents/`. Each file defines one agent.

```yaml
name: engineer
role: Senior Software Engineer
goal: Write clean, correct, and maintainable code that fulfills the task specification.
backstory: |
  You are a senior engineer with 10+ years of experience. You read existing
  code carefully, follow conventions, and write minimal diffs that solve the problem.
tools:
  - read_file
  - write_file
  - bash
  - search
model: claude-sonnet-4-5
temperature: 0.2
```

### Fields

| Field         | Required | Description |
|---------------|----------|-------------|
| `name`        | yes      | Unique identifier (used as filename, no spaces) |
| `role`        | yes      | One-line description of the agent's role |
| `goal`        | yes      | What the agent is trying to achieve |
| `backstory`   | yes      | System-prompt context that shapes the agent's behavior |
| `tools`       | yes      | List of tool names the agent may use |
| `model`       | no       | Model ID (default: `claude-sonnet-4-5`) |
| `temperature` | no       | Sampling temperature 0–1 (default: `0.5`) |

---

## Loading Agents

```typescript
import { AgentLoader } from './src/deep-agents/config/agent-loader.js';

const loader = new AgentLoader();

// Load all agents from ~/.buildwithnexus/agents/ (falls back to built-ins)
const agents = loader.loadAllAgents();

// Load a single agent from an explicit path
const agent = loader.loadFromYAML('/path/to/my-agent.yaml');

// Save a new agent definition
loader.saveAgent({
  name: 'analyst',
  role: 'Data Analyst',
  goal: 'Extract insights from structured data.',
  backstory: 'You are a data analyst...',
  tools: ['read_file', 'python_repl'],
  model: 'claude-sonnet-4-5',
  temperature: 0.3,
});
```

---

## Built-in Agent Templates

The following agents ship with the CLI (`agentTemplates` from `agent-templates.ts`):

| Name          | Role                     | Model               | Temp |
|---------------|--------------------------|---------------------|------|
| `ceo`         | Chief Executive Officer  | claude-opus-4-5     | 0.7  |
| `engineer`    | Senior Software Engineer | claude-sonnet-4-5   | 0.2  |
| `researcher`  | Research Analyst         | claude-sonnet-4-5   | 0.5  |
| `reviewer`    | Code Reviewer            | claude-sonnet-4-5   | 0.1  |
| `planner`     | Project Planner          | claude-opus-4-5     | 0.4  |
| `qa_engineer` | QA Engineer              | claude-sonnet-4-5   | 0.2  |
| `devops`      | DevOps Engineer          | claude-sonnet-4-5   | 0.3  |
| `designer`    | UX/UI Designer           | claude-sonnet-4-5   | 0.6  |

---

## Customization

To override a built-in agent, create a file with the same `name` in `~/.buildwithnexus/agents/`. The file-based agent takes precedence over the built-in template.

To add a brand-new agent, create a new YAML file. Any tools listed in the `tools` array must be available in the runtime environment.

---

## Tool Reference

Common tool names used in agent definitions:

| Tool name       | Description |
|-----------------|-------------|
| `read_file`     | Read a file from the filesystem |
| `write_file`    | Write or overwrite a file |
| `bash`          | Execute a shell command |
| `search`        | Web or codebase search |
| `write_todos`   | Write a structured todo list |
| `spawn_subagent`| Delegate a subtask to another agent |
| `python_repl`   | Execute Python in a persistent REPL |
