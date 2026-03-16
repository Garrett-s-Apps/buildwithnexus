#!/usr/bin/env node

const http = require('http');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 4201;

const server = http.createServer((req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Deep Agents Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      padding: 2rem;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
    }
    h1 {
      margin-bottom: 2rem;
      font-size: 2rem;
      color: #f1f5f9;
    }
    .status {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 1.5rem;
      margin-bottom: 2rem;
    }
    .status-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.75rem 0;
      border-bottom: 1px solid #334155;
    }
    .status-item:last-child {
      border-bottom: none;
    }
    .status-label {
      font-weight: 500;
      color: #cbd5e1;
    }
    .status-value {
      font-weight: 600;
      color: #10b981;
      font-family: 'Monaco', 'Courier New', monospace;
    }
    .executions {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 1.5rem;
    }
    .execution-item {
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 6px;
      padding: 1rem;
      margin-bottom: 1rem;
      cursor: pointer;
      transition: all 0.2s;
    }
    .execution-item:hover {
      border-color: #475569;
      background: #1e293b;
    }
    .execution-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.5rem;
    }
    .execution-task {
      font-weight: 500;
      color: #f1f5f9;
    }
    .execution-status {
      padding: 0.25rem 0.75rem;
      border-radius: 4px;
      font-size: 0.875rem;
      font-weight: 500;
    }
    .status-running {
      background: #3b82f6;
      color: white;
    }
    .status-done {
      background: #10b981;
      color: white;
    }
    .status-error {
      background: #ef4444;
      color: white;
    }
    .execution-time {
      font-size: 0.875rem;
      color: #94a3b8;
    }
    .empty {
      text-align: center;
      padding: 2rem;
      color: #64748b;
    }
    .info-box {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 1rem;
      margin-bottom: 2rem;
      font-size: 0.875rem;
      color: #cbd5e1;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🚀 Deep Agents Dashboard</h1>

    <div class="info-box">
      Backend: <strong>http://localhost:4200</strong> |
      Dashboard: <strong>http://localhost:4201</strong>
    </div>

    <div class="status">
      <div class="status-item">
        <span class="status-label">Backend Status</span>
        <span class="status-value" id="backend-status">Checking...</span>
      </div>
      <div class="status-item">
        <span class="status-label">Total Executions</span>
        <span class="status-value" id="total-executions">0</span>
      </div>
      <div class="status-item">
        <span class="status-label">Active Tasks</span>
        <span class="status-value" id="active-tasks">0</span>
      </div>
    </div>

    <h2 style="margin-bottom: 1rem;">Recent Executions</h2>
    <div class="executions" id="executions">
      <div class="empty">No executions yet. Run a task from the CLI to see it here.</div>
    </div>
  </div>

  <script>
    const BACKEND_URL = 'http://localhost:4200';
    const executions = [];

    async function checkBackend() {
      try {
        const response = await fetch(BACKEND_URL + '/health');
        if (response.ok) {
          document.getElementById('backend-status').textContent = '✓ Connected';
          document.getElementById('backend-status').style.color = '#10b981';
        }
      } catch (e) {
        document.getElementById('backend-status').textContent = '✗ Offline';
        document.getElementById('backend-status').style.color = '#ef4444';
      }
    }

    async function loadExecutions() {
      try {
        // For now, show placeholder. In production, this would fetch from backend
        document.getElementById('total-executions').textContent = executions.length;
        document.getElementById('active-tasks').textContent = '0';
      } catch (e) {
        console.error('Failed to load executions:', e);
      }
    }

    // Check backend status every 5 seconds
    checkBackend();
    setInterval(checkBackend, 5000);

    // Load executions every 2 seconds
    loadExecutions();
    setInterval(loadExecutions, 2000);

    // Try to connect to WebSocket for real-time updates
    try {
      const ws = new WebSocket('ws://localhost:4200/ws/stream');
      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        console.log('Event:', data);
        // Add execution updates here
      };
    } catch (e) {
      console.log('WebSocket not available yet');
    }
  </script>
</body>
</html>
    `);
    return;
  }

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`✓ Dashboard listening on http://localhost:${PORT}`);
});
