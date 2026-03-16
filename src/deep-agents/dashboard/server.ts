import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentExecutionState } from "../ui/planning-repl.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class DashboardServer {
  private server: http.Server;
  private port: number;
  private executionHistory: AgentExecutionState[] = [];

  constructor(port = 4201) {
    this.port = port;
    this.server = http.createServer(this.handleRequest.bind(this));
  }

  private handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): void {
    const url = req.url ?? "/";
    const method = req.method ?? "GET";

    // API routes
    if (url === "/api/execution-history" && method === "GET") {
      this.sendJSON(res, 200, this.executionHistory);
      return;
    }

    if (url.startsWith("/api/checkpoint/") && method === "GET") {
      const id = parseInt(url.split("/").pop() ?? "");
      const state = this.executionHistory[id];
      if (state === undefined) {
        this.sendJSON(res, 404, { error: "not found" });
      } else {
        this.sendJSON(res, 200, state);
      }
      return;
    }

    if (url === "/api/checkpoint" && method === "POST") {
      this.readBody(req, (body) => {
        try {
          const state = JSON.parse(body) as AgentExecutionState;
          this.executionHistory.push(state);
          this.sendJSON(res, 200, { id: this.executionHistory.length - 1 });
        } catch {
          this.sendJSON(res, 400, { error: "invalid JSON" });
        }
      });
      return;
    }

    if (url === "/api/clear" && method === "POST") {
      this.executionHistory = [];
      this.sendJSON(res, 200, { ok: true });
      return;
    }

    // Static file serving
    const publicDir = path.join(__dirname, "public");
    const filePath =
      url === "/" ? path.join(publicDir, "index.html") : path.join(publicDir, url);

    // Guard against path traversal
    if (!filePath.startsWith(publicDir)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath);
      const mimeTypes: Record<string, string> = {
        ".html": "text/html",
        ".js": "application/javascript",
        ".css": "text/css",
        ".json": "application/json",
      };
      res.writeHead(200, {
        "Content-Type": mimeTypes[ext] ?? "application/octet-stream",
      });
      res.end(fs.readFileSync(filePath));
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
  }

  private sendJSON(
    res: http.ServerResponse,
    status: number,
    body: unknown,
  ): void {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  }

  private readBody(
    req: http.IncomingMessage,
    cb: (body: string) => void,
  ): void {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => cb(Buffer.concat(chunks).toString()));
  }

  /** Push a state snapshot from within the same process. */
  pushCheckpoint(state: AgentExecutionState): number {
    this.executionHistory.push(state);
    return this.executionHistory.length - 1;
  }

  start(): void {
    this.server.listen(this.port, "127.0.0.1", () => {
      console.log(
        `  Dashboard running at http://localhost:${this.port}`,
      );
    });
  }

  stop(): void {
    this.server.close();
  }
}
