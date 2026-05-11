# buildwithnexus

[![npm version](https://img.shields.io/npm/v/buildwithnexus?style=flat-square&color=blue)](https://www.npmjs.com/package/buildwithnexus)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)

Interactive CLI for NEXUS — a 56-agent autonomous software engineering organization. Tell it what to build. It figures out the rest.

> **🔍 Audit the roster:** [`spec/agents.public.yaml`](./spec/agents.public.yaml) — every agent's name, title, model, layer, org, tool grants, and `spawns_sdk` flag. The full system prompts stay in the private NEXUS engine; the architectural truth is published here.

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
  • Executive (10) — CEO, CPO, CFO, CRO, VPs, CISO, Director of Analytics, Head of Docs
  • Management (10) — Engineering managers, code review lead, QA lead, SF leads, PMs
  • Senior (12) — Chief Architect, Tech Lead, code reviewers, FSC + Service Cloud architects, PMs
  • Implementation (15) — Frontend, backend, DevOps, security, ML/AI/data, SF developers, tech writer
  • Quality (6) — Frontend/backend testers, unit test engineer, linting agent, test runners
  • Consultant (3) — UX, security consultant, executive consultant
```

See [`spec/agents.public.yaml`](./spec/agents.public.yaml) for the full per-agent definition (56 entries).

## Requirements

- **Node.js** >= 18
- **Anthropic API key** (`sk-ant-...`) from [console.anthropic.com](https://console.anthropic.com)
- NEXUS backend running on `localhost:4200` (for PLAN/BUILD/BRAINSTORM modes)

Optional:
- OpenAI API key (o3 reasoning support — used by the Chief Architect role)
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

CLI-level (this package):

- API keys stored in `~/.buildwithnexus/.env.keys` with `0600` permissions
- HMAC-SHA256 tamper detection on `.env.keys`
- Input sanitization and output redaction via DLP layer
- Backend URL validation before transmitting API keys
- Audit trail at `~/.buildwithnexus/audit.log`

Engine-level (NEXUS backend, when running locally):

- SQLCipher AES-256-CBC encryption at rest (PBKDF2, 256K iterations, per-DB salted derivation)
- JWT session tokens (30-day expiry, fingerprint-bound to UA + IP, HMAC-SHA256)
- Persistent rate-limit lockout (30s → 2m → 15m → 1h, survives restarts)
- Docker sandbox hardening: `--read-only`, `--cap-drop=ALL`, `--no-new-privileges`, memory/CPU caps, non-root
- CORS whitelist with Cloudflare tunnel ID validation (no wildcards)

These primitives are mapped to SOC 2 Type II control families. They are an engineering-grade implementation, **not a SOC 2 audit attestation**.

## Supply Chain

This package is published with:

- **npm provenance** (OIDC-signed SLSA build attestation) — every release is cryptographically tied to a specific GitHub Actions workflow run
- **CycloneDX SBOM** (`sbom.cdx.json`) attached to every GitHub Release
- **SHA256SUMS.txt** for the bundled tarball
- Reproducible bundle (deterministic file order, zeroed ownership, mtime pinned to source commit time)

To verify a release:

```sh
npm view buildwithnexus@<version> --json | jq .dist.attestations
```

Repository hardening: deny-by-default workflow permissions, pinned action versions (Dependabot-managed), `npm ci --ignore-scripts`, `npm audit --audit-level=high` blocking publish, OSSF Scorecard, CodeQL, dependency-review on PRs. Disclosure flow: see [`SECURITY.md`](./SECURITY.md).

## Links

- **npm:** [npmjs.com/package/buildwithnexus](https://www.npmjs.com/package/buildwithnexus)
- **Docs:** [buildwithnexus.dev](https://buildwithnexus.dev)
- **GitHub:** [github.com/Garretts-Apps/buildwithnexus](https://github.com/Garretts-Apps/buildwithnexus)
- **Public agent roster:** [`spec/agents.public.yaml`](./spec/agents.public.yaml)

## License

MIT
