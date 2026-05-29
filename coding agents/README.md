# Multi-Repo OpenHands Runner

This directory includes an OpenHands SDK workflow for:

1. Taking a **list of repositories**
2. Applying one shared **goal**
3. Asking the agent to commit/push/open a PR per repository
4. Printing one combined report

## Setup

```bash
cd "coding agents"
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env

export LLM_API_KEY=...
export LLM_MODEL=openhands/gpt-5-mini-2025-08-07
```

## Run

```bash
python run_multi_repo.py \
  --repo https://github.com/your-org/repo-a \
  --repo https://github.com/your-org/repo-b \
  --goal "Implement /health endpoint and CI checks"
```

Useful options:

- `--repos-file repos.txt` (newline list) or `repos.json` (JSON array)
- `--base-branch main`
- `--model openhands/gpt-5-mini-2025-08-07`
- `--stream` for per-repo run updates
- `--json-out report.json` for machine-readable output
- `--keep-workspaces` to retain local clones after execution
- `--dry-run` to validate inputs and preview prompt

## Input file examples

`repos.txt`
```text
https://github.com/your-org/repo-a
https://github.com/your-org/repo-b
```

`repos.json`
```json
[
  "https://github.com/your-org/repo-a",
  "https://github.com/your-org/repo-b"
]
```

## Notes

- Repos are cloned locally into temporary workspaces, then each run uses OpenHands tools (`terminal`, `file editor`, `task tracker`).
- The agent is required to write `.openhands_result.json` with status, PR URL, and summary.
- Exit code is `0` only when all repositories finish successfully.
