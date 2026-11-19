"""素材包发布格式和安装失败边界。"""
import json
from pathlib import Path
import stat
import sys
import tempfile
import unittest
from zipfile import ZipFile, ZipInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from assets_pack import install, pack, sha256


class AssetsPackTest(unittest.TestCase):
    name = "hd2d-mvp/assets/demo.webp"
    data = b"locked resource"

    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name).resolve()
        self.asset = self.root / self.name
        self.asset.parent.mkdir(parents=True)
        self.asset.write_bytes(self.data)
        self.sums = self.root / "ASSETS.sha256"
        self.sums.write_text(f"{sha256(self.asset)}  {self.name}\n")
        self.archive = self.root / "bundle.zip"

    def lock(self):
        (self.root / "ASSETS.lock.json").write_text(json.dumps({
            "url": "https://example.invalid/bundle.zip",
            "sha256": sha256(self.archive),
            "size": self.archive.stat().st_size,
        }))

    def test_round_trip_keeps_git_owned_metadata(self):
        pack(self.root, self.archive)
        self.lock()
        other = self.root / "same.zip"
        pack(self.root, other)
        self.assertEqual(sha256(other), sha256(self.archive))
        self.asset.unlink()
        metadata = self.asset.with_name("manifest.json")
        metadata.write_text("{}")
        install(self.root, self.archive)
        self.assertEqual(self.asset.read_bytes(), self.data)
        self.assertEqual(metadata.read_text(), "{}")
        install(self.root, None)  # 现有文件正确时无需请求锁定地址。

    def test_archive_sha_mismatch_does_not_replace_existing_files(self):
        pack(self.root, self.archive)
        self.lock()
        self.asset.write_bytes(b"existing")
        with self.archive.open("r+b") as stream:
            stream.write(b"!")
        with self.assertRaisesRegex(ValueError, "SHA-256"):
            install(self.root, self.archive)
        self.assertEqual(self.asset.read_bytes(), b"existing")

    def test_per_file_sha_and_member_type_are_checked_before_install(self):
        for content, file_type in [(b"unexpected", stat.S_IFREG), (self.data, stat.S_IFLNK)]:
            with self.subTest(file_type=file_type):
                entry = ZipInfo(self.name)
                entry.create_system = 3
                entry.external_attr = (file_type | 0o644) << 16
                with ZipFile(self.archive, "w") as bundle:
                    bundle.writestr(entry, content)
                self.lock()
                self.asset.write_bytes(b"existing")
                with self.assertRaisesRegex(ValueError, "SHA-256|普通文件"):
                    install(self.root, self.archive)
                self.assertEqual(self.asset.read_bytes(), b"existing")

    def test_paths_outside_manifest_are_rejected(self):
        with ZipFile(self.archive, "w") as bundle:
            bundle.writestr("../outside.webp", self.data)
        self.lock()
        with self.assertRaisesRegex(ValueError, "文件清单"):
            install(self.root, self.archive)
        self.assertEqual(self.asset.read_bytes(), self.data)

    def test_local_symlink_is_rejected(self):
        pack(self.root, self.archive)
        self.lock()
        self.asset.unlink()
        protected = self.root / "protected.webp"
        protected.write_bytes(b"protected")
        self.asset.symlink_to(protected)
        with self.assertRaisesRegex(ValueError, "符号链接"):
            install(self.root, self.archive)
        self.assertEqual(protected.read_bytes(), b"protected")


if __name__ == "__main__":
    unittest.main()
