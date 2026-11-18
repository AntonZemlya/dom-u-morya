"""Exercise the private notification command against the loopback TLS mail sink."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parent.parent
PHP = os.environ.get('PHP84_BIN', 'php')
MAIL_TO = 'info@anyara.ru'
CONTROL = 'azm1982@yandex.ru'

def check(sink, base):
    for _ in range(100):
        if (sink/'smtp-port').is_file():
            break
        time.sleep(.03)
    else:
        raise AssertionError('Local SMTP fixture did not start')
    doc = base/'domains'/'zhk-dom-umorya.ru'
    doc.mkdir(parents=True)
    shutil.copytree(ROOT/'api', doc/'api')
    private = base/'.dom-u-morya'
    private.mkdir(mode=0o700)
    identities = list((ROOT/'.release-output/smtp-runtime').glob('*/manifest.json'))
    identity = next(file.parent for file in identities if file.parent.name in (ROOT/'api/smtp-manifest.php').read_text())
    runtime = private/'smtp-runtime'/identity.name
    shutil.copytree(identity, runtime)
    config = {
        'SMTP_HOST':'127.0.0.1','SMTP_PORT':int((sink/'smtp-port').read_text()),'SMTP_SECURITY':'starttls',
        'SMTP_USERNAME':'fixture-user','SMTP_PASSWORD':'fixture-password','SMTP_TEST_CA':str(sink/'server.crt'),
        'SMTP_RUNTIME':str(runtime),'MAIL_FROM':'sales@zhk-dom-umorya.ru','MAIL_TO':MAIL_TO,'MAIL_BCC':CONTROL,
        'OWNER_CONFIRMED_TO':MAIL_TO,'CONTROL_MAILBOX_VERIFIED':CONTROL,'LEGAL_MAIL_TO':MAIL_TO,
        'LEGAL_MAIL_BCC':CONTROL,'LEGAL_APPROVED':'2026-10-31','FORM_ENABLED':True,'SMTP_TRANSPORT_VERIFIED':True,
        'ACCEPT_UNTESTED_MAIN':True,
    }
    cfg_path = private/'config.php'
    cfg_path.write_text('<?php return json_decode('+json.dumps(json.dumps(config))+',true);')
    cfg_path.chmod(0o600)
    event = {'id':'catalog-'+'0'*32,'subject':'Catalog sync fixture','body':'Technical notification'}
    args = [PHP, '-n', str(ROOT/'scripts/catalog-notify.php'), str(doc)]
    env = dict(os.environ, LEAD_SMTP_TEST='1', LEAD_CONFIG=str(cfg_path))
    data = json.dumps(event).encode()
    subprocess.run(args, input=data, env=env, check=True, timeout=15)
    received = json.loads((sink/'fake-mail.json').read_text())
    assert len(received) == 1 and received[0]['recipients'] == ['<'+CONTROL+'>']
    assert received[0]['messageId'] == '<'+event['id']+'@zhk-dom-umorya.ru>'
    (sink/'mode').write_text('data_fail')
    assert subprocess.run(args, input=data, env=env, timeout=15).returncode == 3
    assert len(json.loads((sink/'fake-mail.json').read_text())) == 1

def main():
    with tempfile.TemporaryDirectory(prefix='dom-catalog-mail-') as temporary:
        base = Path(temporary).resolve()
        sink = base/'sink'
        sink.mkdir()
        (sink/'mode').write_text('success')
        subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=127.0.0.1',
                        '-addext','subjectAltName=IP:127.0.0.1','-keyout',str(sink/'server.key'),
                        '-out',str(sink/'server.crt')], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1')
        proc = subprocess.Popen(['python3',str(ROOT/'tests/smtp-fixture.py'),str(sink)], env=env,
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            check(sink, base)
        finally:
            proc.terminate()
            proc.wait(timeout=5)
    print('PASS notification command: control-only envelope and stable Message-ID; SMTP DATA failure remains retryable')

if __name__ == '__main__':
    main()
