#!/usr/bin/env python3
"""Discover and control configured WireGuard tunnels without reading keys."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import uuid


class QueryError(Exception):
    pass


def run(args, timeout=5):
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=timeout,
                                env={**os.environ, "LC_ALL": "C"})
    except (OSError, subprocess.TimeoutExpired) as error:
        raise QueryError(f"{args[0]} unavailable or timed out") from error
    if result.returncode:
        raise QueryError((result.stderr.strip() or f"{args[0]} failed")[:500])
    return result.stdout


def split_nmcli(line):
    fields, field, escaped = [], "", False
    for char in line:
        if escaped:
            field += char
            escaped = False
        elif char == "\\":
            escaped = True
        elif char == ":":
            fields.append(field)
            field = ""
        else:
            field += char
    fields.append(field + ("\\" if escaped else ""))
    return fields


def valid_interface(name):
    return re.fullmatch(r"[A-Za-z0-9_=+.-]{1,15}", name) is not None


def quick_unit(name):
    return f"wg-quick@{name}.service"


def quick_interface(unit):
    if not isinstance(unit, str) or not unit.startswith("wg-quick@") or not unit.endswith(".service"):
        return ""
    # wg-quick's service passes %i verbatim, not the path-unescaped %I.
    name = unit[len("wg-quick@"):-len(".service")]
    return name if valid_interface(name) else ""


def discover():
    rows, warnings, units = [], [], {}
    for command, key in (("list-unit-files", "unit_file"), ("list-units", "unit")):
        try:
            entries = json.loads(run(["systemctl", command, "--all", "--output=json", "--no-pager", "wg-quick@*.service"]))
            if not isinstance(entries, list):
                raise ValueError("unexpected service list")
            for entry in entries:
                if not isinstance(entry, dict):
                    continue
                unit = entry.get(key, "")
                if quick_interface(unit) and entry.get("load") != "not-found":
                    units[unit] = entry.get("active", "inactive")
        except (QueryError, ValueError) as error:
            warnings.append(f"wg-quick service discovery: {error}")
    try:
        for path in Path("/etc/wireguard").glob("*.conf"):
            if valid_interface(path.stem):
                units.setdefault(quick_unit(path.stem), "inactive")
        # pathlib glob suppresses permission errors; report inaccessible directories explicitly.
        if Path("/etc/wireguard").exists() and not os.access("/etc/wireguard", os.R_OK | os.X_OK):
            warnings.append("Some wg-quick configurations are private. Enable their wg-quick@ service to make them discoverable.")
    except (OSError, QueryError) as error:
        warnings.append(f"wg-quick configuration discovery: {error}")
    quick_interfaces = set()
    for unit, state in sorted(units.items()):
        name = quick_interface(unit)
        if not name:
            continue
        if state in ("active", "activating", "deactivating"):
            quick_interfaces.add(name)
        rows.append({"id": unit, "name": name, "backend": "wg-quick", "interface": name,
                     "state": state, "active": state in ("active", "activating", "deactivating")})
    try:
        output = run(["nmcli", "--terse", "--escape", "yes", "--fields", "UUID,NAME,TYPE,DEVICE,STATE", "connection", "show"])
        for line in output.splitlines():
            fields = split_nmcli(line)
            if len(fields) != 5 or fields[2] != "wireguard":
                continue
            identity, name, _, device, state = fields
            try:
                uuid.UUID(identity)
            except ValueError:
                continue
            if device in quick_interfaces:
                continue
            rows.append({"id": identity, "name": name, "backend": "NetworkManager", "interface": device if device != "--" else "",
                         "state": state or "inactive", "active": state in ("activated", "activating", "deactivating")})
    except QueryError as error:
        warnings.append(f"NetworkManager discovery: {error}")
    return {"connections": sorted(rows, key=lambda row: (row["name"].casefold(), row["backend"], row["id"])),
            "warnings": warnings}


def change(backend, identity, action):
    if action not in ("connect", "disconnect"):
        raise QueryError("Unsupported WireGuard action")
    # Resolve against current configuration instead of accepting arbitrary service names.
    match = next((row for row in discover()["connections"]
                  if row["backend"] == backend and row["id"] == identity), None)
    if match is None:
        raise QueryError("WireGuard connection no longer exists; refresh the list")
    if backend == "NetworkManager":
        run(["nmcli", "--wait", "30", "connection", "up" if action == "connect" else "down", "uuid", identity], timeout=35)
    elif backend == "wg-quick":
        run(["systemctl", "--no-ask-password", "start" if action == "connect" else "stop", identity], timeout=45)
    else:
        raise QueryError("Unsupported WireGuard backend")
    return {"ok": True}


def main():
    try:
        if len(sys.argv) == 2 and sys.argv[1] == "list":
            result = discover()
        elif len(sys.argv) == 5 and sys.argv[1] == "action":
            result = change(*sys.argv[2:])
        else:
            raise QueryError("Usage: WireGuard.py list | action BACKEND ID connect|disconnect")
        print(json.dumps(result))
    except QueryError as error:
        print(json.dumps({"error": str(error)}))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
