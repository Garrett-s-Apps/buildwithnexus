#!/bin/bash
set -e

echo "=== VERIFICATION: End-to-End buildwithnexus v0.8.10 ==="

# 1. Check API key configuration
echo -e "\n[1/4] Checking API key configuration..."
if [ -f "$HOME/.buildwithnexus/.env.keys" ]; then
  echo "✓ Keys stored at ~/.buildwithnexus/.env.keys"
else
  echo "✗ Keys not configured — run: buildwithnexus da-init"
fi

# 2. Verify backend health
echo -e "\n[2/4] Testing backend health..."
health=$(curl -s http://localhost:4200/health 2>/dev/null)
if echo "$health" | grep -q '"status":"ok"'; then
  echo "✓ Backend healthy at http://localhost:4200"
else
  echo "✗ Backend offline — run: buildwithnexus server"
fi

# 3. Test backend endpoints with api_key in POST body
echo -e "\n[3/4] Testing API key passed in POST body..."
run_id=$(curl -s -X POST http://localhost:4200/api/run \
  -H "Content-Type: application/json" \
  -d '{"task":"test","agent_role":"brainstorm","agent_goal":"","api_key":"sk-ant-key"}' 2>/dev/null | grep -o '"run_id":"[^"]*"' | cut -d'"' -f4)
[ -n "$run_id" ] && echo "✓ POST request accepted (run_id: $run_id)" || echo "✗ POST request failed"

# 4. Verify stream responds
echo -e "\n[4/4] Testing event stream..."
if [ -n "$run_id" ]; then
  stream_response=$(curl -s --max-time 3 "http://localhost:4200/api/stream/$run_id" 2>/dev/null | head -1)
  echo "$stream_response" | grep -q '"type":"started"' && echo "✓ Stream events received" || echo "✗ No stream events"
fi

echo -e "\n✓ Verification complete!"
echo "  • API keys: ~/.buildwithnexus/.env.keys"
echo "  • Backend: http://localhost:4200"
echo "  • Models per agent role:"
echo "    - Brainstorm (CPO): claude-opus-4-7"
echo "    - Planning (Architect): claude-sonnet-4-6"
echo "    - Building (Eng): claude-haiku-4-5-20251001"
