import { describe, it, expect } from "vitest";
import net from "node:net";
import { findFreePort, isPortFree } from "../src/core/port.js";

function listen(port: number): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(port, "127.0.0.1", () => resolve(srv));
  });
}

describe("port", () => {
  it("isPortFree returns true for an unused port", async () => {
    expect(await isPortFree(54321)).toBe(true);
  });

  it("isPortFree returns false for an occupied port", async () => {
    const srv = await listen(0);
    const addr = srv.address();
    if (typeof addr !== "object" || !addr) throw new Error("no address");
    expect(await isPortFree(addr.port)).toBe(false);
    await new Promise<void>((r) => srv.close(() => r()));
  });

  it("findFreePort skips occupied ports and returns a free one", async () => {
    const srv = await listen(0);
    const addr = srv.address();
    if (typeof addr !== "object" || !addr) throw new Error("no address");
    const occupied = addr.port;
    const found = await findFreePort(occupied, occupied + 50);
    expect(found).toBeGreaterThan(occupied);
    await new Promise<void>((r) => srv.close(() => r()));
  });

  it("findFreePort throws when no port is free in range", async () => {
    await expect(findFreePort(1, 0)).rejects.toThrow(/No free port/);
  });
});
