---
name: github-pr
description: Branch, commit, push, and open a GitHub pull request from the cloned repo
---

# GitHub pull request

Use when the repo is mounted under `/workspace/repo` (or the path given in the task).

## Preconditions

- `git config user.email` and `user.name` are set if missing (use `aid-agent@users.noreply.github.com` / `AID Agent`).
- Remote `origin` should point at the GitHub repo URL.

## Steps

1. `cd` to the repo root; confirm clean working tree on the base branch.
2. `git checkout -b <feature-branch>` from the requested base branch.
3. Make focused changes; avoid unrelated refactors.
4. `git add` only intentional files; commit with a descriptive message.
5. `git push -u origin <feature-branch>`.
6. Create the PR:
   - **CLI**: `gh pr create --base <base> --head <feature-branch> --fill` or explicit `--title` / `--body`.
   - **API**: `curl -X POST -H "Authorization: ..." https://api.github.com/repos/OWNER/REPO/pulls` with JSON `title`, `head`, `base`, `body`.
7. Return the PR web URL in the required `PR_URL:` line.

## Private repos

The sandbox `network.allowlist` injects `Authorization: Basic …` on `github.com` (from `x-oauth-basic:PAT` base64) plus `domain: "*"` for other hosts. Git push and `gh`/REST calls use that egress; do not print tokens.

## Failures

If push or PR creation fails, report the exact command, stderr, and whether the token lacks `repo` / `pull_requests` scope.
