#!/usr/bin/env python3
"""Private Jino receiver and operator commands for the House catalog publisher."""

import argparse
import http.client
import json
import os
from pathlib import Path
import subprocess
import sys

# The forced SSH command uses Python isolated mode and a reviewed private bundle.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from catalog_publisher import FORMAT, NAMESPACE, Publisher, WebsiteUnavailable, checksum, directory, require


RECEIVER_COMMAND = 'rpm-receive-v1'


def receive(publisher, staging, *, source=None, sink=None):
    from delivery_receiver import DeliveryError, Limits, serve

    def publish(package, manifest_sha, native_sha, expected):
        require(checksum(expected), 'house_active_sha_required')
        try:
            result = publisher.install(package, manifest_sha, expected)
        except BlockingIOError:
            raise DeliveryError('publication_busy', retryable=True) from None
        except WebsiteUnavailable:
            raise DeliveryError('publication_unavailable', retryable=True) from None
        require(result['active'] == native_sha and result['package'] == manifest_sha
                and result['pending'] is None, 'publication_unverified')

    return serve(staging, tuple(NAMESPACE), FORMAT, publish,
                 limits=Limits(cache_bytes=180 << 20), source=source, sink=sink)


def main(argv=None):
    os.umask(0o077)
    args = list(sys.argv[1:] if argv is None else argv)
    original = os.environ.get('SSH_ORIGINAL_COMMAND')
    if original is not None or args == ['receive']:
        require(args == ['receive'] and original == RECEIVER_COMMAND, 'receiver_command_required')
        publisher = Publisher.for_jino()
        private = directory(publisher.root.parent / 'rpm-receiver-v1')
        return receive(publisher, directory(private / 'staging'))

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['status', 'prepare', 'owner', 'restore', 'invalidate'])
    parser.add_argument('--expect')
    parser.add_argument('--expect-package')
    parser.add_argument('--owner', choices=['publisher', 'legacy'])
    options = parser.parse_args(args)
    if options.action != 'status':
        require(checksum(options.expect), 'expected_native_sha_required')
    if options.action in ('restore', 'invalidate'):
        require(checksum(options.expect_package), 'expected_confirmation_required')
    if options.action == 'owner':
        require(options.owner is not None, 'owner_required')

    publisher = Publisher.for_jino()
    if options.action == 'prepare':
        result = publisher.prepare_jino(options.expect)
    elif options.action == 'owner':
        result = publisher.owner(options.expect, options.owner)
    elif options.action == 'restore':
        result = publisher.restore(options.expect, options.expect_package)
    elif options.action == 'invalidate':
        result = publisher.invalidate(options.expect, options.expect_package)
    else:
        with publisher.locks():
            result = publisher.status()
            publisher.check_http(publisher.current())
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 3 if options.action == 'status' and result['trust_loss'] else 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, OSError, KeyError, TypeError, AttributeError, ImportError,
            http.client.HTTPException, subprocess.SubprocessError) as exc:
        print('rpm-receiver: ' + str(exc), file=sys.stderr)
        sys.exit(2)
