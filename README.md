# buildwithnexus

[![npm version](https://img.shields.io/npm/v/buildwithnexus?style=flat-square&color=blue)](https://www.npmjs.com/package/buildwithnexus)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)

Interactive CLI for NEXUS — a 56-agent autonomous software engineering organization. Tell it what to build. It figures out the rest.

## Quick Start

```bash
npm install -g buildwithnexus
buildwithnexus
```

On first run you'll be prompted to set your Anthropic API key. Keys are stored in `~/.buildwithnexus/.env.keys`.

## What It Does

Launch an interactive shell with three execution modes:

- **PLAN** — Break down your request into a reviewable step-by-step plan
- **BUILD** — Execute directly with live agent streaming
- **BRAINSTORM** — Free-form exploration with the NEXUS CPO streaming their reasoning

```
╔════════════════════════════════════════════════════════════╗
║        Nexus - Autonomous Agent Orchestration              ║
║        v0.8.10                                              ║
╚════════════════════════════════════════════════════════════╝

📝 Task: Build a REST API for user authentication

Press Enter to use PLAN or choose a mode:
  [1] PLAN   design & break down steps
  [2] BUILD  execute with live streaming
  [3] BRAINSTORM  free-form explore & Q&A
```

## Commands

### Core (Python backend required)

| Command | Description |
|---------|-------------|
| `buildwithnexus` | Launch interactive shell (PLAN/BUILD/BRAINSTORM) |
| `buildwithnexus da-init` | Set up API keys in `~/.buildwithnexus/.env.keys` |
| `buildwithnexus run <task>` | Run a task directly via the backend |
| `buildwithnexus brainstorm [idea]` | Brainstorm an idea with the NEXUS CPO |
| `buildwithnexus server` | Start the NEXUS Python backend server |
| `buildwithnexus da-status` | Check backend connectivity |
| `buildwithnexus doctor` | Run diagnostics (backend health + environment) |
| `buildwithnexus logs [-f]` | View server logs (stream with `-f`) |
| `buildwithnexus keys list` | List configured API keys |
| `buildwithnexus keys set <KEY_NAME>` | Set an API key |

### Docker infrastructure (requires Docker + full NEXUS setup)

| Command | Description |
|---------|-------------|
| `buildwithnexus 99 [instruction]` | AI pair-programming via full NEXUS engine |
| `buildwithnexus start` | Start full NEXUS Docker services |
| `buildwithnexus stop` | Stop NEXUS Docker services |
| `buildwithnexus status [--json]` | Show Docker container health |
| `buildwithnexus dashboard` | Open the NEXUS dashboard at `localhost:4200/dashboard` |
| `buildwithnexus update` | Update to the latest version |
| `buildwithnexus destroy [--force]` | Remove NEXUS and all data |
| `buildwithnexus ssh` | Open SSH session into the sandbox |

## Architecture

```
buildwithnexus CLI (TypeScript/Node.js)
         │
         │ SSE streaming
         ▼
NEXUS Backend (Python FastAPI, port 4200)
         │
         ▼
LangGraph Runtime → 56-agent organization
  • CPO (Opus) — brainstorm + strategy
  • VP Engineering → 19 eng agents
  • Product Management → 2 agents
  • QA Team → 7 agents
  • Security Team → 3 agents
  • ML & Data → 6 agents
  • Salesforce → 10 agents
  • Documentation → 2 agents
  • Consultant → 1 agent
```

## Requirements

- **Node.js** >= 18
- **Anthropic API key** (`sk-ant-...`) from [console.anthropic.com](https://console.anthropic.com)
- NEXUS backend running on `localhost:4200` (for PLAN/BUILD/BRAINSTORM modes)

Optional:
- OpenAI API key (o3 reasoning support)
- Google API key (Gemini multimodal support)

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | — | Overrides stored key |
| `OPENAI_API_KEY` | — | Overrides stored key |
| `GOOGLE_API_KEY` | — | Overrides stored key |
| `BACKEND_URL` | `http://localhost:4200` | NEXUS backend address |
| `NEXUS_BACKEND_DIR` | `~/Projects/nexus` | Path to NEXUS backend for auto-start |

## Security

- API keys stored in `~/.buildwithnexus/.env.keys` with `0600` permissions
- HMAC-SHA256 tamper detection on `.env.keys`
- Input sanitization and output redaction via DLP layer
- Backend URL validation before transmitting API keys
- Audit trail at `~/.buildwithnexus/audit.log`

## Links

- **npm:** [npmjs.com/package/buildwithnexus](https://www.npmjs.com/package/buildwithnexus)
- **Docs:** [buildwithnexus.dev](https://buildwithnexus.dev)
- **GitHub:** [github.com/Garretts-Apps/buildwithnexus](https://github.com/Garretts-Apps/buildwithnexus)

## License

MIT
