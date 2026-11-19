"""按 Git 中的清单打包或安装固定版本的游戏素材。"""
from __future__ import annotations

import argparse
import hashlib
from http.client import IncompleteRead
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
from tempfile import TemporaryDirectory
from urllib.parse import urlsplit
from urllib.request import urlopen
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

SHA256 = re.compile(r"[0-9a-f]{64}")
DESKTOP_ICONS = {
    PurePosixPath(f"hd2d-mvp/desktop/build/icon.{ext}") for ext in ("ico", "icns", "png")
}
MEDIA = {".webp", ".png", ".jpg", ".glb", ".bin", ".mp3", ".m4a"}


def asset_path(name: str) -> PurePosixPath:
    path = PurePosixPath(name)
    if (path.as_posix() != name or "\\" in name or ".." in path.parts or path.is_absolute()
            or not (path in DESKTOP_ICONS or (path.parts[:2] == ("hd2d-mvp", "assets") and path.suffix in MEDIA))):
        raise ValueError(f"素材路径无效：{name}")
    return path


def manifest(root: Path) -> dict[str, str]:
    entries = {}
    for row in (root / "ASSETS.sha256").read_text(encoding="utf-8").splitlines():
        digest, name = row.split("  ", 1)
        asset_path(name)
        if not SHA256.fullmatch(digest) or name in entries:
            raise ValueError(f"素材校验清单条目无效或重复：{name}")
        entries[name] = digest
    if not entries:
        raise ValueError("素材校验清单为空")
    return entries


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while block := stream.read(1024 * 1024):
            digest.update(block)
    return digest.hexdigest()


def within(root: Path, name: str) -> Path:
    path = root.joinpath(*asset_path(name).parts)
    if path.resolve() != path:
        raise ValueError(f"素材目录或文件含符号链接：{name}")
    return path


def pack(root: Path, output: Path) -> None:
    entries = manifest(root)
    with ZipFile(output, "x", ZIP_DEFLATED, compresslevel=3) as bundle:
        for name, digest in sorted(entries.items()):
            path = within(root, name)
            if sha256(path) != digest:
                raise ValueError(f"待打包素材的 SHA-256 不匹配：{name}")
            entry = ZipInfo(name)
            entry.create_system = 3
            entry.external_attr = (stat.S_IFREG | 0o644) << 16
            entry.compress_type = ZIP_DEFLATED
            with path.open("rb") as source, bundle.open(entry, "w") as dest:
                shutil.copyfileobj(source, dest)
    print(f"{sha256(output)}  {output.name} ({output.stat().st_size} bytes)")


def download(url: str, output: Path, size: int) -> None:
    if urlsplit(url).scheme != "https":
        raise ValueError("素材包地址必须使用 HTTPS")
    with urlopen(url, timeout=60) as response, output.open("wb") as stream:
        if urlsplit(response.url).scheme != "https":
            raise ValueError("素材包重定向必须使用 HTTPS")
        remaining = size
        try:
            while block := response.read(min(1024 * 1024, remaining + 1)):
                remaining -= len(block)
                if remaining < 0:
                    raise ValueError("素材包大于锁定大小")
                stream.write(block)
        except IncompleteRead as error:
            raise ValueError("素材包下载不完整") from error
        if remaining:
            raise ValueError("素材包下载不完整")


def unpack(archive: Path, staging: Path, entries: dict[str, str]) -> None:
    with ZipFile(archive) as bundle:
        files = bundle.infolist()
        if len(files) != len(entries) or {file.filename for file in files} != entries.keys():
            raise ValueError("素材包的文件清单不匹配或包含重复路径")
        for file in files:
            if stat.S_IFMT(file.external_attr >> 16) != stat.S_IFREG:
                raise ValueError(f"素材包条目不是普通文件：{file.filename}")
            dest = within(staging, file.filename)
            dest.parent.mkdir(parents=True, exist_ok=True)
            with bundle.open(file) as source, dest.open("xb") as output:
                shutil.copyfileobj(source, output)
            if sha256(dest) != entries[file.filename]:
                raise ValueError(f"素材文件的 SHA-256 不匹配：{file.filename}")


def install(root: Path, archive: Path | None) -> None:
    entries = manifest(root)
    lock = json.loads((root / "ASSETS.lock.json").read_text(encoding="utf-8"))
    digest, size = lock["sha256"], lock["size"]
    if not isinstance(digest, str) or not SHA256.fullmatch(digest) or type(size) is not int or size < 1:
        raise ValueError("素材包的锁定 SHA-256 或大小无效")
    targets = {name: within(root, name) for name in entries}
    if archive is None and all(path.is_file() and sha256(path) == entries[name] for name, path in targets.items()):
        print(f"素材已通过校验，共 {len(entries)} 个文件")
        return
    with TemporaryDirectory(prefix=".asset-pack-", dir=root) as temp:
        staging = Path(temp).resolve()
        if archive is None:
            archive = staging / "bundle.zip"
            print(f"下载素材包 {lock['url']}", flush=True)
            download(lock["url"], archive, size)
        if archive.stat().st_size != size or sha256(archive) != digest:
            raise ValueError("素材包的大小或 SHA-256 与锁定值不匹配")
        unpack(archive, staging, entries)
        for name, target in targets.items():
            target.parent.mkdir(parents=True, exist_ok=True)
            os.replace(staging / name, target)
    print(f"已校验并安装 {len(entries)} 个素材文件")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[2])
    commands = parser.add_subparsers(dest="action", required=True)
    commands.add_parser("pack").add_argument("output", type=Path)
    commands.add_parser("install").add_argument("--archive", type=Path)
    args = parser.parse_args()
    try:
        if args.action == "pack":
            pack(args.root.resolve(), args.output)
        else:
            install(args.root.resolve(), args.archive)
    except (KeyError, ValueError, OSError) as error:
        parser.exit(1, f"素材处理失败：{error}\n")


if __name__ == "__main__":
    main()
