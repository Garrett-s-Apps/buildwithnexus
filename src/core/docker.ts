import { existsSync } from "node:fs";
import { execa } from "execa";
import { log } from "../ui/logger.js";
import { detectPlatform, type PlatformInfo } from "./platform.js";

const CONTAINER_NAME = "nexus";
const DOCKER_DESKTOP_APP_PATH = "/Applications/Docker.app";

export async function isDockerInstalled(): Promise<boolean> {
  try {
    await execa("docker", ["info"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns true if `docker` binary exists on PATH but the daemon is not running.
 * This distinguishes "Docker Desktop installed but not started" from "not installed at all".
 */
async function isDockerInstalledButNotRunning(): Promise<boolean> {
  try {
    await execa("docker", ["--version"]);
    // binary exists but `docker info` failed (checked earlier) → daemon not running
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns true if Docker Desktop.app actually exists on disk at /Applications/Docker.app.
 * A `docker` binary on PATH does NOT guarantee Docker Desktop is installed.
 */
function dockerDesktopExists(): boolean {
  return existsSync(DOCKER_DESKTOP_APP_PATH);
}

/**
 * Check if Homebrew is installed; if not, install it automatically.
 */
async function ensureHomebrew(): Promise<void> {
  try {
    await execa("which", ["brew"]);
    log.dim("Homebrew is already installed.");
    return;
  } catch {
    // Homebrew not found — install it
  }

  log.step("Installing Homebrew...");
  try {
    await execa("/bin/bash", [
      "-c",
      '$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)',
    ], {
      stdio: "inherit",
      env: { ...process.env, NONINTERACTIVE: "1" },
    });
  } catch {
    throw new Error(
      "Failed to install Homebrew automatically.\n\n" +
      "  Install Homebrew manually:\n" +
      "    /bin/bash -c \"$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\"\n\n" +
      "  Then re-run:\n" +
      "    buildwithnexus init",
    );
  }

  // On Apple Silicon, Homebrew installs to /opt/homebrew and may not be on PATH yet
  try {
    await execa("which", ["brew"]);
  } catch {
    // Add Homebrew to PATH for the current process
    const armPath = "/opt/homebrew/bin";
    const intelPath = "/usr/local/bin";
    process.env.PATH = `${armPath}:${intelPath}:${process.env.PATH}`;
    log.dim("Added Homebrew paths to PATH for this session.");
  }

  // Verify brew is now available
  try {
    await execa("brew", ["--version"]);
    log.success("Homebrew installed successfully.");
  } catch {
    throw new Error(
      "Homebrew was installed but is not available on PATH.\n\n" +
      "  Try opening a new terminal and re-running:\n" +
      "    buildwithnexus init",
    );
  }
}

/**
 * Attempt to auto-install Docker based on the current OS.
 * Throws on failure with a helpful message.
 */
export async function installDocker(platform?: PlatformInfo): Promise<void> {
  const p = platform ?? detectPlatform();

  switch (p.os) {
    case "mac": {
      // 1. If docker daemon is already responding, nothing to do
      if (await isDockerInstalled()) {
        log.success("Docker is already running.");
        return;
      }

      // 2. If Docker Desktop app exists on disk, try to launch it
      if (dockerDesktopExists()) {
        log.step(`Docker Desktop found at ${DOCKER_DESKTOP_APP_PATH} but not running. Attempting to start...`);

        let launched = false;
        log.dim(`Trying: open ${DOCKER_DESKTOP_APP_PATH}`);
        try {
          await execa("open", [DOCKER_DESKTOP_APP_PATH]);
          launched = true;
          log.dim(`Launch command succeeded via ${DOCKER_DESKTOP_APP_PATH}`);
        } catch {
          log.warn(`Could not launch via ${DOCKER_DESKTOP_APP_PATH} — trying fallback...`);
        }

        if (!launched) {
          log.dim("Trying: open -a Docker");
          try {
            await execa("open", ["-a", "Docker"]);
            launched = true;
            log.dim("Launch command succeeded via open -a Docker");
          } catch {
            log.warn("Both launch attempts failed.");
          }
        }

        if (launched) {
          log.step("Docker Desktop is starting up. Waiting for the daemon to be ready (up to 120s)...");
          try {
            await waitForDockerDaemon(120_000);
            return;
          } catch {
            log.warn("Docker Desktop was launched but the daemon did not become ready in time.");
          }
        } else {
          log.warn("Could not launch Docker Desktop. Will fall back to reinstalling via Homebrew.");
        }
        // Fall through to Homebrew installation if launch failed
      } else {
        log.step(`Docker Desktop not found at ${DOCKER_DESKTOP_APP_PATH}.`);
      }

      // 3. Docker Desktop doesn't exist or couldn't be launched — install via Homebrew
      log.step("Installing Docker Desktop via Homebrew...");
      await ensureHomebrew();

      try {
        await execa("brew", ["install", "--cask", "docker"], {
          stdio: "inherit",
          timeout: 60000,
        });
      } catch (err) {
        const e = err as { killed?: boolean; timedOut?: boolean; signal?: string };
        if (e.killed && e.signal === "SIGINT") {
          throw new Error("Docker installation cancelled by user (Ctrl+C)");
        }
        if (e.timedOut) {
          throw new Error(
            "Docker installation via Homebrew timed out after 60 seconds.\n\n" +
            "  The password prompt may be waiting for input. Try installing manually:\n" +
            "    brew install --cask docker\n\n" +
            "  After installing, re-run:\n" +
            "    buildwithnexus init",
          );
        }
        throw new Error(
          "Failed to install Docker via Homebrew.\n\n" +
          "  Try installing Docker Desktop manually:\n" +
          "    https://www.docker.com/products/docker-desktop\n\n" +
          "  After installing, re-run:\n" +
          "    buildwithnexus init",
        );
      }

      // Launch Docker Desktop after Homebrew install
      log.step("Launching Docker Desktop...");
      let postInstallLaunched = false;
      log.dim(`Trying: open ${DOCKER_DESKTOP_APP_PATH}`);
      try {
        await execa("open", [DOCKER_DESKTOP_APP_PATH]);
        postInstallLaunched = true;
        log.dim(`Launch command succeeded via ${DOCKER_DESKTOP_APP_PATH}`);
      } catch {
        log.warn(`Could not launch via ${DOCKER_DESKTOP_APP_PATH} — trying fallback...`);
      }

      if (!postInstallLaunched) {
        log.dim("Trying: open -a Docker");
        try {
          await execa("open", ["-a", "Docker"]);
          postInstallLaunched = true;
          log.dim("Launch command succeeded via open -a Docker");
        } catch {
          log.warn("Both launch attempts failed after install.");
        }
      }

      if (!postInstallLaunched) {
        throw new Error(
          "Docker Desktop was installed but could not be started automatically.\n\n" +
          "  Next steps:\n" +
          "    1. Open Docker Desktop manually from your Applications folder\n" +
          "    2. Wait for the whale icon to appear in the menu bar\n" +
          "    3. Re-run: buildwithnexus init",
        );
      }

      log.step("Docker Desktop is starting up. Waiting for the daemon to be ready (up to 120s)...");
      await waitForDockerDaemon(120_000);
      break;
    }

    case "linux": {
      // Check if Docker binary exists but daemon isn't running
      const linuxBinaryExists = await isDockerInstalledButNotRunning();
      if (linuxBinaryExists) {
        log.step("Docker is installed but the daemon is not running.");
        log.step("Starting Docker daemon...");
        try {
          await execa("sudo", ["systemctl", "start", "docker"], { stdio: "inherit" });
          log.dim("Started Docker daemon via systemctl.");
        } catch {
          try {
            await execa("sudo", ["service", "docker", "start"], { stdio: "inherit" });
            log.dim("Started Docker daemon via service command.");
          } catch {
            throw new Error(
              "Docker is installed but the daemon could not be started.\n\n" +
              "  Try starting it manually:\n" +
              "    sudo systemctl start docker\n\n" +
              "  Then re-run:\n" +
              "    buildwithnexus init",
            );
          }
        }

        log.step("Waiting for Docker...");
        await waitForDockerDaemon(30_000);
        return;
      }

      log.step("Installing Docker...");
      log.warn("This may require your sudo password.");
      log.dim("Running official Docker install script from https://get.docker.com ...");
      try {
        // Download and run the official install script
        const { stdout: script } = await execa("curl", ["-fsSL", "https://get.docker.com"]);
        await execa("sudo", ["sh", "-c", script], { stdio: "inherit" });
        log.success("Docker installed successfully.");
      } catch {
        throw new Error(
          "Failed to install Docker on Linux.\n\n" +
          "  Try installing manually:\n" +
          "    curl -fsSL https://get.docker.com | sudo sh\n\n" +
          "  After installing, re-run:\n" +
          "    buildwithnexus init",
        );
      }

      // Add current user to docker group so future commands don't need sudo
      log.dim("Adding current user to docker group...");
      try {
        const user = (await execa("whoami")).stdout.trim();
        await execa("sudo", ["usermod", "-aG", "docker", user]);
        log.dim(`Added user '${user}' to docker group (may require re-login for effect).`);
      } catch {
        log.warn("Could not add user to docker group. You may need sudo for docker commands.");
      }

      // Start the Docker daemon
      log.step("Starting Docker daemon...");
      try {
        await execa("sudo", ["systemctl", "start", "docker"], { stdio: "inherit" });
        log.dim("Started Docker daemon via systemctl.");
      } catch {
        // Fallback for non-systemd systems
        try {
          await execa("sudo", ["service", "docker", "start"], { stdio: "inherit" });
          log.dim("Started Docker daemon via service command.");
        } catch {
          throw new Error(
            "Docker was installed but the daemon could not be started.\n\n" +
            "  Try starting it manually:\n" +
            "    sudo systemctl start docker\n\n" +
            "  Then re-run:\n" +
            "    buildwithnexus init",
          );
        }
      }

      log.step("Waiting for Docker...");
      await waitForDockerDaemon(30_000);
      break;
    }

    case "windows": {
      // Check if Docker binary exists but daemon isn't running
      const winBinaryExists = await isDockerInstalledButNotRunning();
      if (winBinaryExists) {
        log.step("Docker Desktop is installed but not running. Attempting to start...");
        log.step("Launching Docker...");
        try {
          await execa("powershell", ["-Command", "Start-Process 'Docker Desktop'"], { stdio: "inherit" });
          log.dim("Docker Desktop launch command sent.");
        } catch {
          log.warn("Could not launch Docker Desktop automatically. It may need to be started manually.");
        }

        log.step("Waiting for Docker...");
        try {
          await waitForDockerDaemon(120_000);
        } catch {
          throw new Error(
            "Docker Desktop did not start within 120 seconds.\n\n" +
            "  Next steps:\n" +
            "    1. Open Docker Desktop manually from the Start Menu\n" +
            "    2. Wait for the whale icon to appear in the system tray\n" +
            "    3. Re-run: buildwithnexus init",
          );
        }
        return;
      }

      // Docker not installed — try Chocolatey first, then direct download
      log.step("Installing Docker Desktop...");

      let installed = false;

      // Try Chocolatey if available
      try {
        await execa("choco", ["--version"]);
        log.dim("Chocolatey detected. Installing Docker Desktop via choco...");
        try {
          await execa("choco", ["install", "docker-desktop", "-y"], { stdio: "inherit" });
          installed = true;
          log.success("Docker Desktop installed via Chocolatey.");
        } catch {
          log.warn("Chocolatey install failed. Falling back to direct download...");
        }
      } catch {
        log.dim("Chocolatey not found. Using direct download...");
      }

      // Fallback: direct download and install
      if (!installed) {
        log.dim("Downloading Docker Desktop installer from docker.com...");
        try {
          await execa("powershell", [
            "-Command",
            "Invoke-WebRequest -Uri 'https://desktop.docker.com/win/main/amd64/Docker Desktop Installer.exe' -OutFile '$env:TEMP\\DockerInstaller.exe'; " +
            "& '$env:TEMP\\DockerInstaller.exe' Install --quiet; " +
            "Remove-Item '$env:TEMP\\DockerInstaller.exe' -Force -ErrorAction SilentlyContinue",
          ], { stdio: "inherit" });
          installed = true;
          log.success("Docker Desktop installed via direct download.");
        } catch {
          throw new Error(
            "Failed to install Docker Desktop on Windows.\n\n" +
            "  Please install Docker Desktop manually:\n" +
            "    1. Download from https://www.docker.com/products/docker-desktop\n" +
            "    2. Run the installer and follow the prompts\n" +
            "    3. Start Docker Desktop\n" +
            "    4. Re-run: buildwithnexus init",
          );
        }
      }

      // Launch Docker Desktop after install
      log.step("Launching Docker...");
      try {
        await execa("powershell", ["-Command", "Start-Process 'Docker Desktop'"], { stdio: "inherit" });
        log.dim("Docker Desktop launch command sent.");
      } catch {
        log.warn("Could not launch Docker Desktop automatically after install.");
      }

      log.step("Waiting for Docker...");
      try {
        await waitForDockerDaemon(120_000);
      } catch {
        throw new Error(
          "Docker Desktop was installed but did not start within 120 seconds.\n\n" +
          "  Next steps:\n" +
          "    1. You may need to restart your computer for Docker to work\n" +
          "    2. Open Docker Desktop from the Start Menu\n" +
          "    3. Wait for the whale icon to appear in the system tray\n" +
          "    4. Re-run: buildwithnexus init",
        );
      }
      break;
    }

    default:
      throw new Error(`Unsupported platform: ${p.os}`);
  }
}

/**
 * Poll `docker info` until the daemon responds or timeout is reached.
 */
async function waitForDockerDaemon(timeoutMs: number): Promise<void> {
  const start = Date.now();
  log.step("Waiting for Docker daemon...");

  while (Date.now() - start < timeoutMs) {
    try {
      await execa("docker", ["info"]);
      log.success("Docker daemon is ready");
      return;
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, 3000));
  }

  throw new Error(
    `Docker daemon did not become ready within ${Math.round(timeoutMs / 1000)}s.\n\n` +
    "  Please ensure Docker is running, then re-run:\n" +
    "    buildwithnexus init",
  );
}

export async function imageExistsLocally(image: string, tag: string): Promise<boolean> {
  const ref = `${image}:${tag}`;
  try {
    await execa("docker", ["image", "inspect", ref]);
    return true;
  } catch {
    return false;
  }
}

export async function pullImage(image: string, tag: string): Promise<void> {
  const ref = `${image}:${tag}`;
  log.step(`Pulling image ${ref}...`);
  try {
    await execa("docker", ["pull", ref], { stdio: "inherit" });
    log.success(`Image ${ref} pulled`);
  } catch (err) {
    log.error(`Failed to pull image ${ref}`);
    throw err;
  }
}

export async function startNexus(
  keys: { anthropic: string; openai: string },
  config: { port: number },
): Promise<void> {
  log.step("Starting NEXUS container...");
  try {
    await execa("docker", [
      "run",
      "-d",
      "--name",
      CONTAINER_NAME,
      "-e",
      `ANTHROPIC_API_KEY=${keys.anthropic}`,
      "-e",
      `OPENAI_API_KEY=${keys.openai}`,
      "-p",
      `${config.port}:${config.port}`,
      "buildwithnexus/nexus:latest",
    ]);
    log.success(`NEXUS container started on port ${config.port}`);
  } catch (err) {
    log.error("Failed to start NEXUS container");
    throw err;
  }
}

export async function stopNexus(): Promise<void> {
  log.step("Stopping NEXUS container...");
  try {
    await execa("docker", ["rm", "-f", CONTAINER_NAME]);
    log.success("NEXUS container stopped and removed");
  } catch (err) {
    log.error("Failed to stop NEXUS container");
    throw err;
  }
}

export async function dockerExec(command: string): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execa("docker", ["exec", CONTAINER_NAME, "sh", "-c", command]);
    return { stdout, stderr, code: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; exitCode?: number };
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", code: e.exitCode ?? 1 };
  }
}

/**
 * Start the Nexus Python backend server as a detached background process.
 * The backend is expected to listen on port 4200 (or BACKEND_URL).
 */
export async function startBackend(): Promise<void> {
  const { spawn } = await import("node:child_process");
  const os = await import("node:os");
  const path = await import("node:path");

  const nexusDir = path.join(os.homedir(), "Projects", "nexus");
  log.step(`Starting Nexus backend from ${nexusDir}...`);

  const child = spawn("python3", ["-m", "src.main"], {
    cwd: nexusDir,
    detached: true,
    stdio: "ignore",
    env: { ...process.env },
  });

  child.unref();
  log.success("Nexus backend process started");
}

/**
 * High-level launcher: stop any existing container, start a fresh one,
 * and wait for the server health check.
 *
 * Consolidates the launch sequence shared by `start` and `init` commands.
 * Returns true when the server is healthy within `healthTimeoutMs`.
 */
export async function launchNexus(
  keys: { anthropic: string; openai: string },
  config: { port: number },
  opts?: { healthTimeoutMs?: number; stopExisting?: boolean },
): Promise<boolean> {
  const { healthTimeoutMs = 60_000, stopExisting = true } = opts ?? {};

  if (stopExisting && (await isNexusRunning())) {
    await stopNexus();
  }

  await startNexus(keys, config);

  if (healthTimeoutMs <= 0) return true;

  // Inline import to avoid circular dependency (health.ts -> docker.ts)
  const { waitForServer } = await import("./health.js");
  return waitForServer(healthTimeoutMs);
}

export async function isNexusRunning(): Promise<boolean> {
  try {
    const { stdout } = await execa("docker", [
      "ps",
      "--filter",
      `name=^/${CONTAINER_NAME}$`,
      "--format",
      "{{.Names}}",
    ]);
    return stdout.trim() === CONTAINER_NAME;
  } catch {
    return false;
  }
}
