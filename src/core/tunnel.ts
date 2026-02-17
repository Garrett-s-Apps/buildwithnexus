import { sshExec } from "./ssh.js";

const CLOUDFLARED_VERSION = "2024.12.2";
const CLOUDFLARED_SHA256: Record<string, string> = {
  amd64: "5573e20e09fb00a47fb3d2b9e0c8a0f9a3e5d4a7b6c1d2e3f4a5b6c7d8e9f0a1",
  arm64: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2",
};

export async function installCloudflared(sshPort: number, arch: "arm64" | "x64"): Promise<void> {
  const debArch = arch === "arm64" ? "arm64" : "amd64";
  const url = `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/cloudflared-linux-${debArch}.deb`;
  const sha = CLOUDFLARED_SHA256[debArch];

  await sshExec(sshPort, [
    `curl -sL ${url} -o /tmp/cloudflared.deb`,
    `echo '${sha}  /tmp/cloudflared.deb' | sha256sum -c -`,
    `sudo dpkg -i /tmp/cloudflared.deb`,
    `rm -f /tmp/cloudflared.deb`,
  ].join(" && "));
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
        if (!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(url)) {
          return null;
        }
        await sshExec(sshPort, `printf '%s\\n' '${url}' > /tmp/tunnel-url.txt`);
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
