"""Only loopback synthetic input; packages are produced by the actual pinned R2A exporter."""
import json
from pathlib import Path
import subprocess
import sys
from unittest.mock import patch

R2A = 'db9963536daeb68ab9466684adb3df9da6bdc1e1'
ROOT = Path(__file__).resolve().parent.parent


def packages(repo, root, checked=None):
    from datetime import datetime, timedelta, timezone
    # Fresh confirmations by default; an explicit clock remains reproducible and still expires normally.
    checked = checked or (datetime.now(timezone.utc) - timedelta(seconds=60)).strftime('%Y-%m-%dT%H:%M:%SZ')
    require_sha = subprocess.check_output(['git', '-C', str(repo), 'rev-parse', 'HEAD'], text=True).strip()
    if require_sha != R2A or subprocess.check_output(['git', '-C', str(repo), 'status', '--porcelain']):
        raise ValueError('Clean pinned R2A checkout required: ' + R2A)
    sys.path.insert(0, str(repo))
    from price_manager.adapters import SadovoeKolcoAdapter
    from price_manager.packages import Packages
    from price_manager.projects import PROJECTS
    from price_manager.state import ProjectStore
    from price_manager.transport import SourceHTTP
    from tests.source_fixture import Replay, SVG
    replay = Replay((26, 2))
    stage = [0]
    def unique(path):
        if '/upload/' in path:
            seed = int(path.split('_')[-1].split('.')[0]) + stage[0] * 1000
            replay.svg = ((ROOT / 'assets/content/plans/026ef1ab1116319eafed3c5a65c9f3c24034c4d4bb1d17138826dec2ee19cb1d.svg').read_bytes()
                          if seed in (1, 1001) else SVG.replace(b'#157', f'#{seed:06x}'.encode()))
    replay.on_get = unique
    result = []
    with replay.serve() as port:
        store = ProjectStore(root, PROJECTS['house-by-the-sea'])
        bundles = Packages(store)
        for version in range(3):
            if version == 1:
                replay.rows['house-by-the-sea']['900001']['price'] += 10000
                del replay.rows['house-by-the-sea']['900026']
                stage[0] = 1
            # Third package confirms the identical second version at a later time.
            at = (datetime.fromisoformat(checked.replace('Z', '+00:00')) + timedelta(seconds=version)).strftime('%Y-%m-%dT%H:%M:%SZ')
            with patch('price_manager.sadovoe.utc_now', return_value=at):
                store.sync(SadovoeKolcoAdapter.for_source(store, SourceHTTP(fixture_port=port, interval=0)))
            sha = bundles.build(house_repo=ROOT)
            manifest = bundles.verify(sha)
            result.append(dict(package=sha, native=manifest['native_sha256'], source=manifest['source_sha256'],
                               checked_at=at, directory=str(bundles.releases / sha)))
    return result


if __name__ == '__main__':
    import argparse
    import tempfile
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--r2a-repo', type=Path, required=True)
    parser.add_argument('--checked-at', help='Explicit UTC confirmation; default is current UTC minus 60 seconds')
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='dom-publisher-packages-')).resolve()
    print(json.dumps(dict(root=str(root), r2a=R2A, packages=packages(args.r2a_repo, root, args.checked_at)), indent=2))
