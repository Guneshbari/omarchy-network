import importlib.util
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("wireguard", Path(__file__).parents[1] / "WireGuard.py")
wg = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wg)
UUID = "01234567-89ab-cdef-0123-456789abcdef"


class WireGuardTests(unittest.TestCase):
    def query(self, files=(), loaded=(), profiles="", configs=(), failure=None):
        def execute(args, timeout=5):
            if args[0] == "nmcli":
                if failure:
                    raise wg.QueryError(failure)
                return profiles
            if args[1] == "list-unit-files":
                return json.dumps(files)
            if args[1] == "list-units":
                return json.dumps(loaded)
            raise AssertionError(args)
        with patch.object(wg, "run", side_effect=execute), \
             patch.object(wg.Path, "glob", return_value=[Path(c) for c in configs]), \
             patch.object(wg.Path, "exists", return_value=False):
            return wg.discover()

    def test_nmcli_escaping(self):
        self.assertEqual(wg.split_nmcli(r"a:office\: west\\vpn:wireguard::"),
                         ["a", "office: west\\vpn", "wireguard", "", ""])

    def test_configured_active_and_inactive_nm_profiles(self):
        output = f"{UUID}:<img src='test'>:wireguard:wg0:activated\n"
        output += "11111111-2222-3333-4444-555555555555:Offline:wireguard::\n"
        output += "invalid:Ignore:wireguard:wg1:activated\n"
        output += f"{UUID}:Wi-Fi:802-11-wireless:wlan0:activated\n"
        rows = self.query(profiles=output)["connections"]
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["name"], "<img src='test'>")
        self.assertTrue(rows[0]["active"])
        self.assertFalse(rows[1]["active"])

    def test_quick_enabled_loaded_and_config_only(self):
        rows = self.query(files=[{"unit_file": "wg-quick@wg0.service"}, {"unit_file": "wg-quick@.service"}],
                          loaded=[{"unit": "wg-quick@wg0.service", "load": "loaded", "active": "active"}],
                          configs=["/etc/wireguard/wg-office.conf", "/etc/wireguard/wg0.conf"])["connections"]
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["name"], "wg-office")
        self.assertFalse(rows[0]["active"])
        self.assertTrue(rows[1]["active"])

    def test_external_nm_interface_is_not_duplicated(self):
        result = self.query(loaded=[{"unit": "wg-quick@wg0.service", "load": "loaded", "active": "active"}],
                            profiles=f"{UUID}:wg0:wireguard:wg0:activated\n")
        self.assertEqual(len(result["connections"]), 1)
        self.assertEqual(result["connections"][0]["backend"], "wg-quick")

    def test_inactive_quick_does_not_hide_active_nm_profile(self):
        result = self.query(files=[{"unit_file": "wg-quick@wg0.service"}],
                            profiles=f"{UUID}:Office:wireguard:wg0:activated\n")
        self.assertEqual(len(result["connections"]), 2)

    def test_missing_nm_does_not_hide_quick(self):
        result = self.query(files=[{"unit_file": "wg-quick@wg0.service"}], failure="nmcli unavailable")
        self.assertEqual(len(result["connections"]), 1)
        self.assertIn("nmcli unavailable", result["warnings"][0])

    def test_missing_systemd_does_not_hide_nm(self):
        def execute(args, timeout=5):
            if args[0] == "systemctl":
                raise wg.QueryError("systemctl unavailable")
            if args[0] == "nmcli":
                return f"{UUID}:Office:wireguard::\n"
            raise AssertionError(args)
        with patch.object(wg, "run", side_effect=execute), patch.object(wg.Path, "glob", return_value=[]), \
             patch.object(wg.Path, "exists", return_value=False):
            result = wg.discover()
        self.assertEqual(len(result["connections"]), 1)
        self.assertTrue(result["warnings"])

    def test_service_instances_preserve_wireguard_interface_names(self):
        for name in ["wg0", "wg-office", ".hidden", "wg+one", "wg=two", "wg_under.score"]:
            with self.subTest(name=name):
                expected = "wg-quick@" + name + ".service"
                self.assertEqual(wg.quick_unit(name), expected)
                self.assertEqual(wg.quick_interface(expected), name)
        for unit in [None, "sshd.service", "wg-quick@bad/name.service", "wg-quick@.service"]:
            self.assertEqual(wg.quick_interface(unit), "")

    def test_discovery_command_count_does_not_grow_with_tunnels(self):
        with patch.object(wg, "run", return_value="[]") as execute, \
             patch.object(wg.Path, "glob", return_value=[Path(f"/etc/wireguard/wg{i}.conf") for i in range(40)]), \
             patch.object(wg.Path, "exists", return_value=False):
            self.assertEqual(len(wg.discover()["connections"]), 40)
        self.assertEqual(execute.call_count, 3)

    def test_loaded_services_survive_unit_file_query_failure(self):
        def execute(args, timeout=5):
            if args[1] == "list-unit-files":
                raise wg.QueryError("failed unit file listing")
            if args[1] == "list-units":
                return json.dumps([{"unit": "wg-quick@wg0.service", "load": "loaded", "active": "active"}])
            return ""
        with patch.object(wg, "run", side_effect=execute), patch.object(wg.Path, "glob", return_value=[]), \
             patch.object(wg.Path, "exists", return_value=False):
            result = wg.discover()
        self.assertEqual(len(result["connections"]), 1)
        self.assertTrue(result["warnings"])

    def test_private_configs_warn_without_escalating(self):
        with patch.object(wg, "run", return_value="[]"), patch.object(wg.Path, "glob", return_value=[]), \
             patch.object(wg.Path, "exists", return_value=True), patch.object(wg.os, "access", return_value=False):
            result = wg.discover()
        self.assertIn("private", result["warnings"][0])

    def test_actions_use_exact_identity_and_argv(self):
        for backend, identity, expected in [
            ("NetworkManager", UUID, ["nmcli", "--wait", "30", "connection", "up", "uuid", UUID]),
            ("wg-quick", "wg-quick@wg0.service", ["systemctl", "--no-ask-password", "start", "wg-quick@wg0.service"]),
        ]:
            with self.subTest(backend=backend), \
                 patch.object(wg, "discover", return_value={"connections": [{"backend": backend, "id": identity}]}), \
                 patch.object(wg, "run") as execute:
                self.assertEqual(wg.change(backend, identity, "connect"), {"ok": True})
                self.assertEqual(execute.call_args.args[0], expected)

    def test_disconnect_and_authorization_failure(self):
        with patch.object(wg, "discover", return_value={"connections": [{"backend": "NetworkManager", "id": UUID}]}), \
             patch.object(wg, "run", side_effect=wg.QueryError("Not authorized")) as execute:
            with self.assertRaisesRegex(wg.QueryError, "Not authorized"):
                wg.change("NetworkManager", UUID, "disconnect")
            self.assertIn("down", execute.call_args.args[0])

    def test_arbitrary_services_and_stale_connections_rejected(self):
        with patch.object(wg, "discover", return_value={"connections": []}), patch.object(wg, "run") as execute:
            for identity in ("sshd.service", "wg-quick@wg0.service; touch /tmp/unwanted", UUID):
                with self.assertRaises(wg.QueryError):
                    wg.change("wg-quick", identity, "connect")
            execute.assert_not_called()

    def test_timeout_is_bounded(self):
        with patch.object(wg.subprocess, "run", side_effect=subprocess.TimeoutExpired("nmcli", 5)):
            with self.assertRaisesRegex(wg.QueryError, "timed out"):
                wg.run(["nmcli", "connection", "show"])

    def test_ui_renders_untrusted_data_as_plain_text(self):
        qml = (Path(__file__).parents[1] / "WireGuardTab.qml").read_text()
        self.assertEqual(qml.count("textFormat: Text.PlainText"), qml.count("Text {"))
        self.assertNotIn("tooltipText:", qml)


if __name__ == "__main__":
    unittest.main()
