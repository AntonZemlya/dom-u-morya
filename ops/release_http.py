"""Paced, bounded transport for read-only release HTTP checks."""
import contextlib
import errno
import http.client
import signal
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request

PACE_SECONDS = 0.09
RETRY_DELAYS = (0.25, 0.5, 1.0)
FULL_DEADLINE_SECONDS = 360


class TransportFailure(RuntimeError):
    """Network or verification budget exhausted."""


class ConnectionFailure(RuntimeError):
    def __init__(self, message, kind):
        super().__init__(message)
        self.kind = kind


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def transient_error(error):
    while isinstance(error, urllib.error.URLError) and not isinstance(error, urllib.error.HTTPError):
        error = error.reason
    if isinstance(error, ssl.SSLError) and not isinstance(error, ssl.SSLEOFError):
        return None
    for kind in (http.client.RemoteDisconnected, http.client.IncompleteRead, ssl.SSLEOFError):
        if isinstance(error, kind):
            return kind.__name__
    if isinstance(error, TimeoutError):
        return 'ETIMEDOUT'
    if isinstance(error, ConnectionResetError):
        return 'ECONNRESET'
    if isinstance(error, OSError) and error.errno in (errno.ECONNRESET, errno.ETIMEDOUT, errno.ECONNABORTED, errno.EPIPE):
        return errno.errorcode[error.errno]
    return None


class HTTPClient:
    def __init__(self, profile='full', *, opener=None, pace=PACE_SECONDS, seconds=None, requests=None):
        self.opener = opener or urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect()).open
        self.pace = pace
        self.seconds = seconds if seconds is not None else (FULL_DEADLINE_SECONDS if profile == 'full' else 30)
        self.requests = requests if requests is not None else (850 if profile == 'full' else 65)
        self.started = time.monotonic()
        self.next_request = self.started
        self.statistics = dict(request_count=0, retry_count=0, transient_errors={}, bytes_read=0)

    @contextlib.contextmanager
    def deadline(self):
        # Socket timeouts alone do not bound DNS or a response that trickles bytes.
        def expired(*_):
            raise TransportFailure('HTTP verification deadline exceeded')
        previous = signal.signal(signal.SIGALRM, expired)
        try:
            signal.setitimer(signal.ITIMER_REAL, max(0.000001, self.seconds - (time.monotonic() - self.started)))
            yield
        finally:
            signal.setitimer(signal.ITIMER_REAL, 0)
            signal.signal(signal.SIGALRM, previous)

    def fetch(self, url, method='GET', *, expected=(200,), body_limit=None, validate_headers=None):
        if method not in ('GET', 'HEAD'):
            raise ValueError('Release HTTP only accepts GET and HEAD')
        path = urllib.parse.urlsplit(url).path
        request = urllib.request.Request(url, method=method, headers={'Cache-Control': 'no-cache'})
        stats = self.statistics
        for attempt in range(len(RETRY_DELAYS) + 1):
            now = time.monotonic()
            delay = max(0, self.next_request - now)
            remaining = self.seconds - (now - self.started) - delay
            if stats['request_count'] >= self.requests or remaining <= 0:
                raise TransportFailure('HTTP verification request or time budget exhausted')
            if delay:
                time.sleep(delay)
            self.next_request = time.monotonic() + self.pace
            stats['request_count'] += 1
            stats['retry_count'] += int(attempt > 0)
            status = None
            try:
                try:
                    response = self.opener(request, timeout=min(15, remaining))
                except urllib.error.HTTPError as error:
                    response = error
                with response:
                    status = response.status
                    if expected is not None and status not in expected:
                        raise RuntimeError('Unexpected HTTP status for {} {} ({})'.format(method, path, status))
                    if validate_headers:
                        validate_headers(status, response.headers)
                    limit = body_limit if status == 200 else (
                        65537 if status == 301 and url.startswith('http://') and expected is None else None)
                    body = b''
                    if method == 'GET' and limit is not None:
                        # Reading an ordinary 200 to EOF verifies Content-Length in http.client.
                        body = response.read() if limit == -1 else response.read(limit)
                        stats['bytes_read'] += len(body)
                        length = response.headers.get('Content-Length', '')
                        if limit != -1 and len(body) < limit and length.isdigit() and int(length) > len(body):
                            raise http.client.IncompleteRead(b'', int(length) - len(body))
                    return status, response.headers, body
            except (OSError, http.client.HTTPException) as error:
                kind = transient_error(error)
                if kind is None:
                    # Never print arbitrary exception text, response headers or query strings.
                    reason = getattr(error, 'reason', error)
                    raise ConnectionFailure('HTTP connection failed for {} {} ({})'.format(
                        method, path, type(reason).__name__), 'tls' if isinstance(reason, ssl.SSLError) else 'connection') from None
                counts = stats['transient_errors']
                counts[kind] = counts.get(kind, 0) + 1
                # A redirect already received must pass its contract on this response.
                if attempt == len(RETRY_DELAYS) or status not in (None, 200):
                    raise TransportFailure('HTTP retries exhausted for {} {} ({})'.format(method, path, kind)) from None
                self.next_request = max(self.next_request, time.monotonic() + RETRY_DELAYS[attempt])
