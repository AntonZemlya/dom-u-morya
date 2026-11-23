"""Contract tests against the production PHP receiver and a loopback TLS SMTP sink."""

import json
import os
import re
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PHP = os.environ.get("PHP84_BIN", "php")
RUNTIME = Path(os.environ.get("RPM_SMTP_RUNTIME_ROOT", ROOT / ".release-output/smtp-runtime")).resolve()
SCRIPT = ROOT / "scripts/rpm-mail.php"


def wire(doc):
    return json.dumps(doc, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode() + b"\n"


class MailContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(cls.enterClassContext(tempfile.TemporaryDirectory())).resolve()
        version = subprocess.check_output([PHP, "-r", "echo PHP_VERSION;"], text=True)
        if not version.startswith("8.4."):
            raise RuntimeError("Mail contract requires PHP 8.4")
        manifest = subprocess.check_output(
            [PHP, "-r", "echo (require 'api/smtp-manifest.php')['identity'];"], cwd=ROOT, text=True)
        cls.runtime = RUNTIME / manifest
        cls.smtp = cls.tmp / "smtp"
        cls.smtp.mkdir()
        cls.doc = cls.tmp / "domains" / "zhk-dom-umorya.ru"
        cls.doc.mkdir(parents=True)
        cls.mode = cls.smtp / "mode"
        cls.mode.write_text("accept")
        subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
                        "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1",
                        "-keyout", str(cls.smtp / "server.key"), "-out", str(cls.smtp / "server.crt")],
                       check=True, capture_output=True, timeout=15)
        server = subprocess.Popen([sys.executable, str(ROOT / "tests/smtp-fixture.py"), str(cls.smtp)],
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        cls.addClassCleanup(server.wait, 5)
        cls.addClassCleanup(server.terminate)
        for _ in range(100):
            if (cls.smtp / "smtp-port").exists():
                cls.port = (cls.smtp / "smtp-port").read_text()
                break
            time.sleep(.05)
        else:
            raise RuntimeError("Loopback SMTP sink did not start")

    def setUp(self):
        self.state = Path(self.enterContext(tempfile.TemporaryDirectory(dir=self.tmp)))
        self.config = self.state / "config.json"
        self.config.write_bytes(wire({"enabled": True, "projects": ["house-by-the-sea", "sadovyekvartaly"]}))
        self.config.chmod(0o600)
        self.mode.write_text("accept")
        self.ledger = json.loads(subprocess.check_output(
            [PHP, str(SCRIPT), "init", str(self.doc), str(self.state)]))["ledger"]
        self.assertRegex(self.ledger, "^[0-9a-f]{32}$")
        self.payload = {
            "op": "send", "ledger": self.ledger, "id": "rpm-daily-20261123-0900", "kind": "daily",
            "subject": "Realty Price Manager · Отчёт по всем ЖК · 23.11 · 09:00",
            "body": "Сводка по всем ЖК.\nИзменений цен нет.",
            "projects": ["house-by-the-sea", "sadovyekvartaly"],
        }

    def send(self, changes=None, *, raw=None, code=0):
        result = subprocess.run([PHP, "-d", "disable_functions=mail", str(ROOT / "tests/rpm-mail-fixture.php"),
                                 str(self.state), self.port, str(self.smtp / "server.crt"), str(self.runtime)],
                                input=raw if raw is not None else wire(self.payload | (changes or {})),
                                capture_output=True, timeout=15)
        self.assertEqual(result.returncode, code, result.stderr.decode())
        return json.loads(result.stdout) if code == 0 else None

    def received(self):
        file = self.smtp / "fake-mail.json"
        return json.loads(file.read_text()) if file.exists() else []

    def test_acceptance_receipt_survives_process_restart_and_lost_reply(self):
        before = len(self.received())
        ack = self.send()
        self.assertEqual(ack["state"], "accepted")
        self.assertGreater(ack["accepted_at"], 0)
        self.assertEqual(self.send({"op": "status"}), ack)
        self.assertEqual(self.send(), ack)
        self.assertEqual(self.send({"body": "Другой текст."})["state"], "conflict")
        self.assertEqual(self.send({"ledger": "1" * 32})["state"], "ledger_mismatch")
        self.assertEqual(len(self.received()), before + 1)
        event = self.received()[-1]
        self.assertEqual(event["recipients"], ["<" + event["to"] + ">"])
        self.assertEqual(event["replyTo"], "")
        self.assertEqual(event["contentType"], "text/plain")
        self.assertEqual(event["charset"].lower(), "utf-8")
        self.assertEqual(event["subject"], self.payload["subject"])
        self.assertIn(self.payload["body"], event["body"].replace("\r\n", "\n"))
        self.assertRegex(event["messageId"], re.escape(self.payload["id"] + "@zhk-dom-umorya.ru"))

    def test_missing_smtp_ack_is_terminal_for_this_id(self):
        self.mode.write_text("accept_drop")
        before = len(self.received())
        self.assertEqual(self.send()["state"], "uncertain")
        self.mode.write_text("accept")
        self.assertEqual(self.send({"op": "status"})["state"], "uncertain")
        self.assertEqual(self.send()["state"], "uncertain")
        self.assertEqual(len(self.received()), before + 1)

    def test_prepublish_smtp_failure_can_retry(self):
        self.assertEqual(self.send({"op": "status"})["state"], "absent")
        self.mode.write_text("auth_fail")
        before = len(self.received())
        self.assertEqual(self.send()["state"], "retry")
        self.assertEqual(self.send({"op": "status"})["state"], "retry")
        self.assertEqual(len(self.received()), before)
        self.mode.write_text("accept")
        self.assertEqual(self.send()["state"], "accepted")
        self.assertEqual(len(self.received()), before + 1)

    def test_validation_disable_and_forced_command(self):
        before = len(self.received())
        rejected = ({"recipient": "recipient@example.invalid"}, {"subject": "Header\nBcc: bad"},
                    {"kind": "news"}, {"kind": True}, {"body": "ж" * 17000}, {"projects": ["house-by-the-sea"] * 2})
        for changes in rejected:
            self.send(changes, code=2)
        self.send(raw=wire(self.payload).replace(b'{"body":', b'{"body":"duplicate","body":'), code=2)
        self.assertEqual(self.send({"projects": ["another-project"]})["state"], "invalid")
        self.config.write_bytes(wire({"enabled": False, "projects": self.payload["projects"]}))
        self.assertEqual(self.send()["state"], "retry")
        proc = subprocess.run([PHP, str(SCRIPT), "receive", str(self.doc), str(self.state)],
                              env=os.environ | {"SSH_ORIGINAL_COMMAND": "bash"}, input=wire(self.payload),
                              capture_output=True, timeout=5)
        self.assertEqual(proc.returncode, 2)
        self.assertEqual(len(self.received()), before)

    def test_older_smtp_helper_is_never_called(self):
        api = self.doc / "api"
        api.mkdir(exist_ok=True)
        (api / "lead-core.php").write_text("<?php namespace DomLead; function config(){return [];} "
                                          "function enabled($cfg){return true;}")
        (api / "lead-smtp.php").write_text("<?php namespace DomLead; function smtpTransport($m, $cfg, $only){ "
                                          "fwrite(STDERR, 'legacy transport invoked'); return true; }")
        result = subprocess.run([PHP, str(SCRIPT), "receive", str(self.doc), str(self.state)],
                                env=os.environ | {"SSH_ORIGINAL_COMMAND": "rpm-mail-v1"}, input=wire(self.payload),
                                capture_output=True, timeout=5)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stderr, b"")
        self.assertEqual(json.loads(result.stdout)["state"], "retry")
        self.assertEqual(self.send({"op": "status"})["state"], "retry")

    def test_lost_ledger_is_never_recreated_by_sender(self):
        (self.state / "ledger.sqlite").rename(self.state / "preserved.sqlite")
        self.assertEqual(self.send({"op": "status"})["state"], "unavailable")
        self.assertEqual(self.send()["state"], "unavailable")
        self.assertFalse((self.state / "ledger.sqlite").exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
