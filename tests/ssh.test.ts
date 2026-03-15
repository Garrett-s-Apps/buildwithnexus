import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// classifySshError — tested indirectly via probeVmReady
//
// The function is module-private, so we drive it through probeVmReady which
// calls it internally. We mock:
//   • net (isTcpPortOpen) — always returns true so the SSH leg is reached
//   • node-ssh (NodeSSH.connect) — throws the specific error strings
//   • ../src/core/secrets.js — provides NEXUS_HOME without touching the FS
//   • ../src/core/dlp.js — stub audit/redact/scrubEnv
//   • ../src/core/qemu.js — stub isVmRunning
// ---------------------------------------------------------------------------

vi.mock("node:net", () => {
  return {
    default: {
      createConnection: () => {
        const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
        const socket = {
          setTimeout: vi.fn(),
          destroy: vi.fn(),
          on(event: string, cb: (...args: unknown[]) => void) {
            listeners[event] = listeners[event] || [];
            listeners[event].push(cb);
            // Fire "connect" immediately on the next tick so isTcpPortOpen resolves true
            if (event === "connect") {
              Promise.resolve().then(() => cb());
            }
            return socket;
          },
        };
        return socket;
      },
    },
  };
});

vi.mock("../src/core/secrets.js", () => ({
  NEXUS_HOME: "/tmp/nexus-test-home",
}));

vi.mock("../src/core/dlp.js", () => ({
  audit: vi.fn(),
  redact: (s: string) => s,
  scrubEnv: () => ({}),
}));

vi.mock("../src/core/qemu.js", () => ({
  isVmRunning: vi.fn(() => true),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    default: {
      ...actual.default,
      existsSync: vi.fn(() => false),
      readFileSync: vi.fn(() => ""),
      writeFileSync: vi.fn(),
      mkdirSync: vi.fn(),
      chmodSync: vi.fn(),
      appendFileSync: vi.fn(),
      unlinkSync: vi.fn(),
    },
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns a NodeSSH mock factory where connect() rejects with the given message.
 */
function makeSshMock(rejectWith: string | null) {
  const connectFn = rejectWith === null
    ? vi.fn().mockResolvedValue(undefined)
    : vi.fn().mockRejectedValue(new Error(rejectWith));
  return {
    NodeSSH: vi.fn().mockImplementation(function () {
      this.connect = connectFn;
      this.dispose = vi.fn();
    }),
  };
}

// ---------------------------------------------------------------------------
// probeVmReady — six scenarios
// ---------------------------------------------------------------------------

describe("probeVmReady", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns "ready" when SSH connect succeeds (VM boots quickly)', async () => {
    vi.doMock("node-ssh", () => makeSshMock(null));
    const { probeVmReady } = await import("../src/core/ssh.js");
    const result = await probeVmReady(2222);
    expect(result).toBe("ready");
  });

  it('returns "sshd_up_user_missing" when SSH reports all authentication methods failed (cloud-init slow)', async () => {
    vi.doMock("node-ssh", () =>
      makeSshMock("All configured authentication methods failed"),
    );
    const { probeVmReady } = await import("../src/core/ssh.js");
    const result = await probeVmReady(2222);
    expect(result).toBe("sshd_up_user_missing");
  });

  it('returns "not_reachable" when SSH reports host key mismatch', async () => {
    vi.doMock("node-ssh", () =>
      makeSshMock("Host denied (verification failed)"),
    );
    const { probeVmReady } = await import("../src/core/ssh.js");
    const result = await probeVmReady(2222);
    expect(result).toBe("not_reachable");
  });

  it('returns "not_reachable" when port is closed (ECONNREFUSED — connection refused)', async () => {
    // Override net mock to simulate a closed port for this test only
    vi.doMock("node:net", () => ({
      default: {
        createConnection: () => {
          const socket = {
            setTimeout: vi.fn(),
            destroy: vi.fn(),
            on(event: string, cb: (...args: unknown[]) => void) {
              if (event === "error") Promise.resolve().then(() => cb(new Error("ECONNREFUSED")));
              return socket;
            },
          };
          return socket;
        },
      },
    }));
    vi.doMock("node-ssh", () => makeSshMock(null)); // won't be reached
    const { probeVmReady } = await import("../src/core/ssh.js");
    const result = await probeVmReady(2222);
    expect(result).toBe("not_reachable");
  });

  it('returns "not_reachable" when SSH reports connection timed out', async () => {
    vi.doMock("node-ssh", () => makeSshMock("Timed out while waiting for handshake"));
    const { probeVmReady } = await import("../src/core/ssh.js");
    const result = await probeVmReady(2222);
    expect(result).toBe("not_reachable");
  });

  it('returns "not_reachable" for unknown SSH errors', async () => {
    vi.doMock("node-ssh", () => makeSshMock("Something completely unexpected happened"));
    const { probeVmReady } = await import("../src/core/ssh.js");
    const result = await probeVmReady(2222);
    expect(result).toBe("not_reachable");
  });
});

// ---------------------------------------------------------------------------
// classifySshError — classification logic verified via error message fixtures
//
// We drive all five categories through probeVmReady (which calls classifySshError
// internally) using the exact error strings that node-ssh / ssh2 produces.
// ---------------------------------------------------------------------------

describe("classifySshError — error message fixtures", () => {
  beforeEach(() => {
    vi.resetModules();
    // Re-apply the net mock so isTcpPortOpen resolves true after module reset.
    // vi.resetModules() clears the module registry, which means the hoisted
    // top-level vi.mock("node:net") is no longer active for freshly imported
    // modules. vi.doMock registers it for the next import in this test.
    vi.doMock("node:net", () => ({
      default: {
        createConnection: () => {
          const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
          const socket = {
            setTimeout: vi.fn(),
            destroy: vi.fn(),
            on(event: string, cb: (...args: unknown[]) => void) {
              listeners[event] = listeners[event] || [];
              listeners[event].push(cb);
              if (event === "connect") {
                Promise.resolve().then(() => cb());
              }
              return socket;
            },
          };
          return socket;
        },
      },
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('classifies "All configured authentication methods failed" as AuthFailure → sshd_up_user_missing', async () => {
    vi.doMock("node-ssh", () =>
      makeSshMock("All configured authentication methods failed"),
    );
    const { probeVmReady } = await import("../src/core/ssh.js");
    // AuthFailure maps to "sshd_up_user_missing" in probeVmReady
    expect(await probeVmReady(2222)).toBe("sshd_up_user_missing");
  });

  it('classifies "ECONNREFUSED" as Transient → not_reachable when thrown inside SSH connect', async () => {
    vi.doMock("node-ssh", () => makeSshMock("ECONNREFUSED 127.0.0.1:2222"));
    const { probeVmReady } = await import("../src/core/ssh.js");
    expect(await probeVmReady(2222)).toBe("not_reachable");
  });

  it('classifies "Host denied (verification failed)" as HostKeyMismatch → not_reachable', async () => {
    vi.doMock("node-ssh", () =>
      makeSshMock("Host denied (verification failed)"),
    );
    const { probeVmReady } = await import("../src/core/ssh.js");
    expect(await probeVmReady(2222)).toBe("not_reachable");
  });

  it('classifies "Timed out" as Timeout → not_reachable', async () => {
    vi.doMock("node-ssh", () => makeSshMock("Timed out while waiting for handshake"));
    const { probeVmReady } = await import("../src/core/ssh.js");
    expect(await probeVmReady(2222)).toBe("not_reachable");
  });

  it("classifies unknown error messages as Unknown → not_reachable", async () => {
    vi.doMock("node-ssh", () => makeSshMock("Unexpected protocol error"));
    const { probeVmReady } = await import("../src/core/ssh.js");
    expect(await probeVmReady(2222)).toBe("not_reachable");
  });
});

// ---------------------------------------------------------------------------
// addSshConfig — port ordering: called in Phase 6 after port resolution
// ---------------------------------------------------------------------------

describe("addSshConfig", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes a Host nexus-vm block with the given port", async () => {
    const writes: Array<{ path: string; content: string }> = [];
    vi.doMock("node:fs", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs")>();
      return {
        ...actual,
        default: {
          ...actual.default,
          existsSync: vi.fn(() => false),
          writeFileSync: vi.fn((p: string, content: string) => {
            writes.push({ path: String(p), content: String(content) });
          }),
          mkdirSync: vi.fn(),
          readFileSync: vi.fn(() => ""),
          appendFileSync: vi.fn(),
        },
      };
    });
    const { addSshConfig } = await import("../src/core/ssh.js");
    addSshConfig(2345);
    expect(writes.length).toBeGreaterThan(0);
    const written = writes[0].content;
    expect(written).toContain("Host nexus-vm");
    expect(written).toContain("Port 2345");
  });

  it("does not duplicate the block when Host nexus-vm already exists", async () => {
    const appends: string[] = [];
    vi.doMock("node:fs", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs")>();
      return {
        ...actual,
        default: {
          ...actual.default,
          existsSync: vi.fn(() => true),
          readFileSync: vi.fn(() => "Host nexus-vm\n    Port 2222\n"),
          writeFileSync: vi.fn(),
          mkdirSync: vi.fn(),
          appendFileSync: vi.fn((_p: string, content: string) => {
            appends.push(String(content));
          }),
        },
      };
    });
    const { addSshConfig } = await import("../src/core/ssh.js");
    addSshConfig(2222);
    expect(appends).toHaveLength(0);
  });

  it("appends block to existing config that does not yet have nexus-vm", async () => {
    const appends: string[] = [];
    vi.doMock("node:fs", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs")>();
      return {
        ...actual,
        default: {
          ...actual.default,
          existsSync: vi.fn(() => true),
          readFileSync: vi.fn(() => "Host other-server\n    Port 22\n"),
          writeFileSync: vi.fn(),
          mkdirSync: vi.fn(),
          appendFileSync: vi.fn((_p: string, content: string) => {
            appends.push(String(content));
          }),
        },
      };
    });
    const { addSshConfig } = await import("../src/core/ssh.js");
    addSshConfig(2222);
    expect(appends.length).toBeGreaterThan(0);
    expect(appends[0]).toContain("Host nexus-vm");
  });
});

// ---------------------------------------------------------------------------
// init.ts port ordering — addSshConfig called in Phase 6, after resolvePortConflicts
// ---------------------------------------------------------------------------

describe("init.ts — addSshConfig is called in Phase 6 after port resolution", () => {
  // Use node:fs/promises (not mocked) to read the real source file.
  // The top-level vi.mock("node:fs") stubs the sync API, but fs/promises is
  // a separate module binding and is untouched by that mock.

  it("addSshConfig appears after resolvePortConflicts in the VM Launch phase block", async () => {
    const { readFile } = await import("node:fs/promises");
    const initSrc = await readFile(
      new URL("../src/commands/init.ts", import.meta.url).pathname,
      "utf-8",
    );

    // Locate the "VM Launch" phase name in the phases array
    const phase6Start = initSrc.indexOf('"VM Launch"');
    expect(phase6Start, 'Phase named "VM Launch" must exist in init.ts').toBeGreaterThan(-1);

    // Both resolvePortConflicts and addSshConfig must appear after that marker
    const resolveIdx = initSrc.indexOf("resolvePortConflicts", phase6Start);
    const addSshIdx = initSrc.indexOf("addSshConfig(", phase6Start);

    expect(resolveIdx, "resolvePortConflicts must appear in VM Launch phase").toBeGreaterThan(-1);
    expect(addSshIdx, "addSshConfig must appear in VM Launch phase").toBeGreaterThan(-1);
    // addSshConfig must come after resolvePortConflicts within the same phase
    expect(addSshIdx, "addSshConfig must be called after resolvePortConflicts").toBeGreaterThan(resolveIdx);
  });

  it("addSshConfig does NOT appear in the SSH Key Setup phase block", async () => {
    const { readFile } = await import("node:fs/promises");
    const initSrc = await readFile(
      new URL("../src/commands/init.ts", import.meta.url).pathname,
      "utf-8",
    );

    const phase3Start = initSrc.indexOf('"SSH Key Setup"');
    const phase4Start = initSrc.indexOf('"VM Image Download"');
    expect(phase3Start, 'Phase named "SSH Key Setup" must exist in init.ts').toBeGreaterThan(-1);
    expect(phase4Start, 'Phase named "VM Image Download" must exist after "SSH Key Setup"').toBeGreaterThan(phase3Start);

    const phase3Block = initSrc.slice(phase3Start, phase4Start);
    expect(phase3Block).not.toContain("addSshConfig(");
  });
});
