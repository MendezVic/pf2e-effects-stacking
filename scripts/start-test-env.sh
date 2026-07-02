#!/bin/bash
# Boot Foundry headlessly against test/foundry-data on port 30005, auto-launching
# a world. Used by the Playwright harness (and handy for manual debugging).
#
# This Mac's Foundry is the UNVERSIONED app bundle, so we detect that first and fall
# back to the versioned name. Override with FOUNDRY_APP=<dir containing main.js>.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEST_DATA="$REPO_ROOT/test/foundry-data"
PORT="${TEST_FOUNDRY_PORT:-30005}"
FOUNDRY_VERSION="${FOUNDRY_VERSION:-14}"

if [ ! -f "$TEST_DATA/Config/options.json" ]; then
    echo "❌ Test data path not initialized at $TEST_DATA"
    echo "   Run: npm run test:e2e:setup"
    exit 1
fi

if [ -z "${FOUNDRY_APP:-}" ]; then
    for candidate in \
        "/Applications/Foundry Virtual Tabletop.app/Contents/Resources/app" \
        "/Applications/Foundry Virtual Tabletop v${FOUNDRY_VERSION}.app/Contents/Resources/app"; do
        if [ -f "$candidate/main.js" ]; then
            FOUNDRY_APP="$candidate"
            break
        fi
    done
fi

if [ -z "${FOUNDRY_APP:-}" ] || [ ! -f "$FOUNDRY_APP/main.js" ]; then
    echo "❌ Foundry app not found. Set FOUNDRY_APP to the dir containing main.js"
    echo "   (e.g. '/Applications/Foundry Virtual Tabletop.app/Contents/Resources/app')."
    exit 1
fi

cd "$FOUNDRY_APP"

ARGS=(
    --dataPath="$TEST_DATA"
    --port="$PORT"
    --noupnp
)

if [ -n "${TEST_WORLD:-}" ]; then
    ARGS+=(--world="$TEST_WORLD")
    echo "Auto-launching world: $TEST_WORLD"
fi

echo "Starting Foundry from $FOUNDRY_APP on port $PORT"
exec node main.js "${ARGS[@]}"
