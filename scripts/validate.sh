#!/usr/bin/env bash
# ==============================================================================
# scripts/validate.sh
# Pre-PR validation script for community.network (omarchy-network)
#
# Validates required files, manifest schema, QML syntax, JavaScript syntax,
# and performs focused safety scans over tracked source files.
# ==============================================================================

set -euo pipefail

# Resolve repository root from script location
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

PASSED_COUNT=0
WARN_COUNT=0
FAILED_COUNT=0

pass() { echo "[PASS] $1"; PASSED_COUNT=$((PASSED_COUNT + 1)); }
warn() { echo "[WARN] $1"; WARN_COUNT=$((WARN_COUNT + 1)); }
fail() {
  echo "[FAIL] $1"
  [[ -n "${2:-}" ]] && echo "       Remediation: $2"
  FAILED_COUNT=$((FAILED_COUNT + 1))
}

check_environment() {
  if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
    warn "Execution environment: Running as root is not recommended; validation does not require elevated privileges."
  fi
}

check_required_files() {
  local missing=()
  for file in "manifest.json" "Panel.qml" "Model.js"; do
    [[ ! -f "$file" ]] && missing+=("$file")
  done

  if [[ ${#missing[@]} -gt 0 ]]; then
    fail "Required files: Missing required file(s): ${missing[*]}" "Ensure manifest.json, Panel.qml, and Model.js exist at the repository root."
  else
    pass "Required files: manifest.json, Panel.qml, and Model.js exist."
  fi
}

check_manifest() {
  [[ ! -f "manifest.json" ]] && return

  if command -v jq >/dev/null 2>&1; then
    if ! jq . manifest.json >/dev/null 2>&1; then
      fail "Manifest safety: Invalid JSON syntax in manifest.json." "Ensure manifest.json is well-formed JSON."
      return
    fi
    local id version kinds entry_points
    id=$(jq -r '.id // empty' manifest.json)
    version=$(jq -r '.version // empty' manifest.json)
    kinds=$(jq -r '.kinds // empty' manifest.json)
    entry_points=$(jq -r '.entryPoints // empty' manifest.json)

    if [[ -z "$id" || -z "$version" || -z "$kinds" || "$kinds" == "[]" || -z "$entry_points" || "$entry_points" == "{}" ]]; then
      fail "Manifest safety: Required schema properties (id, version, kinds, entryPoints) are missing or empty." "Define non-empty id, version, kinds, and entryPoints."
      return
    fi

    local ep_files ep_file
    ep_files=$(jq -r '.entryPoints | to_entries[] | .value' manifest.json 2>/dev/null || true)
    for ep_file in $ep_files; do
      if [[ ! -f "$ep_file" ]]; then
        fail "Manifest safety: Referenced entry point '$ep_file' does not exist." "Ensure all files referenced in entryPoints exist."
        return
      fi
    done
    pass "Manifest safety: manifest.json is valid with schema properties and verified entry points."
  elif command -v python3 >/dev/null 2>&1; then
    local py_res
    py_res=$(python3 -c '
import json, sys, os
try:
    with open("manifest.json") as f:
        data = json.load(f)
except Exception as e:
    sys.exit(f"Invalid JSON: {e}")
for k in ["id", "version", "kinds", "entryPoints"]:
    if not data.get(k):
        sys.exit(f"Missing or empty required field: {k}")
for _, path in data.get("entryPoints", {}).items():
    if not os.path.isfile(path):
        sys.exit(f"Referenced entry point file not found: {path}")
' 2>&1 || true)
    if [[ -n "$py_res" ]]; then
      fail "Manifest safety: $py_res" "Fix manifest.json schema and referenced entry point files."
    else
      pass "Manifest safety: manifest.json is valid with schema properties and verified entry points."
    fi
  else
    warn "Manifest safety: Neither jq nor python3 found; skipping deep schema validation."
  fi
}

check_omarchy() {
  if ! command -v omarchy >/dev/null 2>&1; then
    fail "Omarchy plugin validation: 'omarchy' CLI not found in PATH." "Install Omarchy CLI or ensure it is accessible in PATH."
    return
  fi

  local omarchy_out
  if omarchy_out=$(omarchy plugin validate . 2>&1); then
    pass "Omarchy plugin validation: 'omarchy plugin validate .' passed with zero errors."
  else
    fail "Omarchy plugin validation: 'omarchy plugin validate .' failed." "Resolve manifest and plugin structure errors reported by omarchy."
    [[ -n "$omarchy_out" ]] && echo "$omarchy_out" | sed 's/^/       /'
  fi
}

check_qml() {
  if ! command -v qmllint >/dev/null 2>&1; then
    fail "QML validation: 'qmllint' not found in PATH." "Install Qt declarative tools (qmllint)."
    return
  fi

  if [[ -z "${OMARCHY_PATH:-}" ]]; then
    fail "QML validation: OMARCHY_PATH is unset." "Export OMARCHY_PATH pointing to Omarchy installation (e.g. export OMARCHY_PATH=/usr/share/omarchy)."
    return
  fi

  if [[ ! -d "${OMARCHY_PATH}/shell" ]]; then
    fail "QML validation: OMARCHY_PATH/shell not found at '${OMARCHY_PATH}/shell'." "Set OMARCHY_PATH to a valid directory containing 'shell/'."
    return
  fi

  local qmllint_out
  if qmllint_out=$(qmllint -I "${OMARCHY_PATH}/shell" Panel.qml 2>&1); then
    pass "QML validation: 'qmllint -I \"\$OMARCHY_PATH/shell\" Panel.qml' passed with zero errors."
  else
    fail "QML validation: 'qmllint' reported errors in Panel.qml." "Fix QML syntax, binding, or import issues in Panel.qml."
    [[ -n "$qmllint_out" ]] && echo "$qmllint_out" | sed 's/^/       /'
  fi
}

check_js() {
  if ! command -v node >/dev/null 2>&1; then
    fail "JavaScript syntax: 'node' executable not found in PATH." "Install Node.js to validate JavaScript syntax."
    return
  fi

  local node_out
  if node_out=$(node --check Model.js 2>&1); then
    pass "JavaScript syntax: 'node --check Model.js' passed with valid syntax."
  else
    fail "JavaScript syntax: 'node --check Model.js' reported syntax errors." "Fix JavaScript syntax errors in Model.js."
    [[ -n "$node_out" ]] && echo "$node_out" | sed 's/^/       /'
  fi
}

check_tracked_safety() {
  local tracked=()
  local f
  if command -v git >/dev/null 2>&1 && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    while IFS= read -r f; do
      [[ -n "$f" ]] && tracked+=("$f")
    done < <(git ls-files)
  else
    tracked=("Model.js" "Panel.qml" "manifest.json")
  fi

  local found_leak=false
  local file

  for file in "${tracked[@]}"; do
    [[ ! -f "$file" ]] && continue

    # 1. Private key PEM headers in non-binary files (Hard failure)
    if [[ ! "$file" =~ \.(png|jpg|jpeg|gif|ico|bin|pdf)$ ]]; then
      local key_lines=""
      key_lines=$(grep -nE -- '-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----' "$file" 2>/dev/null | cut -d: -f1 | paste -sd, - || true)
      if [[ -n "$key_lines" ]]; then
        fail "Secret scan: Private key PEM header detected in $file (line $key_lines)." "Remove private key material immediately and rotate any exposed keys."
        found_leak=true
      fi
    fi

    # 2. High-confidence credential formats in source files (Hard failure)
    if [[ "$file" =~ \.(qml|js|sh|bash|py)$ && "$file" != "scripts/validate.sh" ]]; then
      local token_lines=""
      token_lines=$(grep -nE '(ghp_[A-Za-z0-9]{36}|glpat-[A-Za-z0-9\-]{20,}|AKIA[0-9A-Z]{16})' "$file" 2>/dev/null | cut -d: -f1 | paste -sd, - || true)
      if [[ -n "$token_lines" ]]; then
        fail "Secret scan: High-confidence credential token pattern detected in $file (line $token_lines)." "Remove hardcoded credentials from source code."
        found_leak=true
      fi

      # 3. Contextual warning for pkill / killall (Warning only)
      local kill_lines=""
      kill_lines=$(grep -nE '\b(pkill|killall)\b' "$file" 2>/dev/null | cut -d: -f1 | paste -sd, - || true)
      if [[ -n "$kill_lines" ]]; then
        warn "Process safety: Broad process termination (pkill/killall) found in $file (line $kill_lines). Ensure process identity and ownership are verified."
      fi
    fi
  done

  if ! $found_leak; then
    pass "Tracked-file safety: No private keys or exposed credentials detected in tracked files."
  fi
}

main() {
  echo "======================================================================"
  echo "  community.network Plugin Pre-PR Validator"
  echo "======================================================================"
  echo "Repository: $REPO_ROOT"
  echo ""

  check_environment
  check_required_files
  check_manifest
  check_omarchy
  check_qml
  check_js
  check_tracked_safety

  echo ""
  echo "----------------------------------------------------------------------"
  echo "Validation Summary: $PASSED_COUNT passed, $WARN_COUNT warnings, $FAILED_COUNT failures"
  echo "----------------------------------------------------------------------"

  if [[ $FAILED_COUNT -gt 0 ]]; then
    echo "Result: FAILED - Please remediate the issues identified above before opening a PR."
    exit 1
  else
    echo "Result: PASSED - All pre-PR validation checks completed successfully."
    exit 0
  fi
}

main "$@"
