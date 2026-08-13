#!/usr/bin/env bash
# Installs the algolia-data-enrichment skill into ~/.claude/skills/.
#
# The skill is not a single markdown file -- it is a CLI over a Python package, so the whole
# directory is copied. The install then VERIFIES: Python version, PyYAML, and the full test
# suite. An installer that copies files and reports success without running anything is how you
# discover a broken dependency three commands into a real slice.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_NAME="algolia-data-enrichment"
DEST="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}/$SKILL_NAME"

say()  { printf '  %s\n' "$*"; }
ok()   { printf '  \033[32mOK\033[0m    %s\n' "$*"; }
warn() { printf '  \033[33mWARN\033[0m  %s\n' "$*"; }
die()  { printf '  \033[31mFAIL\033[0m  %s\n' "$*" >&2; exit 1; }

echo
echo "Installing $SKILL_NAME"
echo

# ---- preflight -------------------------------------------------------------

command -v python3 >/dev/null 2>&1 || die "python3 not found."

PY_OK=$(python3 -c 'import sys; print(1 if sys.version_info >= (3, 10) else 0)')
PY_VER=$(python3 -c 'import sys; print("%d.%d.%d" % sys.version_info[:3])')
[ "$PY_OK" = "1" ] || die "Python $PY_VER found; 3.10 or newer is required."
ok "python3 $PY_VER"

if ! python3 -c 'import yaml' >/dev/null 2>&1; then
  warn "PyYAML missing -- profiles are YAML and will not load without it."
  say  "Install with:  python3 -m pip install pyyaml"
  die  "Install PyYAML, then re-run this script."
fi
ok "pyyaml"

command -v curl >/dev/null 2>&1 || die "curl not found. It is used instead of urllib because \
corporate TLS interception breaks certifi on some machines."
ok "curl"

HAVE_PYTEST=1
python3 -c 'import pytest' >/dev/null 2>&1 || HAVE_PYTEST=0

# ---- verify BEFORE installing ---------------------------------------------

if [ "$HAVE_PYTEST" = "1" ]; then
  say "running the test suite from the source tree..."
  if OUT=$(cd "$SCRIPT_DIR" && python3 -m pytest scripts/tests -q 2>&1); then
    ok "$(printf '%s' "$OUT" | tail -1)"
  else
    printf '%s\n' "$OUT" | tail -20
    die "tests failed. Not installing a broken skill."
  fi
else
  warn "pytest not installed -- skipping verification."
  say  "Install with:  python3 -m pip install pytest    (then re-run to verify)"
fi

# ---- install ---------------------------------------------------------------

if [ -e "$DEST" ]; then
  BACKUP="$DEST.bak.$(date +%Y%m%d-%H%M%S)"
  mv "$DEST" "$BACKUP"
  warn "existing install moved to $BACKUP"
fi

mkdir -p "$(dirname "$DEST")"
mkdir -p "$DEST"
# Copy the skill, leaving build residue behind.
( cd "$SCRIPT_DIR" && tar --exclude='__pycache__' --exclude='.pytest_cache' \
                          --exclude='*.pyc' --exclude='*.bak.*' -cf - . ) | ( cd "$DEST" && tar -xf - )
chmod +x "$DEST/install-skill.sh" 2>/dev/null || true
ok "installed to $DEST"

# ---- verify the INSTALLED copy, not the source ----------------------------
#
# The source tree passing says nothing about what landed on disk. This project's own first rule
# is that a claim is only true of the surface it was checked against.

python3 "$DEST/scripts/algolia_enrich.py" --help >/dev/null 2>&1 \
  || die "the installed CLI does not run."
ok "installed CLI responds to --help"

python3 - "$DEST" <<'PY' || die "the installed profiles do not load."
import sys
sys.path.insert(0, f"{sys.argv[1]}/scripts")
from algolia_enrichment.profiles import load_profile
p = load_profile(f"{sys.argv[1]}/scripts/profiles", "Customer Stories", "case-study")
assert p.strategy == "case_study", p.strategy
PY
ok "installed profiles load"

# ---- what the user needs to know next -------------------------------------

cat <<EOF

Installed. Restart Claude Code (or open a new session) to load the skill.

Credentials
  This skill reads .env.local from the WORKSPACE you point it at -- never from this repo,
  and never from a command line. Required keys:

    ALGOLIA_APP_ID, ALGOLIA_ADMIN_API_KEY
    SCOUT_HOSTED_API_KEY
    ALGOLIA_INFERENCE_BASE_URL, ALGOLIA_INFERENCE_API_KEY

Index names
  Config, not literals: $DEST/scripts/enrichment-config.yaml
  Override per run with --source-index / --target-index.
  The source index is read-only. There is no code path that writes to it.

First command to run
  python3 $DEST/scripts/algolia_enrich.py census --workspace /path/to/project

Read first
  $DEST/README.md
  $DEST/docs/COMMANDS.md

EOF
