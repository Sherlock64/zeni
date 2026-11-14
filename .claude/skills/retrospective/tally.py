"""Token and tool tally for one Claude Code session, for the retrospective skill.

Usage: python3 -I tally.py <session.jsonl>
Reads the session transcript and its subagents/ folder next to it, prints JSON.
"""

import collections
import json
import pathlib
import sys

FIELDS = ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "output_tokens")
# Rough price weights relative to uncached input: 1h cache write 2x, cache read 0.1x, output 5x.
WEIGHTS = {"input_tokens": 1, "cache_creation_input_tokens": 2, "cache_read_input_tokens": 0.1, "output_tokens": 5}


def weighted(summary):
    return round(sum(summary[field] * weight for field, weight in WEIGHTS.items()))


def tally(path):
    """Usage summed once per API request (a request is logged once per content block), plus tool counts."""
    usage_by_request = {}
    tools = collections.Counter()
    user_prompts = []
    first = last = None
    for line in path.open():
        entry = json.loads(line)
        stamp = entry.get("timestamp")
        if stamp:
            first = first or stamp
            last = stamp
        message = entry.get("message") or {}
        if entry.get("type") == "assistant":
            usage_by_request[entry.get("requestId") or entry.get("uuid")] = message.get("usage") or {}
            for block in message.get("content") or []:
                if isinstance(block, dict) and block.get("type") == "tool_use":
                    tools[block["name"]] += 1
        elif entry.get("type") == "user" and not entry.get("isMeta") and isinstance(message.get("content"), str):
            user_prompts.append(message["content"][:300])
    totals = {field: sum(u.get(field, 0) for u in usage_by_request.values()) for field in FIELDS}
    return {
        "requests": len(usage_by_request),
        **totals,
        "weighted": weighted(totals),
        "tools": dict(tools.most_common()),
        "user_prompts": user_prompts,
        "started": first,
        "ended": last,
    }


def main():
    session = pathlib.Path(sys.argv[1])
    agents = []
    for transcript in sorted((session.parent / session.stem / "subagents").glob("*.jsonl")):
        meta_path = transcript.with_suffix(".meta.json")
        meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}
        summary = tally(transcript)
        del summary["user_prompts"]  # the organizer's prompt, already in the main transcript
        agents.append({"type": meta.get("agentType"), "description": meta.get("description"), **summary})
    main_summary = tally(session)
    grand = {field: main_summary[field] + sum(a[field] for a in agents) for field in FIELDS}
    grand["weighted"] = weighted(grand)
    print(json.dumps({"main": main_summary, "subagents": agents, "total": grand}, indent=1))


if __name__ == "__main__":
    main()
