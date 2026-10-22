# SPDX-License-Identifier: GPL-3.0-or-later
"""Exercise the installer only inside temporary homes, including failed writes."""

from contextlib import redirect_stdout
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch
import zipfile


SPEC = importlib.util.spec_from_file_location(
    "peace_clock_installer", Path(__file__).resolve().parents[1] / "install-local.py")
INSTALLER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(INSTALLER)


class InstallTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.home = self.root / "home"
        self.source = self.root / "source"
        self.source.mkdir()
        self.uuid = "relogio-desktop@local"
        self.target = self.home / ".local/share/gnome-shell/extensions" / self.uuid
        for filename in INSTALLER.RUNTIME:
            (self.source / filename).write_text(f"new {filename}")
        (self.source / "metadata.json").write_text(json.dumps({"uuid": self.uuid}))
        self.home_patch = patch.object(Path, "home", return_value=self.home)
        self.home_patch.start()
        self.addCleanup(self.home_patch.stop)
        self.environment_patch = patch.dict(os.environ, {"XDG_DATA_HOME": "", "XDG_STATE_HOME": ""})
        self.environment_patch.start()
        self.addCleanup(self.environment_patch.stop)
        self.stdout_patch = redirect_stdout(io.StringIO())
        self.stdout_patch.__enter__()
        self.addCleanup(self.stdout_patch.__exit__, None, None, None)

    def old_install(self):
        self.target.mkdir(parents=True)
        for filename in INSTALLER.RUNTIME:
            (self.target / filename).write_text(f"old {filename}")
        (self.target / "custom.txt").write_text("user extra file")

    def assert_old_intact(self):
        for filename in INSTALLER.RUNTIME:
            self.assertEqual((self.target / filename).read_text(), f"old {filename}")
        self.assertEqual((self.target / "custom.txt").read_text(), "user extra file")

    def assert_no_staging(self):
        self.assertEqual(list(self.target.parent.glob(f".{self.uuid}-install-*")), [])

    def test_fresh_install(self):
        target, backup = INSTALLER.install(self.source)
        self.assertEqual(target, self.target)
        self.assertIsNone(backup)
        for filename in INSTALLER.RUNTIME:
            self.assertEqual((target / filename).read_bytes(), (self.source / filename).read_bytes())
        self.assert_no_staging()

    def test_update_preserves_extras_and_backs_up_original(self):
        self.old_install()
        target, backup = INSTALLER.install(self.source)
        self.assertEqual((target / "custom.txt").read_text(), "user extra file")
        with zipfile.ZipFile(backup) as archive:
            self.assertIsNone(archive.testzip())
            self.assertEqual(archive.read("extension.js"), b"old extension.js")
            self.assertEqual(archive.read("custom.txt"), b"user extra file")
        _, second_backup = INSTALLER.install(self.source)
        self.assertNotEqual(backup, second_backup)
        self.assertTrue(backup.is_file())
        self.assert_no_staging()

    def test_respects_xdg_directories(self):
        data, state = self.root / "data", self.root / "state"
        with patch.dict(os.environ, {"XDG_DATA_HOME": str(data), "XDG_STATE_HOME": str(state)}):
            target, _ = INSTALLER.install(self.source)
            _, backup = INSTALLER.install(self.source)
        self.assertEqual(target, data / "gnome-shell/extensions" / self.uuid)
        self.assertEqual(backup.parent, state / "peace-clock")
        self.assertFalse(self.target.exists())

    def test_ignores_relative_xdg_directories(self):
        with patch.dict(os.environ, {"XDG_DATA_HOME": "relative", "XDG_STATE_HOME": "relative"}):
            target, _ = INSTALLER.install(self.source)
            _, backup = INSTALLER.install(self.source)
        self.assertEqual(target, self.target)
        self.assertEqual(backup.parent, self.home / ".local/state/peace-clock")

    def test_rejects_target_directory_link(self):
        outside = self.root / "outside"
        outside.mkdir()
        self.target.parent.mkdir(parents=True)
        self.target.symlink_to(outside, target_is_directory=True)
        with self.assertRaises(ValueError):
            INSTALLER.install(self.source)
        self.assertEqual(list(outside.iterdir()), [])

    def test_rejects_runtime_link_without_overwriting_external_file(self):
        self.old_install()
        outside = self.root / "outside.js"
        outside.write_text("unrelated user data")
        (self.target / "extension.js").unlink()
        (self.target / "extension.js").symlink_to(outside)
        with self.assertRaises(ValueError):
            INSTALLER.install(self.source)
        self.assertEqual(outside.read_text(), "unrelated user data")
        self.assert_no_staging()

    def test_rejects_source_link_and_missing_source(self):
        outside = self.root / "outside.js"
        outside.write_text("unrelated source")
        (self.source / "extension.js").unlink()
        with self.assertRaises(ValueError):
            INSTALLER.install(self.source)
        (self.source / "extension.js").symlink_to(outside)
        with self.assertRaises(ValueError):
            INSTALLER.install(self.source)
        self.assertFalse(self.target.exists())

    def test_rejects_invalid_uuid(self):
        (self.source / "metadata.json").write_text(json.dumps({"uuid": "../../outside"}))
        with self.assertRaises(ValueError):
            INSTALLER.install(self.source)
        self.assertFalse(self.target.exists())

    def test_partial_stage_write_failure_keeps_original(self):
        self.old_install()
        copy = shutil.copy2

        def fail_metadata(source, destination, **kwargs):
            if Path(source) == self.source / "metadata.json":
                raise OSError("simulated partial copy failure")
            return copy(source, destination, **kwargs)

        with patch.object(shutil, "copy2", side_effect=fail_metadata):
            with self.assertRaises(OSError):
                INSTALLER.install(self.source)
        self.assert_old_intact()
        self.assert_no_staging()

    def test_backup_write_failure_keeps_original(self):
        self.old_install()
        with patch.object(zipfile.ZipFile, "write", side_effect=OSError("simulated full backup disk")):
            with self.assertRaises(OSError):
                INSTALLER.install(self.source)
        self.assert_old_intact()
        self.assertEqual(list((self.home / ".local/state/peace-clock").glob("*.zip")), [])
        self.assert_no_staging()

    def test_final_rename_failure_restores_original(self):
        self.old_install()
        rename = Path.rename

        def fail_final(path, destination):
            if path.name == "new" and Path(destination) == self.target:
                raise OSError("simulated final rename failure")
            return rename(path, destination)

        with patch.object(Path, "rename", new=fail_final):
            with self.assertRaises(OSError):
                INSTALLER.install(self.source)
        self.assert_old_intact()
        self.assert_no_staging()

    def test_failed_recovery_preserves_original_in_recovery_directory(self):
        self.old_install()
        rename = Path.rename

        def fail_final_and_recovery(path, destination):
            if path.name in {"new", "previous"} and Path(destination) == self.target:
                raise OSError("simulated rename and recovery failure")
            return rename(path, destination)

        with patch.object(Path, "rename", new=fail_final_and_recovery):
            with self.assertRaisesRegex(RuntimeError, "versao anterior foi preservada"):
                INSTALLER.install(self.source)
        saved = list(self.target.parent.glob(f".{self.uuid}-install-*/previous"))
        self.assertEqual(len(saved), 1)
        self.assertEqual((saved[0] / "extension.js").read_text(), "old extension.js")
        backups = list((self.home / ".local/state/peace-clock").glob("*.zip"))
        self.assertEqual(len(backups), 1)
        with zipfile.ZipFile(backups[0]) as archive:
            self.assertEqual(archive.read("extension.js"), b"old extension.js")


if __name__ == "__main__":
    unittest.main()
