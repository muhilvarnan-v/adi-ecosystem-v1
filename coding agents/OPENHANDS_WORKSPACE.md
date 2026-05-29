# OpenHands workspaces in AID

## Per-goal execution workspace

Every goal run creates a **fresh directory** on the machine that executes the coding agent:

- Prefix: `openhands-goal-<goal-id-slug>-…` (see logs: “OpenHands per-goal workspace …”).
- The GitHub repo is cloned under `<that-dir>/repo`.
- After a successful run the tree is removed unless you pass `--keep-workspaces` to `run_multi_repo.py`.

This matches OpenHands’ notion of a **workspace** as the working tree where tools run.

## Local vs Docker (remote runtime)

By default the OpenHands SDK uses **`LocalWorkspace`**: shell/file tools run on the **same host** as the Python process (your backend worker or laptop).

For **Docker-isolated** execution, OpenHands expects a **runtime / agent server** that exposes the HTTP API the SDK calls via **`RemoteWorkspace`**. In this repo:

1. Set **`OPENHANDS_RUNTIME_HOST`** to the base URL of that server (e.g. `https://your-openhands-runtime.example.com`), **or** configure the AID backend `.env`:
   - `openhands_runtime_host`
   - `openhands_runtime_api_key` (optional, forwarded as `OPENHANDS_RUNTIME_API_KEY`)
   - `openhands_docker_base_image` (optional; depends on your runtime — forwarded as `OPENHANDS_DOCKER_BASE_IMAGE` for server-side use)

2. Restart the backend so subprocesses inherit these variables when invoking `coding agents/run_goal.py`.

**Note:** With `RemoteWorkspace`, the `working_dir` you pass must exist **on the runtime server** (or be a path the server understands). The default AID flow clones the repo **locally** next to the coding-agent process; that layout suits **`LocalWorkspace`**. For pure Docker runs, you typically run the whole OpenHands stack (or point the SDK at a runtime that clones/mounts the repo for you).

Architecture overview: [OpenHands runtime / Docker](https://docs.all-hands.dev/modules/usage/architecture/runtime).

## Harness “Workspaces” vs Firestore

The Harness **Workspaces** page is the old **Environments** feature: skill bundles and optional remote runtime metadata. Documents still live in the Firestore collection **`environments`**; the HTTP API is **`/api/workspaces`**.
