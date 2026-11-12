"""Check hotspot scripts with fake networking and privilege commands."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).parents[1]
UUID = "11111111-2222-3333-4444-555555555555"


class HotspotTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.model = json.loads(subprocess.check_output(["node", "-e", "console.log(JSON.stringify(require('./Model.js')))"], cwd=ROOT, text=True))

    def execute(self, action="save", identity=UUID, kind="802-11-wireless", mode="ap", fail="", script="hotspotApplyScript"):
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            log = directory / "calls"
            (directory / "nmcli").write_text('''#!/usr/bin/env python3
import json,os,sys
args=sys.argv[1:]
with open(os.environ['NM_LOG'],'a') as stream: stream.write(json.dumps(args)+'\\n')
u='11111111-2222-3333-4444-555555555555'
if 'id' in args: sys.exit('name lookup must not be used')
if '-g' in args:
    field=args[args.index('-g')+1]
    values={'connection.type':os.environ['NM_KIND'], '802-11-wireless.mode':os.environ['NM_MODE'],
            'connection.id':'Duplicate name', '802-11-wireless.ssid':'Test hotspot',
            '802-11-wireless-security.psk':'', '802-11-wireless.band':'bg'}
    print(values.get(field,''))
elif 'modify' in args: sys.exit(1 if os.environ['NM_FAIL']=='modify' else 0)
elif 'edit' in args: sys.stdin.read()
elif 'add' in args: pass
elif 'down' in args: sys.exit(1 if os.environ['NM_FAIL']=='down' else 0)
elif '-f' in args:
    field=args[args.index('-f')+1]
    if field=='DEVICE,TYPE': print('wlan0:wifi')
    elif field=='UUID,TYPE': print(u+':802-11-wireless')
    elif field=='UUID,ACTIVE': print(u+':yes')
else: sys.exit('unexpected nmcli command')
''')
            (directory / "nmcli").chmod(0o755)
            for name in ["ip", "iw", "pkexec"]:
                (directory / name).write_text('#!/bin/sh\nexit 1\n')
                (directory / name).chmod(0o755)
            env = {**os.environ, "PATH": str(directory) + os.pathsep + os.environ["PATH"], "NM_LOG": str(log),
                   "NM_KIND": kind, "NM_MODE": mode, "NM_FAIL": fail}
            result = subprocess.run(["bash", "-c", self.model[script], "test-hotspot", action, "Duplicate name", "Test hotspot", "bg", identity],
                                    input="test-passphrase\n", text=True, capture_output=True, env=env, timeout=5)
            calls = [json.loads(line) for line in log.read_text().splitlines()] if log.exists() else []
            return result, calls

    def test_duplicate_names_use_the_selected_uuid(self):
        result, calls = self.execute()
        self.assertEqual(result.returncode, 0, result.stderr)
        changes = [call for call in calls if "modify" in call or "edit" in call]
        self.assertEqual(len(changes), 2)
        self.assertTrue(all(UUID in call and "uuid" in call for call in changes))
        self.assertNotIn("test-passphrase", json.dumps(calls))

    def test_non_ap_profile_is_never_modified(self):
        result, calls = self.execute(mode="infrastructure")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any("modify" in call or "edit" in call for call in calls))

    def test_modification_failure_is_not_reported_as_success(self):
        result, _ = self.execute(fail="modify")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Failed to update", result.stderr)

    def test_stop_failure_is_not_reported_as_success(self):
        result, _ = self.execute(action="stop", fail="down")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Failed to stop", result.stderr)

    def test_missing_profile_creates_a_new_uuid_instead_of_reusing_a_name(self):
        result, calls = self.execute(identity="")
        self.assertEqual(result.returncode, 0, result.stderr)
        create = next(call for call in calls if "add" in call)
        self.assertIn("connection.uuid", create)

    def test_query_returns_the_same_uuid_for_every_profile_read(self):
        result, calls = self.execute(script="hotspotQueryScript")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["uuid"], UUID)
        reads = [call for call in calls if "-g" in call]
        self.assertTrue(reads)
        self.assertTrue(all(UUID in call for call in reads))


if __name__ == "__main__":
    unittest.main()
