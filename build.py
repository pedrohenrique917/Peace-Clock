#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Build a minimal Shell ZIP and a separate source/development ZIP."""

from pathlib import Path
import json
import re
import zipfile

root = Path(__file__).resolve().parent
output = root / "dist"
output.mkdir(exist_ok=True)
metadata = json.loads((root / "metadata.json").read_text())
assert metadata["name"] == "Peace Clock"
assert metadata["shell-version"] == ["50"]
assert "version" not in metadata
assert re.fullmatch(r"[A-Za-z0-9._-]+@[A-Za-z0-9._-]+", metadata["uuid"])

runtime = ("extension.js", "colors.js", "stylesheet.css", "metadata.json", "COPYING")
shell_zip = output / "peace-clock-teste.shell-extension.zip"
with zipfile.ZipFile(shell_zip, "w", zipfile.ZIP_DEFLATED) as archive:
    for filename in runtime:
        archive.write(root / filename, filename)
with zipfile.ZipFile(shell_zip) as archive:
    assert set(archive.namelist()) == set(runtime)
    assert archive.testzip() is None

source_zip = output / "peace-clock-fonte.zip"
with zipfile.ZipFile(source_zip, "w", zipfile.ZIP_DEFLATED) as archive:
    for path in sorted(root.rglob("*")):
        if not path.is_file() or any(part in {"dist", "__pycache__", "node_modules", ".git"}
                                     for part in path.relative_to(root).parts):
            continue
        archive.write(path, Path("peace-clock") / path.relative_to(root))
with zipfile.ZipFile(source_zip) as archive:
    assert archive.testzip() is None
    assert "peace-clock/install-local.py" in archive.namelist()
print(shell_zip)
print(source_zip)
