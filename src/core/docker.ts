import { sshExec } from "./ssh.js";
import { log } from "../ui/logger.js";

export async function isDockerReady(port: number): Promise<boolean> {
  try {
    const { stdout } = await sshExec(
      port,
      "docker version --format '{{.Server.Version}}'",
    );
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

export async function isSandboxBuilt(port: number): Promise<boolean> {
  try {
    const { stdout } = await sshExec(
      port,
      "docker images nexus-cli-sandbox --format '{{.Repository}}'",
    );
    return stdout.trim() === "nexus-cli-sandbox";
  } catch {
    return false;
  }
}

export async function rebuildSandbox(port: number): Promise<void> {
  log.step("Rebuilding Docker sandbox image...");
  await sshExec(
    port,
    "docker build -t nexus-cli-sandbox /home/nexus/nexus/docker/cli-sandbox/",
  );
  log.success("Docker sandbox image rebuilt");
}

export async function getDockerContainers(
  port: number,
): Promise<string[]> {
  try {
    const { stdout } = await sshExec(
      port,
      "docker ps --format '{{.Names}}'",
    );
    return stdout.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

export async function pruneDocker(port: number): Promise<void> {
  await sshExec(port, "docker system prune -f");
  log.success("Docker pruned");
}
