#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

pick_python() {
  for cmd in python3.13 python3.12 python3.11; do
    if command -v "$cmd" >/dev/null 2>&1; then
      echo "$cmd"
      return 0
    fi
  done
  echo "No supported Python found (need 3.11, 3.12, or 3.13)." >&2
  echo "Python 3.14 is not supported with older pydantic pins; use 3.13 or upgrade pydantic." >&2
  exit 1
}

PYTHON="$(pick_python)"
echo "Using $PYTHON ($("$PYTHON" --version))"

if [ -d .venv ]; then
  VENV_PY="$(.venv/bin/python -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
  if [ "$VENV_PY" = "3.14" ]; then
    echo "Removing existing .venv (Python 3.14 — incompatible with pinned deps)."
    rm -rf .venv
  fi
fi

if [ ! -d .venv ]; then
  "$PYTHON" -m venv .venv
fi

.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r requirements.txt

echo "Done. Activate with: source .venv/bin/activate"
