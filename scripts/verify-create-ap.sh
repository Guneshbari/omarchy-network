#!/usr/bin/env bash
# ==============================================================================
# scripts/verify-create-ap.sh
# Independently reproduces the create_ap build this plugin installs.
#
#   1. downloads src/scripts/create_ap from lakinduakash/linux-wifi-hotspot at the
#      immutable commit the plugin pins and checks the upstream SHA-256;
#   2. applies the plugin's one fixed transformation (all runtime state moves from
#      world-writable /tmp to the root-only /run/create_ap);
#   3. checks the SHA-256 of the result against the value in Model.js, shows the
#      complete diff, and confirms no /tmp state path is left.
#
# Needs only curl, sed, sha256sum, diff, node. Installs and modifies nothing.
# ==============================================================================
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

COMMIT="63c2168626a0b13015913d52d5dbd5e1d91a7fb6"
UPSTREAM_SHA="6ff2bde71be2076781c2d7338bcef53d7a787b2c557230feba76113072911667"
URL="https://raw.githubusercontent.com/lakinduakash/linux-wifi-hotspot/${COMMIT}/src/scripts/create_ap"

work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
fail() { echo "[FAIL] $1" >&2; exit 1; }

curl -fsSL --proto '=https' --tlsv1.2 -o "$work/create_ap" "$URL" || fail "download failed"
[[ "$(sha256sum "$work/create_ap" | cut -d' ' -f1)" == "$UPSTREAM_SHA" ]] || fail "upstream checksum mismatch"
echo "[PASS] upstream create_ap at $COMMIT matches $UPSTREAM_SHA"

# Keep this transformation byte-for-byte identical to installRepeaterScript in Model.js.
sed -e 's#/tmp/create_ap\.#/run/create_ap/create_ap.#g' \
    -e '/^COUNTER_LOCK_FILE=/i\
# omarchy-network: all create_ap runtime state lives in a root-owned directory, never in /tmp.\
[[ $EUID -ne 0 || ( -d /run/create_ap \&\& ! -L /run/create_ap ) ]] || mkdir -m 0755 /run/create_ap || exit 1' \
    "$work/create_ap" > "$work/create_ap.patched"

got=$(sha256sum "$work/create_ap.patched" | cut -d' ' -f1)
pinned=$(node -e 'console.log(require("./Model.js").createApPatchedSha256)')
[[ "$got" == "$pinned" ]] || fail "patched build $got != pinned $pinned in Model.js"
echo "[PASS] patched build matches the SHA-256 pinned in Model.js ($pinned)"

if grep -n '/tmp/create_ap\.' "$work/create_ap.patched"; then fail "a /tmp state path is still present"; fi
bash -n "$work/create_ap.patched" || fail "patched script has a syntax error"
echo "[PASS] no /tmp state path remains; syntax ok"

echo; echo "Complete difference between upstream and the installed build:"
diff "$work/create_ap" "$work/create_ap.patched" || true
