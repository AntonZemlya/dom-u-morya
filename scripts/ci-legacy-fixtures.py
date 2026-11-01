"""Synthetic local inputs for archived release regression tests; never fetch receipts."""
import sys,json,hashlib,tempfile,subprocess,shutil
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'ops'))
import smtp_package,form_release
root=smtp_package.ROOT
# The archived GO-A wrapper predates FORM-004 recipient/consent contracts.
# Build its disposable candidate from that exact historical source, never current API.
with tempfile.TemporaryDirectory(prefix='dom-legacy-candidate-') as temporary:
 fixture=Path(temporary).resolve();(fixture/'dist/api').mkdir(parents=True)
 for n in smtp_package.PUBLIC:
  (fixture/'dist'/n).write_bytes(subprocess.check_output(['git','show','52a71bd0c22f4899469d706df9038d8da665bdf9:'+n],cwd=root))
 shutil.copytree(root/'.release-output/smtp-runtime',fixture/'.release-output/smtp-runtime')
 shutil.copy(root/'composer.lock',fixture/'composer.lock')
 raw,_=smtp_package.bundle(fixture,'a'*40)
p=root/'.release-output/form-002/smtp-update.tar.gz';p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(raw)
# Old tests replace this with their own disposable server snapshot before applying.
baseline={'public':{str(p.relative_to(root/'dist')):{'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in (root/'dist').rglob('*') if p.is_file()}}
for n in form_release.PUBLIC:baseline['public'][n]['sha256']='0'*64
p=form_release.BASELINE;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(baseline))
print('PASS synthetic archived-test fixtures; no production receipts used')
