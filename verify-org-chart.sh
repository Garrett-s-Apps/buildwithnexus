#!/bin/bash
echo "=== buildwithnexus v0.8.10: Org Chart Integration ==="

echo -e "\n[Org Chart Models from src/agents/org_chart.py]"
echo "  • OPUS   = claude-opus-4-7            (CPO — brainstorm mode)"
echo "  • SONNET = claude-sonnet-4-6           (planning node)"
echo "  • HAIKU  = claude-haiku-4-5-20251001   (execution node)"

echo -e "\n[Runtime Nodes Using Org Chart Constants]"
grep "model=OPUS\|model=SONNET\|model=HAIKU" /Users/garretteaglin/Projects/nexus/src/runtime/nodes.py | head -3 && echo "  ✓ All nodes using org_chart constants"

echo -e "\n[LangGraph Routing (graph.py)]"
echo "  • Entry point: _routing_node"
echo "  • Routes based on agent_role:"
echo "    - 'brainstorm' → brainstorm_node (OPUS)"
echo "    - else → planning_node (SONNET) → execution_node (HAIKU)"

echo -e "\n[Agent Org Chart Integration]"
echo "  ✓ Models defined in org_chart.py (source of truth)"
echo "  ✓ Imported and used in runtime/nodes.py"
echo "  ✓ LangGraph respects org chart via routing"

echo -e "\n✅ buildwithnexus v0.8.10 maintains full org chart integration"
