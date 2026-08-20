#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CENTRAL_REPO="${ALGOLIA_CHAT_SOURCE_REPO:-/Users/arijitchowdhury/Dropbox/AI-Development/RAG/algolia-central-chat-widget}"
LIVE_BUNDLE="$ROOT_DIR/frontend/chat-widget/algolia-chat.js"
CANDIDATE_BUNDLE="$CENTRAL_REPO/algolia-chat/dist/algolia-chat.js"
BACKUP_BUNDLE="$(mktemp -t algolia-chat-proven.XXXXXX.js)"
LOCK_DIR="${TMPDIR:-/tmp}/algolia-chat-bundle-validation.lock"
LOCK_OWNER="$LOCK_DIR/pid"
ORIGINAL_SHA=""
LOCK_ACQUIRED="false"

acquire_lock() {
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    printf '%s\n' "$$" > "$LOCK_OWNER"
    LOCK_ACQUIRED="true"
    return
  fi

  local owner=""
  owner="$(cat "$LOCK_OWNER" 2>/dev/null || true)"
  if [[ -n "$owner" ]] && kill -0 "$owner" 2>/dev/null; then
    echo "Another bundle validation is already running (pid $owner)." >&2
    exit 2
  fi

  rm -rf "$LOCK_DIR"
  mkdir "$LOCK_DIR"
  printf '%s\n' "$$" > "$LOCK_OWNER"
  LOCK_ACQUIRED="true"
}

restore_bundle() {
  if [[ -f "$BACKUP_BUNDLE" ]] && [[ -n "$ORIGINAL_SHA" ]]; then
    cp "$BACKUP_BUNDLE" "$LIVE_BUNDLE"
    local restored_sha
    restored_sha="$(shasum -a 256 "$LIVE_BUNDLE" | awk '{print $1}')"
    if [[ "$restored_sha" != "$ORIGINAL_SHA" ]]; then
      echo "ERROR: shared bundle restoration failed: expected $ORIGINAL_SHA, got $restored_sha" >&2
    else
      echo "Restored shared bundle SHA-256: $restored_sha"
    fi
  fi
  rm -f "$BACKUP_BUNDLE"
  if [[ "$LOCK_ACQUIRED" == "true" ]]; then
    rm -rf "$LOCK_DIR"
  fi
}

trap restore_bundle EXIT INT TERM

acquire_lock

if [[ ! -f "$CANDIDATE_BUNDLE" ]]; then
  echo "Candidate bundle not found: $CANDIDATE_BUNDLE" >&2
  exit 1
fi

cp "$LIVE_BUNDLE" "$BACKUP_BUNDLE"
ORIGINAL_SHA="$(shasum -a 256 "$BACKUP_BUNDLE" | awk '{print $1}')"
echo "Pre-run shared bundle SHA-256: $ORIGINAL_SHA"

npm test --prefix "$CENTRAL_REPO/chat-central"
npm run build:central --prefix "$CENTRAL_REPO"
npm run build:widget --prefix "$CENTRAL_REPO"
cp "$CANDIDATE_BUNDLE" "$LIVE_BUNDLE"

echo "Candidate SHA-256: $(shasum -a 256 "$CANDIDATE_BUNDLE" | awk '{print $1}')"
npm run test:chat-widget --prefix "$ROOT_DIR"
