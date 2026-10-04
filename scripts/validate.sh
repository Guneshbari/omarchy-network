#!/usr/bin/env bash
# ==============================================================================
# scripts/validate.sh
# Pre-PR validation script for community.network (omarchy-network)
#
# Validates required files, manifest schema, QML imports/syntax, JavaScript
# syntax, and performs a safety scan over tracked source files.
# ==============================================================================

set -euo pipefail

# Resolve repository root from the script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

PASSED_COUNT=0
WARN_COUNT=0
FAILED_COUNT=0

print_header() {
  echo "======================================================================"
  echo "  community.network Plugin Pre-PR Validator"
  echo "======================================================================"
  echo "Repository: $REPO_ROOT"
  echo ""
}

# Warn if executed with sudo or root
check_execution_environment() {
  if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
    echo "[WARN] Execution environment: Running as root is not recommended for pre-PR validation."
    echo "       The script does not require elevated privileges."
    WARN_COUNT=$((WARN_COUNT + 1))
  fi
}

# Check 1: Required files
check_required_files() {
  local missing=()
  for file in "manifest.json" "Panel.qml" "Model.js"; do
    if [[ ! -f "$file" ]]; then
      missing+=("$file")
    fi
  done

  if [[ ${#missing[@]} -gt 0 ]]; then
    echo "[FAIL] Required files: Missing required file(s): ${missing[*]}"
    echo "       Remediation: Ensure manifest.json, Panel.qml, and Model.js exist at the repository root."
    FAILED_COUNT=$((FAILED_COUNT + 1))
  else
    echo "[PASS] Required files: manifest.json, Panel.qml, and Model.js exist."
    PASSED_COUNT=$((PASSED_COUNT + 1))
  fi
}

# Check 2: Manifest safety
check_manifest_safety() {
  if [[ ! -f "manifest.json" ]]; then
    echo "[FAIL] Manifest safety: manifest.json does not exist."
    echo "       Remediation: Create a valid manifest.json file at the repository root."
    FAILED_COUNT=$((FAILED_COUNT + 1))
    return
  fi

  local error_msg=""

  if command -v jq >/dev/null 2>&1; then
    if ! jq . manifest.json >/dev/null 2>&1; then
      error_msg="manifest.json contains invalid JSON syntax."
    else
      local id version kinds entry_points
      id=$(jq -r '.id // empty' manifest.json)
      version=$(jq -r '.version // empty' manifest.json)
      kinds=$(jq -r '.kinds // empty' manifest.json)
      entry_points=$(jq -r '.entryPoints // empty' manifest.json)

      if [[ -z "$id" ]]; then
        error_msg="'id' property is missing or empty in manifest.json."
      elif [[ -z "$version" ]]; then
        error_msg="'version' property is missing or empty in manifest.json."
      elif [[ -z "$kinds" || "$kinds" == "[]" ]]; then
        error_msg="'kinds' array is missing or empty in manifest.json."
      elif [[ -z "$entry_points" || "$entry_points" == "{}" ]]; then
        error_msg="'entryPoints' mapping is missing or empty in manifest.json."
      else
        local ep_files
        ep_files=$(jq -r '.entryPoints | to_entries[] | .value' manifest.json 2>/dev/null || true)
        for ep_file in $ep_files; do
          if [[ ! -f "$ep_file" ]]; then
            error_msg="Referenced entry-point file '$ep_file' does not exist."
            break
          fi
        done
      fi
    fi
  elif command -v python3 >/dev/null 2>&1; then
    local py_res
    py_res=$(python3 -c '
import json, sys, os
try:
    with open("manifest.json") as f:
        data = json.load(f)
except Exception as e:
    print(f"manifest.json is not valid JSON: {e}")
    sys.exit(1)

for key in ["id", "version", "kinds", "entryPoints"]:
    if key not in data or not data[key]:
        print(f"Property \x27{key}\x27 is missing or empty in manifest.json.")
        sys.exit(1)

for ep, path in data.get("entryPoints", {}).items():
    if not os.path.isfile(path):
        print(f"Referenced entry-point file \x27{path}\x27 does not exist.")
        sys.exit(1)
' 2>&1 || true)
    if [[ -n "$py_res" ]]; then
      error_msg="$py_res"
    fi
  else
    echo "[WARN] Manifest safety: Neither 'jq' nor 'python3' found; skipping deep manifest validation."
    WARN_COUNT=$((WARN_COUNT + 1))
    return
  fi

  if [[ -n "$error_msg" ]]; then
    echo "[FAIL] Manifest safety: $error_msg"
    echo "       Remediation: Update manifest.json with valid JSON, required schema properties, and existing entry points."
    FAILED_COUNT=$((FAILED_COUNT + 1))
  else
    echo "[PASS] Manifest safety: manifest.json is valid with id, version, kinds, entryPoints, and verified files."
    PASSED_COUNT=$((PASSED_COUNT + 1))
  fi
}

# Check 3: Omarchy plugin validation
check_omarchy_validation() {
  if ! command -v omarchy >/dev/null 2>&1; then
    echo "[FAIL] Omarchy plugin validation: 'omarchy' CLI not found in PATH."
    echo "       Remediation: Install the Omarchy CLI or ensure it is accessible in PATH to validate plugins."
    FAILED_COUNT=$((FAILED_COUNT + 1))
    return
  fi

  local omarchy_out
  if omarchy_out=$(omarchy plugin validate . 2>&1); then
    echo "[PASS] Omarchy plugin validation: 'omarchy plugin validate .' passed with zero errors."
    PASSED_COUNT=$((PASSED_COUNT + 1))
  else
    echo "[FAIL] Omarchy plugin validation: 'omarchy plugin validate .' failed."
    if [[ -n "$omarchy_out" ]]; then
      echo "$omarchy_out" | sed 's/^/       /'
    fi
    echo "       Remediation: Fix manifest and plugin structure errors reported by omarchy plugin validate."
    FAILED_COUNT=$((FAILED_COUNT + 1))
  fi
}

# Check 4: QML validation
check_qml_validation() {
  if ! command -v qmllint >/dev/null 2>&1; then
    echo "[FAIL] QML validation: 'qmllint' not found in PATH."
    echo "       Remediation: Install Qt declarative development tools providing 'qmllint'."
    FAILED_COUNT=$((FAILED_COUNT + 1))
    return
  fi

  if [[ -z "${OMARCHY_PATH:-}" ]]; then
    echo "[FAIL] QML validation: OMARCHY_PATH environment variable is unset."
    echo "       Remediation: Export OMARCHY_PATH pointing to your Omarchy installation (e.g. export OMARCHY_PATH=/usr/share/omarchy)."
    FAILED_COUNT=$((FAILED_COUNT + 1))
    return
  fi

  if [[ ! -d "${OMARCHY_PATH}/shell" ]]; then
    echo "[FAIL] QML validation: OMARCHY_PATH is invalid ('${OMARCHY_PATH}/shell' not found)."
    echo "       Remediation: Set OMARCHY_PATH to a valid directory containing the 'shell' directory (typically /usr/share/omarchy)."
    FAILED_COUNT=$((FAILED_COUNT + 1))
    return
  fi

  local qmllint_out
  if qmllint_out=$(qmllint -I "${OMARCHY_PATH}/shell" Panel.qml 2>&1); then
    echo "[PASS] QML validation: 'qmllint -I \"\$OMARCHY_PATH/shell\" Panel.qml' passed with zero errors."
    PASSED_COUNT=$((PASSED_COUNT + 1))
  else
    echo "[FAIL] QML validation: 'qmllint' reported errors in Panel.qml."
    if [[ -n "$qmllint_out" ]]; then
      echo "$qmllint_out" | sed 's/^/       /'
    fi
    echo "       Remediation: Resolve QML syntax, binding, or import issues in Panel.qml."
    FAILED_COUNT=$((FAILED_COUNT + 1))
  fi
}

# Check 5: JavaScript syntax
check_js_syntax() {
  if ! command -v node >/dev/null 2>&1; then
    echo "[FAIL] JavaScript syntax: 'node' executable not found in PATH."
    echo "       Remediation: Install Node.js to enable JavaScript syntax validation."
    FAILED_COUNT=$((FAILED_COUNT + 1))
    return
  fi

  local node_out
  if node_out=$(node --check Model.js 2>&1); then
    echo "[PASS] JavaScript syntax: 'node --check Model.js' passed with valid syntax."
    PASSED_COUNT=$((PASSED_COUNT + 1))
  else
    echo "[FAIL] JavaScript syntax: 'node --check Model.js' reported syntax errors."
    if [[ -n "$node_out" ]]; then
      echo "$node_out" | sed 's/^/       /'
    fi
    echo "       Remediation: Correct JavaScript syntax errors in Model.js."
    FAILED_COUNT=$((FAILED_COUNT + 1))
  fi
}

# Check 6: Tracked-file safety scan
check_tracked_safety() {
  local tracked_files=()
  if command -v git >/dev/null 2>&1 && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    while IFS= read -r f; do
      [[ -n "$f" ]] && tracked_files+=("$f")
    done < <(git ls-files)
  else
    tracked_files=("manifest.json" "Model.js" "Panel.qml")
  fi

  local scan_failures=0
  local scan_warnings=0

  for file in "${tracked_files[@]}"; do
    [[ ! -f "$file" ]] && continue

    # 1. Obvious private-key PEM headers in all text files
    if [[ ! "$file" =~ \.(png|jpg|jpeg|gif|ico|bin|pdf)$ ]]; then
      local key_matches
      key_matches=$(grep -nE -- '-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----' "$file" 2>/dev/null || true)
      if [[ -n "$key_matches" ]]; then
        local lines
        lines=$(echo "$key_matches" | cut -d: -f1 | paste -sd, -)
        echo "[FAIL] Tracked-file safety: Obvious private key PEM header detected in $file (line $lines)."
        echo "       Remediation: Remove private key material immediately and rotate any exposed keys."
        scan_failures=$((scan_failures + 1))
      fi
    fi

    # 2. Dangerous commands, sudo, and second quickshell in executable/source files
    # Only scan executable/source files, skipping docs, markdown, templates, and this validator script
    if [[ "$file" =~ \.(qml|js|sh|bash|py)$ && "$file" != "scripts/validate.sh" ]]; then
      # Check pkill / killall
      local kill_matches
      kill_matches=$(grep -nE '\b(pkill|killall)\b' "$file" 2>/dev/null || true)
      if [[ -n "$kill_matches" ]]; then
        local lines
        lines=$(echo "$kill_matches" | cut -d: -f1 | paste -sd, -)
        echo "[FAIL] Tracked-file safety: Broad process termination (pkill/killall) in $file (line $lines)."
        echo "       Remediation: Use targeted PID-verified process management instead of broad process termination."
        scan_failures=$((scan_failures + 1))
      fi

      # Check sudo usage
      local sudo_matches
      sudo_matches=$(grep -nE '\bsudo\s+' "$file" 2>/dev/null || true)
      if [[ -n "$sudo_matches" ]]; then
        local lines
        lines=$(echo "$sudo_matches" | cut -d: -f1 | paste -sd, -)
        echo "[FAIL] Tracked-file safety: 'sudo' invocation detected in $file (line $lines)."
        echo "       Remediation: Do not use sudo. Use narrowly scoped PolicyKit (pkexec) helpers where required."
        scan_failures=$((scan_failures + 1))
      fi

      # Check launching second quickshell process
      local qs_matches
      qs_matches=$(grep -nE '(["'\''/]quickshell\b|^\s*quickshell\s+)' "$file" 2>/dev/null || true)
      if [[ -n "$qs_matches" ]]; then
        local lines
        lines=$(echo "$qs_matches" | cut -d: -f1 | paste -sd, -)
        echo "[FAIL] Tracked-file safety: Secondary quickshell process launch in $file (line $lines)."
        echo "       Remediation: Never start a second quickshell process; integrate components into the existing shell."
        scan_failures=$((scan_failures + 1))
      fi

      # Check suspicious hardcoded API token assignments
      local token_matches
      token_matches=$(grep -nE '(ghp_[A-Za-z0-9]{36}|glpat-[A-Za-z0-9\-]{20,}|AKIA[0-9A-Z]{16})' "$file" 2>/dev/null || true)
      if [[ -n "$token_matches" ]]; then
        local lines
        lines=$(echo "$token_matches" | cut -d: -f1 | paste -sd, -)
        echo "[FAIL] Tracked-file safety: Suspicious API token pattern in $file (line $lines)."
        echo "       Remediation: Remove hardcoded authentication tokens from source files."
        scan_failures=$((scan_failures + 1))
      fi
    fi
  done

  if [[ $scan_failures -gt 0 ]]; then
    FAILED_COUNT=$((FAILED_COUNT + scan_failures))
  elif [[ $scan_warnings -gt 0 ]]; then
    WARN_COUNT=$((WARN_COUNT + scan_warnings))
    echo "[PASS] Tracked-file safety: Safety scan completed with warnings (no critical violations)."
    PASSED_COUNT=$((PASSED_COUNT + 1))
  else
    echo "[PASS] Tracked-file safety: Tracked files scanned cleanly (no private keys, sudo, pkill/killall, or rogue quickshell processes)."
    PASSED_COUNT=$((PASSED_COUNT + 1))
  fi
}

main() {
  print_header
  check_execution_environment
  check_required_files
  check_manifest_safety
  check_omarchy_validation
  check_qml_validation
  check_js_syntax
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
