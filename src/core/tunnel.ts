import { sshExec } from "./ssh.js";

export async function installCloudflared(sshPort: number, arch: "arm64" | "x64"): Promise<void> {
  const debArch = arch === "arm64" ? "arm64" : "amd64";
  const url = `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${debArch}.deb`;

  await sshExec(sshPort, `curl -sL ${url} -o /tmp/cloudflared.deb && sudo dpkg -i /tmp/cloudflared.deb`);
}

export async function startTunnel(sshPort: number): Promise<string | null> {
  // Start cloudflared in background, capture URL
  await sshExec(sshPort, [
    "nohup cloudflared tunnel --url http://localhost:4200",
    "> /tmp/tunnel.log 2>&1 &",
    "disown",
  ].join(" "));

  // Wait for URL to appear in logs (up to 30s)
  const start = Date.now();
  while (Date.now() - start < 30_000) {
    try {
      const { stdout } = await sshExec(sshPort, "grep -o 'https://[^ ]*\\.trycloudflare\\.com' /tmp/tunnel.log 2>/dev/null | head -1");
      if (stdout.includes("https://")) {
        const url = stdout.trim();
        await sshExec(sshPort, `echo "${url}" > /tmp/tunnel-url.txt`);
        return url;
      }
    } catch { /* not ready */ }
    await new Promise((r) => setTimeout(r, 3_000));
  }

  return null;
}

export async function stopTunnel(sshPort: number): Promise<void> {
  await sshExec(sshPort, "pkill -f cloudflared || true");
}
