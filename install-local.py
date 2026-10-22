#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Install a staged local build, with a backup and recovery on replacement failure."""

from datetime import datetime
from pathlib import Path
import json
import os
import re
import shutil
import tempfile
import zipfile


RUNTIME = ("extension.js", "colors.js", "stylesheet.css", "metadata.json", "COPYING")


def xdg_directory(variable, fallback):
    """The XDG specification ignores empty and relative directory settings."""
    value = os.environ.get(variable, "")
    return Path(value) if value and Path(value).is_absolute() else fallback


def check_existing_tree(target):
    # Do not copy through links into a development checkout or unrelated files.
    if target.is_symlink():
        raise ValueError(f"A pasta da extensao e um link simbolico: {target}")
    if target.exists() and not target.is_dir():
        raise ValueError(f"O destino nao e uma pasta: {target}")
    for path in target.rglob("*") if target.exists() else ():
        if path.is_symlink():
            raise ValueError(f"A instalacao existente contem um link simbolico: {path}")
        if not path.is_file() and not path.is_dir():
            raise ValueError(f"Arquivo especial na instalacao existente: {path}")


def make_backup(target, backup_directory):
    backup_directory.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    backup = backup_directory / f"backup-{stamp}.zip"
    # Exclusive creation preserves even a preexisting backup with this exact name.
    with backup.open("xb") as output:
        try:
            with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
                for path in sorted(target.rglob("*")):
                    if path.is_file():
                        archive.write(path, path.relative_to(target))
        except BaseException:
            backup.unlink(missing_ok=True)
            raise
    return backup


def install(source=None):
    source = Path(source or Path(__file__).parent).resolve()
    for filename in RUNTIME:
        path = source / filename
        if path.is_symlink() or not path.is_file():
            raise ValueError(f"Arquivo ausente ou link simbolico: {filename}. Extraia o ZIP inteiro primeiro.")

    metadata = json.loads((source / "metadata.json").read_text(encoding="utf-8"))
    uuid = metadata.get("uuid") if isinstance(metadata, dict) else None
    if not isinstance(uuid, str) or not re.fullmatch(r"[A-Za-z0-9._-]+@[A-Za-z0-9._-]+", uuid):
        raise ValueError("UUID invalido; nada foi instalado.")

    data = xdg_directory("XDG_DATA_HOME", Path.home() / ".local/share")
    state = xdg_directory("XDG_STATE_HOME", Path.home() / ".local/state")
    target = data / "gnome-shell/extensions" / uuid
    check_existing_tree(target)
    if source == target.resolve():
        raise ValueError("Execute o instalador na pasta extraida, fora da pasta da extensao.")

    target.parent.mkdir(parents=True, exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix=f".{uuid}-install-", dir=target.parent))
    stage = work / "new"
    previous = work / "previous"
    keep_recovery = False
    installed = False
    backup = None
    try:
        # Stage on the same filesystem so only directory renames change the live tree.
        # Existing unrelated files are retained, as in the original local installer.
        if target.exists():
            shutil.copytree(target, stage, symlinks=True)
        else:
            stage.mkdir()
        for filename in RUNTIME:
            shutil.copy2(source / filename, stage / filename)

        if target.exists():
            backup = make_backup(target, state / "peace-clock")
            print(f"Backup salvo em: {backup}")
            target.rename(previous)
        try:
            stage.rename(target)
            installed = True
        except BaseException as install_error:
            if previous.exists():
                try:
                    previous.rename(target)
                except BaseException as recovery_error:
                    keep_recovery = True
                    raise RuntimeError(
                        "Falha ao instalar e restaurar automaticamente. "
                        f"A versao anterior foi preservada em: {previous}. "
                        f"Backup ZIP: {backup}. Erro de restauracao: {recovery_error}"
                    ) from install_error
            raise
    finally:
        # An interruption between the two renames must also retain the old tree.
        if previous.exists() and not installed:
            keep_recovery = True
        if not keep_recovery:
            try:
                shutil.rmtree(work)
            except OSError as error:
                print(f"Nao foi possivel remover a pasta temporaria {work}: {error}")

    print(f"Peace Clock instalado em: {target}")
    print("Saia da sessao e entre novamente para carregar a nova versao.")
    print(f"Se necessario, ative com: gnome-extensions enable {uuid}")
    return target, backup


if __name__ == "__main__":
    try:
        install()
    except (OSError, ValueError, RuntimeError) as error:
        raise SystemExit(str(error)) from error
