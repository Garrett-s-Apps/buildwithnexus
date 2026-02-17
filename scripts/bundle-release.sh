#!/usr/bin/env bash
# Bundle NEXUS source into a release tarball for npm distribution.
# The tarball is placed at dist/nexus-release.tar.gz and included in the npm package.
set -euo pipefail

NEXUS_SRC="${NEXUS_SRC:-$(dirname "$0")/../../nexus}"
OUT_DIR="$(dirname "$0")/../dist"

if [ ! -d "$NEXUS_SRC/src" ]; then
  echo "ERROR: NEXUS source not found at $NEXUS_SRC"
  echo "Set NEXUS_SRC to the nexus repo root."
  exit 1
fi

mkdir -p "$OUT_DIR"

tar czf "$OUT_DIR/nexus-release.tar.gz" \
  -C "$NEXUS_SRC" \
  --exclude='.git' \
  --exclude='__pycache__' \
  --exclude='*.pyc' \
  --exclude='.mypy_cache' \
  --exclude='.ruff_cache' \
  --exclude='*.db' \
  --exclude='node_modules' \
  --exclude='nexus-dashboard' \
  --exclude='nana-tracker' \
  --exclude='nana-tracker-rails' \
  --exclude='docs-hub' \
  --exclude='output' \
  --exclude='.env*' \
  --exclude='*.docx' \
  src/ \
  docker/ \
  requirements.txt \
  pyproject.toml \
  start.sh \
  setup_env.sh

echo "Bundled nexus-release.tar.gz ($(du -h "$OUT_DIR/nexus-release.tar.gz" | cut -f1))"
