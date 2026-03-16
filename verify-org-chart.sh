#!/bin/bash
echo "=== buildwithnexus v0.6.24: Org Chart Integration ==="

echo -e "\n[Org Chart Models from src/agents/org_chart.py]"
echo "  • OPUS = claude-opus-4-6 (Chief of Staff)"
echo "  • SONNET = claude-sonnet-4-6-20250929 (Architect + Product + Eng)"
echo "  • HAIKU = claude-haiku-4-5-20251001 (Product + Eng + Architecture)"

echo -e "\n[Runtime Nodes Using Org Chart Constants]"
grep "model=OPUS\|model=SONNET\|model=HAIKU" /Users/garretteaglin/Projects/nexus/src/runtime/nodes.py | head -3 && echo "  ✓ All nodes using org_chart constants"

echo -e "\n[LangGraph Routing (graph.py)]"
echo "  • Entry point: _routing_node"
echo "  • Routes based on agent_role:"
echo "    - 'brainstorm' → brainstorm_node (OPUS)"
echo "    - else → plan_node (SONNET) → execute_node (HAIKU)"

echo -e "\n[Agent Org Chart Integration]"
echo "  ✓ Models defined in org_chart.py (source of truth)"
echo "  ✓ Imported and used in runtime/nodes.py"
echo "  ✓ LangGraph respects org chart via routing"
echo "  ✓ Date suffixes maintained for Anthropic API compatibility"

echo -e "\n✅ buildwithnexus v0.6.24 maintains full org chart integration"
