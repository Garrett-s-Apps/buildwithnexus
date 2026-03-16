# Implementation Plan - buildwithnexus API Key Management

## Task Dependency Graph

```
Task 1 (config.ts) ─────┬──> Task 2 (init-command.ts)
                         │        │
                         │        └──> Task 3 (interactive.ts gate)
                         │
                         ├──> Task 4 (POST body: run-command, deep-agents-bin, interactive)
                         │
                         └──> Task 5 (tests)

Task 6 (Shift+Tab) ──────── STRETCH GOAL (defer)
```

## Task List (Execution Order)

### Task 1: Create `src/core/config.ts` Module (LOW EFFORT)
**Depends on:** Nothing
**Enables:** Tasks 2, 3, 4, 5
**Files:** NEW `src/core/config.ts`

Functions to implement:
- `loadApiKeys()` → `{ anthropic?, openai?, google? }`
- `resolveApiKey()` → string | undefined (priority: Anthropic > Google > OpenAI)
- `hasAnyKey()` → boolean
- `reloadEnv(envPath?)` → void (dotenv override=true)

Acceptance criteria:
- Module exports all 4 functions with TypeScript typing
- Functions correctly read from process.env
- reloadEnv() updates process.env from file

---

### Task 2: Fix `src/cli/init-command.ts` (MEDIUM EFFORT)
**Depends on:** Task 1
**Enables:** Task 3
**Files:** `src/cli/init-command.ts`

Changes:
1. Import `reloadEnv` from `../core/config.js`
2. Line 35-43: Make Anthropic optional (remove validate function, change message to "optional")
3. After line 47: Add Google/Gemini key prompt (password input, optional)
4. Lines 60-73: Update env template to conditionally include all three keys
5. Before writing: Validate at least ONE key is provided (error + retry or exit)
6. Line 75: Add `{ mode: 0o600 }` to fs.writeFileSync
7. After line 75: Call `reloadEnv(envPath)` instead of `process.exit(0)`

Acceptance criteria:
- User can skip Anthropic if providing Google or OpenAI
- Google/Gemini prompt appears and works
- .env.local has 0o600 permissions
- After init, env vars loaded without restart

---

### Task 3: Fix `src/cli/interactive.ts` - Remove Hard Gate (LOW-MEDIUM EFFORT)
**Depends on:** Task 1, Task 2
**Enables:** Task 6
**Files:** `src/cli/interactive.ts`

Changes:
1. Import: `import { hasAnyKey, reloadEnv } from '../core/config.js';`
2. Lines 9-19: Replace hard Anthropic gate with `hasAnyKey()` check
   - If false, run init then call `reloadEnv()`
   - Re-check hasAnyKey(), exit only if still false

Acceptance criteria:
- CLI boots without exit after first-time init
- Users with Google or OpenAI key only can use the tool
- No process.exit(0) after init

---

### Task 4: Multi-Provider Keys in POST Body (LOW EFFORT)
**Depends on:** Task 1
**Can run in parallel with:** Task 3, Task 5
**Files:** `src/cli/run-command.ts`, `src/deep-agents-bin.ts`, `src/cli/interactive.ts` (update POST body calls)

Changes to each file:
1. Import `loadApiKeys` from `../core/config.js`
2. Call `const keys = loadApiKeys()`
3. In POST body, send:
   ```
   api_key: keys.anthropic || '',
   openai_api_key: keys.openai || '',
   google_api_key: keys.google || '',
   ```
4. In `deep-agents-bin.ts`: Add dotenv loading at top (missing currently)

Acceptance criteria:
- All `/api/run` POST calls include all three provider keys
- deep-agents-bin.ts loads env properly
- Missing keys sent as empty string (backend decides)

---

### Task 5: Add Tests for `src/core/config.ts` (LOW EFFORT)
**Depends on:** Task 1
**Can run in parallel with:** Task 3, Task 4
**Files:** NEW `tests/config.test.ts`

Test cases:
1. loadApiKeys() returns all three when set
2. loadApiKeys() returns undefined for unset keys
3. hasAnyKey() returns false when no keys
4. hasAnyKey() returns true with any key
5. resolveApiKey() priority order (Anthropic > Google > OpenAI)
6. reloadEnv() updates process.env from file

Acceptance criteria:
- All tests pass via `npm test`
- Tests use proper env isolation (vi.stubEnv, cleanup)

---

### Task 6 (STRETCH): Shift+Tab Mode Cycling
**Depends on:** Task 3
**Status:** DEFER (ROI too low vs complexity)

---

## Execution Strategy

1. **Phase 2a (Sequential):**
   - Execute Task 1 (creates config.ts module)
   - Execute Task 2 (fixes init-command.ts, depends on Task 1)

2. **Phase 2b (Parallel):**
   - Execute Task 3 (interactive.ts gate)
   - Execute Task 4 (POST body)
   - Execute Task 5 (tests)

3. **Phase 3: QA**
   - Build: `npm run build`
   - Test: `npm test`
   - Manual test: init flow (no restart), brainstorm mode end-to-end

4. **Phase 4: Validation**
   - Code quality review
   - Security review (backward compat, no new vuln)
   - Functional completeness check

5. **Phase 5: Release**
   - Commit changes
   - Update version
   - Publish to npm

