import { sshExec } from "./ssh.js";
import { shellCommand, audit } from "./dlp.js";

const CLOUDFLARED_VERSION = "2024.12.2";
const CLOUDFLARED_SHA256: Record<string, string> = {
  amd64: "40ec9a0f5b58e3b04183aaf01c4ddd4dbc6af39b0f06be4b7ce8b1011d0a07ab",
  arm64: "5a6c5881743fc84686f23048940ec844848c0f20363e8f76a99bc47e19777de6",
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
        await sshExec(sshPort, shellCommand`printf '%s\n' ${url} > /tmp/tunnel-url.txt`);
        audit("tunnel_url_captured", url);
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
