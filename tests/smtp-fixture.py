"""Loopback-only TLS SMTP sink. No relay, network client, or credential logging."""
import base64
from email import policy
from email.parser import BytesParser
import json
from pathlib import Path
import socketserver
import ssl
import sys
import threading
import time

ROOT = Path(sys.argv[1])
LOCK = threading.Lock()

def mode():
    return (ROOT/'mode').read_text().strip()

def context():
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    stem = 'wrong' if mode() == 'wrong_name' else 'server'
    ctx.load_cert_chain(str(ROOT/(stem+'.crt')), str(ROOT/'server.key'))
    return ctx

def audit(event):
    if len(sys.argv) > 2:
        markers = Path(sys.argv[2])
        event['one_shot_before_smtp'] = any((p/'attempt.json').is_file() and (p/'invocation.json').is_file() for p in markers.glob('*'))
    with LOCK:
        with (ROOT/'smtp-audit.jsonl').open('a') as out:
            out.write(json.dumps(event)+'\n')

class Handler(socketserver.BaseRequestHandler):
    def handle(self):
        conn = self.request
        secured = self.server.implicit
        try:
            if secured:
                conn = context().wrap_socket(conn, server_side=True)
            conn.settimeout(12)
            stream = conn.makefile('rb')
            def send(s):
                conn.sendall((s+'\r\n').encode())
            send('220 loopback SMTP fixture')
            authenticated = False
            envelope = []
            while True:
                line = stream.readline(16384)
                if not line:
                    break
                command = line.decode('ascii', errors='replace').strip()
                verb = command.split(' ',1)[0].upper()
                audit({'command':verb, 'tls':secured})
                if verb in ['EHLO','HELO']:
                    send('250-fixture')
                    if not secured and mode() != 'no_starttls':
                        send('250-STARTTLS')
                    send('250 AUTH LOGIN')
                elif verb == 'STARTTLS':
                    if mode() == 'no_starttls':
                        send('454 TLS unavailable')
                        continue
                    send('220 Begin TLS')
                    conn = context().wrap_socket(conn, server_side=True)
                    stream = conn.makefile('rb')
                    secured = True
                elif verb == 'AUTH':
                    if not secured:
                        send('530 TLS required')
                        continue
                    send('334 '+base64.b64encode(b'Username:').decode())
                    username = stream.readline().strip()
                    send('334 '+base64.b64encode(b'Password:').decode())
                    password = stream.readline().strip()
                    authenticated = (username == base64.b64encode(b'fixture-user')
                                     and password == base64.b64encode(b'fixture-password')
                                     and mode() != 'auth_fail')
                    audit({'auth':authenticated,'tls':secured})
                    send('235 authenticated' if authenticated else '535 bad credentials')
                elif verb == 'MAIL':
                    send('250 sender OK' if authenticated else '530 authenticate')
                    sender = command.split(':',1)[1]
                elif verb == 'RCPT':
                    envelope.append(command.split(':',1)[1])
                    send('550 recipient rejected' if mode() == 'rcpt_fail' else '250 recipient OK')
                elif verb == 'DATA':
                    if not authenticated:
                        send('530 authenticate')
                        continue
                    send('354 data')
                    data = bytearray()
                    while True:
                        line = stream.readline(16384)
                        if line in [b'.\r\n',b'']:
                            break
                        data.extend(line[1:] if line.startswith(b'..') else line)
                    if mode() == 'data_fail':
                        send('554 rejected')
                        continue
                    msg = BytesParser(policy=policy.default).parsebytes(bytes(data))
                    received = {'subject':str(msg['Subject']), 'body':msg.get_content(),
                                'from':str(msg['From']), 'to':str(msg['To']),
                                'replyTo':str(msg['Reply-To'] or ''), 'messageId':str(msg['Message-ID']),
                                'contentType':msg.get_content_type(), 'charset':msg.get_content_charset(),
                                'encoding':str(msg['Content-Transfer-Encoding']),
                                'sender':sender, 'recipients':envelope}
                    with LOCK:
                        target = ROOT/'fake-mail.json'
                        messages = json.loads(target.read_text()) if target.exists() else []
                        messages.append(received)
                        target.write_text(json.dumps(messages,ensure_ascii=False))
                        target.chmod(0o600)
                        (ROOT/'received.eml').write_bytes(bytes(data))
                        (ROOT/'received.eml').chmod(0o600)
                    if mode() == 'accept_drop':
                        break # Message stored, but final 250 never reaches the client.
                    if mode() == 'accept_timeout':
                        time.sleep(8)
                        break
                    send('250 queued locally')
                elif verb == 'QUIT':
                    send('221 bye')
                    break
                elif verb in ['RSET','NOOP']:
                    send('250 OK')
                else:
                    send('500 unsupported')
        except (OSError, ssl.SSLError):
            audit({'connection_closed':True})
        finally:
            conn.close()

class Server(socketserver.ThreadingTCPServer):
    daemon_threads = True
    allow_reuse_address = True

for implicit in [False,True]:
    server = Server(('127.0.0.1',0), Handler)
    server.implicit = implicit
    threading.Thread(target=server.serve_forever,daemon=True).start()
    (ROOT/('smtps-port' if implicit else 'smtp-port')).write_text(str(server.server_address[1]))
print('Loopback TLS SMTP sink ready',flush=True)
threading.Event().wait()
