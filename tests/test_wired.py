"""Run the exported wired scripts against fake nmcli; no host settings are written."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).parents[1]
UUID = "11111111-2222-3333-4444-555555555555"


class WiredTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.model = json.loads(subprocess.check_output([
            "node", "-e", "console.log(JSON.stringify(require('./Model.js')))"
        ], cwd=ROOT, text=True))

    def execute(self, script, *args, kind="802-3-ethernet", fail_activate=False):
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            log = directory / "calls.jsonl"
            (directory / "nmcli").write_text('''#!/usr/bin/env python3
import json, os, sys
args = sys.argv[1:]
with open(os.environ["NM_LOG"], "a") as stream: stream.write(json.dumps(args) + "\\n")
u = "11111111-2222-3333-4444-555555555555"
if "id" in args: sys.exit("name lookup must not be used")
if "-g" in args:
    fields = args[args.index("-g") + 1]
    if fields == "connection.type": print(os.environ["NM_KIND"])
    elif fields == "connection.id": print("Duplicate name")
    elif fields == "connection.interface-name": print("enp0s31f6")
    elif fields == "ipv4.method,ipv4.addresses,ipv4.gateway,ipv4.dns": print("manual\\n192.0.2.2/24\\n192.0.2.1\\n1.1.1.1")
    else: sys.exit("unexpected field")
elif "modify" in args: pass
elif "reapply" in args or "up" in args:
    if os.environ["NM_FAIL"] == "1": sys.exit(1)
elif "show" in args: print(u + ":802-3-ethernet:enp0s31f6")
else: sys.exit("unexpected nmcli command")
''')
            (directory / "nmcli").chmod(0o755)
            # Read-only device detection should not depend on this host's route table.
            (directory / "ip").write_text('#!/bin/sh\nexit 0\n')
            (directory / "ip").chmod(0o755)
            env = {**os.environ, "PATH": str(directory) + os.pathsep + os.environ["PATH"],
                   "NM_LOG": str(log), "NM_KIND": kind, "NM_FAIL": "1" if fail_activate else "0"}
            result = subprocess.run(["bash", "-c", self.model[script], "test-wired", *args],
                                    capture_output=True, text=True, env=env, timeout=5)
            calls = [json.loads(line) for line in log.read_text().splitlines()] if log.exists() else []
            return result, calls

    def test_query_keeps_uuid_and_batches_ipv4_settings(self):
        result, calls = self.execute("wiredQueryScript")
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)
        self.assertEqual(data["uuid"], UUID)
        self.assertEqual(data["addresses"], "192.0.2.2/24")
        self.assertEqual(sum("ipv4.method,ipv4.addresses,ipv4.gateway,ipv4.dns" in call for call in calls), 1)

    def test_duplicate_name_never_selects_another_profile(self):
        result, calls = self.execute("wiredApplyScript", "Duplicate name", "auto", "", "", "", UUID)
        self.assertEqual(result.returncode, 0, result.stderr)
        writes = [call for call in calls if "modify" in call]
        self.assertEqual(len(writes), 1)
        self.assertEqual(writes[0][:4], ["connection", "modify", "uuid", UUID])

    def test_non_ethernet_profile_rejected_before_write(self):
        result, calls = self.execute("wiredApplyScript", "Duplicate name", "auto", "", "", "", UUID, kind="wireguard")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("not Ethernet", result.stderr)
        self.assertFalse(any("modify" in call or "add" in call for call in calls))

    def test_failed_reapply_and_activation_return_failure(self):
        result, _ = self.execute("wiredApplyScript", "Duplicate name", "auto", "", "", "", UUID, fail_activate=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Settings saved", result.stderr)

    def test_invalid_ipv4_rejected_before_nmcli(self):
        result, calls = self.execute("wiredApplyScript", "test", "manual", "300.0.0.1/24", "", "", UUID)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(calls, [])


if __name__ == "__main__":
    unittest.main()
