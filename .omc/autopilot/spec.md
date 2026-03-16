# Buildwithnexus API Key Management & Mode Switching - Complete Specification

## PHASE 0: EXPANSION COMPLETE

### Root Cause Analysis
The "ANTHROPIC_API_KEY not set" error happens because:
1. `init-command.ts` writes keys to `~/.env.local`
2. `init-command.ts` then calls `process.exit(0)` forcing a restart
3. User restarts, `bin.ts` loads `~/.env.local` via dotenv, continues
4. If user skips init, no `.env.local` exists, interactive mode detects missing key and re-triggers init

The fix requires:
1. After writing `~/.env.local`, reload env vars WITHOUT exiting
2. Make Anthropic key optional (all keys optional)
3. Add Gemini/Google key to init prompts
4. Implement Shift+Tab mode cycling (stretch goal)
5. Support multi-provider API key passing to backend

---

## Requirements Summary

### Functional Requirements
- FR-1: Prompt for API keys on first run (Anthropic, OpenAI, Gemini - ALL OPTIONAL)
- FR-2: Store keys in `~/.env.local`
- FR-3: Load keys from `~/.env.local` on startup
- FR-4: Pass api_key(s) in POST request to backend for all three modes
- FR-5: Support mode switching with "switch"/"s" command AND Shift+Tab (if time permits)
- FR-6: Brainstorm mode works end-to-end without API key errors

### Non-Functional Requirements
- NF-1: File permissions on `~/.env.local` must be 0o600 (readable only by owner)
- NF-2: No new dependencies (use existing dotenv, @inquirer/prompts, readline)
- NF-3: Backward compatible with existing POST body structure
- NF-4: Auto-detect available key on startup (if multiple providers)

### Acceptance Criteria
1. First run with no `~/.env.local` → prompts for keys → can skip all three → stores to `~/.env.local`
2. After init completes → drops directly into interactive mode (NO restart)
3. Brainstorm mode: select topic → receives Haiku response (no "ANTHROPIC_API_KEY not set" error)
4. All keys are optional (can proceed with zero keys, warns user, or can proceed with any single key)
5. Shift+Tab in interactive mode cycles PLAN → BUILD → BRAINSTORM → PLAN (stretch)

---

## Implementation Plan

### Phase 1: Create Config Module
**File:** `src/core/config.ts`
- `loadApiKeys()` → reads Anthropic, OpenAI, Gemini from process.env
- `resolveApiKey(preferred?)` → returns best available key
- `hasAnyKey()` → true if at least one key configured
- `reloadEnv()` → re-loads `~/.env.local` without restart

### Phase 2: Fix init-command.ts
- Add Gemini/Google key prompt (optional, like OpenAI)
- Make Anthropic key optional (no validation block on empty)
- After writing `~/.env.local`, call `config.reloadEnv()` instead of `process.exit(0)`
- Set file permissions to 0o600 on written file
- Add validation via existing `dlp.validateKeyValue()` for all three keys

### Phase 3: Fix interactive.ts
- Remove hard gate on `ANTHROPIC_API_KEY` (line 10-19)
- Use `config.hasAnyKey()` to check for any key instead
- Resolve api_key per provider using `config.resolveApiKey()`
- Add Shift+Tab raw-mode keypress handler in `selectMode()` and brainstorm loop (stretch goal)
- Support "switch" command in brainstorm prompt (already partially done)

### Phase 4: Fix run-command.ts & deep-agents-bin.ts
- Pass multi-provider keys in POST body (api_keys field)
- Backward compat: also pass primary `api_key` field

### Phase 5: Tests & Validation
- Unit tests for config.ts (loadApiKeys, resolveApiKey, hasAnyKey)
- Integration test: init flow → no restart needed
- Integration test: brainstorm mode → end-to-end response

---

## Files to Modify

| File | Changes | Effort |
|------|---------|--------|
| `src/core/config.ts` | CREATE | Low |
| `src/cli/init-command.ts` | Add Gemini prompt, make Anthropic optional, reload env, set 0o600 | Medium |
| `src/cli/interactive.ts` | Remove hard gate, add config.hasAnyKey(), add Shift+Tab handler (stretch) | Medium |
| `src/cli/run-command.ts` | Pass multi-provider keys in POST body | Low |
| `src/deep-agents-bin.ts` | Add api_key to POST body | Low |
| `tests/config.test.ts` | CREATE | Low |

---

## API Changes

### Backend POST /api/run

**Current:**
```typescript
{ task, agent_role, agent_goal, api_key }
```

**New (backward compatible):**
```typescript
{
  task: string;
  agent_role: string;
  agent_goal: string;
  api_key: string;           // Primary key (backward compat)
  api_keys?: {               // NEW: multi-provider
    anthropic?: string;
    openai?: string;
    gemini?: string;
  }
}
```

---

## Security & Permissions

- `~/.env.local` created with `fs.writeFileSync(path, content, { mode: 0o600 })`
- Keys validated via existing `dlp.validateKeyValue()` before storing
- No secrets written to logs or stdout (already handled by password() prompts)

---

## Success Criteria for Autopilot

1. ✅ Analyst & Architect output complete
2. ✅ Spec saved to `.omc/autopilot/spec.md`
3. → Planning phase: create detailed task breakdown
4. → Execution phase: implement with parallel agents
5. → QA phase: test all scenarios
6. → Validation phase: architect review

