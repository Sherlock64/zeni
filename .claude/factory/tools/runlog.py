"""The only writer of the factory run log (spine.md, "Run log").

Usage: python3 -I runlog.py append <ticket> <station> <outcome> <note>
  ticket: #<n>, SB-<n> for private work, or - for a run without a ticket.
Appends one row to $(git rev-parse --git-common-dir)/factory/runs.tsv: ended_at (UTC), the session id from
CLAUDE_CODE_SESSION_ID, ticket, station, outcome, note. Self-test: runlog.test.sh.
"""

import datetime
import os
import pathlib
import re
import subprocess
import sys

STATIONS = ("intake", "shape-slice", "build", "review", "merge", "release", "learn")
OUTCOMES = ("done", "back", "eject", "checkpoint")


def fail(msg):
    print(f"runlog: {msg}", file=sys.stderr)
    sys.exit(2)


def main(argv):
    if len(argv) != 5 or argv[0] != "append":
        fail("usage: runlog.py append <ticket> <station> <outcome> <note>")
    _, ticket, station, outcome, note = argv
    if not re.fullmatch(r"#\d+|SB-\d+|-", ticket):
        fail(f"ticket must be #<n>, SB-<n> or -, not {ticket!r}")
    if station not in STATIONS:
        fail(f"unknown station {station} (one of {', '.join(STATIONS)})")
    if outcome not in OUTCOMES:
        fail(f"unknown outcome {outcome} (one of {', '.join(OUTCOMES)})")
    session = os.environ.get("CLAUDE_CODE_SESSION_ID", "")
    if not session:
        fail("no CLAUDE_CODE_SESSION_ID in the environment")
    common = subprocess.run(
        ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"], capture_output=True, text=True, check=True
    ).stdout.strip()
    folder = pathlib.Path(common) / "factory"
    folder.mkdir(mode=0o700, exist_ok=True)
    ended = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    row = [ended, session, ticket, station, outcome, " ".join(note.split())]
    with (folder / "runs.tsv").open("a") as f:
        f.write("\t".join(row) + "\n")


if __name__ == "__main__":
    main(sys.argv[1:])
