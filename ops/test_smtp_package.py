"""Package contract on disposable fixtures, never the hosting account."""
import io
import json
from pathlib import Path
import shutil
import tarfile
import tempfile
import unittest
import smtp_package as package

class PackageTest(unittest.TestCase):
    def test_exact_scope_hashes_reproducibility_and_rejection(self):
        with tempfile.TemporaryDirectory(prefix='smtp-package-') as tmp:
            root=Path(tmp).resolve()
            shutil.copytree(package.ROOT/'dist',root/'dist')
            shutil.copytree(package.ROOT/'.release-output/smtp-runtime',root/'.release-output/smtp-runtime')
            shutil.copy(package.ROOT/'composer.lock',root/'composer.lock')
            payload,manifest=package.bundle(root,'a'*40)
            self.assertEqual(payload,package.bundle(root,'a'*40)[0])
            with tarfile.open(fileobj=io.BytesIO(payload),mode='r:gz') as archive:
                self.assertEqual(len(archive.getmembers()),10)
                self.assertEqual(set(archive.getnames()),set(manifest['files'])|{'manifest.json'})
                self.assertFalse(any('config.php' in n or 'vendor/' in n for n in archive.getnames()))
                for member in archive.getmembers():
                    self.assertTrue(member.isfile())
                    if member.name!='manifest.json':
                        self.assertEqual(package.sha(archive.extractfile(member).read()),manifest['files'][member.name])
            runtime=next((root/'.release-output/smtp-runtime').iterdir())
            (runtime/'src/SMTP.php').write_text('tampered')
            with self.assertRaises(RuntimeError):package.bundle(root,'a'*40)
            (root/'dist/api/lead-core.php').unlink()
            (root/'dist/api/lead-core.php').symlink_to(package.ROOT/'dist/api/lead-core.php')
            with self.assertRaises(RuntimeError):package.bundle(root,'a'*40)

if __name__=='__main__':unittest.main()
