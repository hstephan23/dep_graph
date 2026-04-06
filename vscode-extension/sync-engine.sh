#!/usr/bin/env bash
# sync-engine.sh — Copy the canonical Python engine + static files into the
# VS Code extension's engine/ directory so the extension always ships the
# latest code.  Also syncs shared/constants.json and regenerates the browser
# constants.js from it.
#
# Run this from the vscode-extension/ directory:
#     bash sync-engine.sh
#
# It is also invoked automatically by `npm run sync-engine` and before
# `vsce package` via the vscode:prepublish hook.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENGINE_DIR="$SCRIPT_DIR/engine"
SHARED_SRC="$PROJECT_ROOT/shared/constants.json"

echo "Syncing engine files from $PROJECT_ROOT → $ENGINE_DIR"

# Ensure engine directory exists
mkdir -p "$ENGINE_DIR"

# ── Shared constants ────────────────────────────────────────
# Copy into the extension (read at runtime by webview.ts) and into engine/
# (available to the bundled Python code).
if [ -f "$SHARED_SRC" ]; then
    mkdir -p "$SCRIPT_DIR/shared"
    cp "$SHARED_SRC" "$SCRIPT_DIR/shared/constants.json"
    mkdir -p "$ENGINE_DIR/shared"
    cp "$SHARED_SRC" "$ENGINE_DIR/shared/constants.json"
    echo "  ✓ shared/constants.json"

    # Regenerate static/constants.js for the browser frontend
    CONSTANTS_JS="$PROJECT_ROOT/static/constants.js"
    RISK_COLORS=$(python3 -c "import json; d=json.load(open('$SHARED_SRC')); print(json.dumps(d['risk_colors']))")
    RISK_LABELS=$(python3 -c "import json; d=json.load(open('$SHARED_SRC')); print(json.dumps(d['risk_labels']))")
    cat > "$CONSTANTS_JS" <<EOF
// AUTO-GENERATED from shared/constants.json — do not edit directly.
// Run \`bash vscode-extension/sync-engine.sh\` or \`npm run sync-engine\` to regenerate.
const RISK_PALETTE = ${RISK_COLORS};
const RISK_LABELS = ${RISK_LABELS};
EOF
    echo "  ✓ static/constants.js (generated)"
else
    echo "  ⚠ shared/constants.json not found, skipping constants sync"
fi

# ── Python engine files ─────────────────────────────────────
HEADER="# AUTO-SYNCED from project root — do not edit this copy."
for py_file in graph.py parsers.py cli.py app.py churn.py; do
    if [ -f "$PROJECT_ROOT/$py_file" ]; then
        { echo "$HEADER"; echo "# Source: ../$py_file"; echo ""; cat "$PROJECT_ROOT/$py_file"; } > "$ENGINE_DIR/$py_file"
        echo "  ✓ $py_file"
    else
        echo "  ⚠ $py_file not found in project root, skipping"
    fi
done

# ── Static assets ───────────────────────────────────────────
if [ -d "$PROJECT_ROOT/static" ]; then
    mkdir -p "$ENGINE_DIR/static"
    rsync -a --delete "$PROJECT_ROOT/static/" "$ENGINE_DIR/static/"
    echo "  ✓ static/ directory"
else
    echo "  ⚠ static/ directory not found in project root, skipping"
fi

echo "Engine sync complete."
