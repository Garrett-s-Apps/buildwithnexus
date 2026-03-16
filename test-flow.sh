#!/bin/bash

# Test 1: Init with API key
echo "=== TEST 1: Init creates .env.local ==="
rm -f ~/.env.local
echo -e "sk-ant-test-key\n\n\nhttp://localhost:4200\n4201" | npm run init 2>&1 | grep -E "(Configuration saved|Keys configured)"

# Test 2: Verify .env.local exists and key is loaded
echo -e "\n=== TEST 2: .env.local exists with key ==="
if [ -f ~/.env.local ]; then
  echo "✓ ~/.env.local exists"
  grep -q "ANTHROPIC_API_KEY=sk-ant-test-key" ~/.env.local && echo "✓ Key loaded correctly"
else
  echo "✗ ~/.env.local not found"
fi

# Test 3: Verify header shows "Nexus" only
echo -e "\n=== TEST 3: Header displays correctly ==="
(echo "exit" | npm run cli 2>&1 || true) | grep -E "Nexus.*Orchestration" | head -1

echo -e "\n=== All tests complete ==="
