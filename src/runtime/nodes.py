"""Real node implementations for Deep Agents LangGraph graph."""
from __future__ import annotations

import os
from typing import TYPE_CHECKING, Any

from langchain_anthropic import ChatAnthropic
from langchain_core.messages import HumanMessage, SystemMessage, ToolMessage

from ..agents.org_chart import HAIKU, OPUS, SONNET
from ..planning.planning_tool import WriteTodosTool

if TYPE_CHECKING:
    from .state import AgentExecutionState


def planning_node(state: AgentExecutionState) -> dict:
    """Planning node: decompose task into todos using LLM + write_todos tool.

    Creates a ChatAnthropic instance with write_todos bound, sends the user
    task for decomposition into 2-5 subtasks, then processes the tool call
    response to populate the plan.

    Args:
        state: Current AgentExecutionState

    Returns:
        State update with populated plan.todos

    Raises:
        ValueError: If ANTHROPIC_API_KEY is not set or authentication fails.
        RuntimeError: If the planning LLM call fails unexpectedly.
    """
    api_key = state.get("api_key") or os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise ValueError(
            "ANTHROPIC_API_KEY environment variable is not set. "
            "Please set it to use Claude for planning: "
            "export ANTHROPIC_API_KEY=sk-..."
        )

    task = state.get("current_task", "")
    role = state.get("agent_role", "assistant")
    goal = state.get("agent_goal", "")

    if not task:
        return {
            "plan": {
                "todos": [],
                "current_todo_id": None,
                "completed_count": 0,
            }
        }

    try:
        # Create LLM with write_todos tool bound
        planning_tool = WriteTodosTool()
        llm = ChatAnthropic(model=SONNET, temperature=0.3, api_key=api_key)
        llm_with_tools = llm.bind_tools([planning_tool.write_todos])

        system_prompt = (
            f"You are a {role} assistant helping to break down a task.\n"
            f"Goal: {goal if goal else 'Complete the task'}\n"
            "\n"
            "Your job is to decompose the user's task into 2-5 concrete, "
            "independent subtasks. Each subtask should be something that "
            "can be executed and validated independently.\n"
            "\n"
            "Use the write_todos tool to create the task breakdown. "
            "Be specific and actionable with each step."
        )

        messages = [
            SystemMessage(content=system_prompt),
            HumanMessage(content=f"Task: {task}"),
        ]

        response = llm_with_tools.invoke(messages)

        # Process tool calls from the LLM response
        if response.tool_calls:
            for tool_call in response.tool_calls:
                if tool_call["name"] == "write_todos":
                    planning_tool.write_todos.invoke(tool_call["args"])

        todos = planning_tool.get_plan()

        return {
            "plan": {
                "todos": todos,
                "current_todo_id": todos[0]["id"] if todos else None,
                "completed_count": 0,
            },
            "messages": [response],
        }

    except Exception as e:
        # Surface auth errors clearly
        err_str = str(e).lower()
        if "auth" in err_str or "api key" in err_str or "401" in err_str:
            raise ValueError(
                "Authentication failed with ANTHROPIC_API_KEY. "
                f"Error: {e}. "
                "Please verify your API key is correct."
            ) from e
        raise RuntimeError(f"Planning node failed: {e}") from e


def execution_node(state: AgentExecutionState) -> dict[str, Any]:
    """Process the current todo via a ReAct loop with role-appropriate tools.

    Finds the first pending/in_progress todo, binds tools for the agent role,
    and runs a ReAct (Reason+Act) loop capped at 10 iterations.  Marks the
    todo as done and stores the result in intermediate_results.

    Args:
        state: Current AgentExecutionState.

    Returns:
        State update dict with messages, plan, intermediate_results,
        tokens_used, and cost_usd.
    """
    from src.tools import get_tools_for_role

    # --- Validate API key ---------------------------------------------------
    api_key = state.get("api_key") or os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return {
            "final_result": "ERROR: ANTHROPIC_API_KEY not set",
            "plan": state.get("plan", {}),
        }

    # --- Locate current todo -------------------------------------------------
    plan: dict[str, Any] = dict(state.get("plan", {}))
    todos: list[dict[str, Any]] = [dict(t) for t in plan.get("todos", [])]

    current_todo: dict[str, Any] | None = None
    for todo in todos:
        if todo["status"] in ("pending", "in_progress"):
            current_todo = todo
            break

    if current_todo is None:
        return {
            "final_result": "All tasks complete",
            "plan": plan,
        }

    # Mark in_progress
    current_todo["status"] = "in_progress"

    # --- Resolve tools for role ----------------------------------------------
    role = state.get("agent_role", "assistant") or "assistant"
    tools = get_tools_for_role(role)

    if not tools:
        # No tools available -- mark done immediately
        current_todo["status"] = "done"
        plan["todos"] = todos
        plan["completed_count"] = sum(1 for t in todos if t["status"] == "done")

        existing_results = dict(state.get("intermediate_results", {}))
        existing_results[current_todo["id"]] = "Completed (no tools available for role)"

        return {
            "intermediate_results": existing_results,
            "plan": plan,
        }

    # --- Build LLM with tools ------------------------------------------------
    try:
        llm = ChatAnthropic(
            model=HAIKU,
            temperature=0.2,
            api_key=api_key,
        )
        llm_with_tools = llm.bind_tools(tools)
    except Exception as e:
        current_todo["status"] = "done"
        plan["todos"] = todos
        plan["completed_count"] = sum(1 for t in todos if t["status"] == "done")

        existing_results = dict(state.get("intermediate_results", {}))
        existing_results[current_todo["id"]] = f"Error initialising LLM: {e}"

        return {
            "intermediate_results": existing_results,
            "plan": plan,
        }

    # --- ReAct loop ----------------------------------------------------------
    system_prompt = (
        f"You are a {role} assistant.\n"
        f"Task: {current_todo['title']}\n"
        f"Description: {current_todo.get('description', '')}\n\n"
        "Use the available tools to complete this task. "
        "Be systematic and check your work."
    )

    # Only new messages produced by this node (appended via operator.add)
    new_messages: list[Any] = [
        SystemMessage(content=system_prompt),
        HumanMessage(content="Begin executing this task."),
    ]

    max_iterations = 10
    iterations = 0
    result_text = ""
    total_input_tokens = 0
    total_output_tokens = 0

    try:
        # Seed the conversation for first invoke
        conversation: list[Any] = list(new_messages)

        while iterations < max_iterations:
            iterations += 1

            response = llm_with_tools.invoke(conversation)
            new_messages.append(response)
            conversation.append(response)

            # Accumulate token usage from response metadata
            usage = getattr(response, "usage_metadata", None)
            if usage:
                total_input_tokens += usage.get("input_tokens", 0)
                total_output_tokens += usage.get("output_tokens", 0)

            # If no tool calls, the agent is done reasoning
            if not response.tool_calls:
                if hasattr(response, "content"):
                    result_text = (
                        response.content
                        if isinstance(response.content, str)
                        else str(response.content)
                    )
                break

            # Process each tool call
            for tool_call in response.tool_calls:
                tool_name = tool_call.get("name")
                tool_args = tool_call.get("args", {})
                tool_use_id = tool_call.get("id")

                # Find matching tool and invoke
                tool_output: str | None = None
                for t in tools:
                    if t.name == tool_name:
                        try:
                            tool_output = str(t.invoke(tool_args))
                        except Exception as exc:
                            tool_output = f"Tool error: {exc}"
                        break

                if tool_output is None:
                    tool_output = f"Unknown tool: {tool_name}"

                tool_msg = ToolMessage(
                    content=tool_output,
                    tool_call_id=tool_use_id,
                )
                new_messages.append(tool_msg)
                conversation.append(tool_msg)

    except Exception as e:
        result_text = f"ReAct loop error: {e}"

    # --- Finalise todo -------------------------------------------------------
    current_todo["status"] = "done"
    plan["todos"] = todos
    plan["completed_count"] = sum(1 for t in todos if t["status"] == "done")

    existing_results = dict(state.get("intermediate_results", {}))
    existing_results[current_todo["id"]] = (
        result_text or f"Completed in {iterations} iteration(s)"
    )

    # Approximate cost: input $3/M, output $15/M for Sonnet
    estimated_cost = (
        (total_input_tokens * 3.0 + total_output_tokens * 15.0) / 1_000_000
    )

    return {
        "messages": new_messages,
        "intermediate_results": existing_results,
        "plan": plan,
        "tokens_used": (
            state.get("tokens_used", 0) + total_input_tokens + total_output_tokens
        ),
        "cost_usd": state.get("cost_usd", 0.0) + estimated_cost,
    }


async def brainstorm_node(state: AgentExecutionState) -> dict:
    """Brainstorm node: Direct conversation with Claude, no planning or tools."""
    api_key = state.get("api_key") or os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise ValueError(
            "ANTHROPIC_API_KEY environment variable is not set. "
            "Please set it to use Claude for brainstorming: "
            "export ANTHROPIC_API_KEY=sk-..."
        )

    task = state.get("current_task", "")

    if not task:
        return {"final_result": ""}

    try:
        llm = ChatAnthropic(model=OPUS, temperature=0.7, api_key=api_key)
        messages = [
            SystemMessage(content="You are a helpful brainstorming assistant."),
            HumanMessage(content=task),
        ]
        response = llm.invoke(messages)
        return {"final_result": response.content}
    except Exception as e:
        return {"final_result": f"Error: {e}"}
