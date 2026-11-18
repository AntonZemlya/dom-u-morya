"""Reproduce synchronization failures and changes using local fixtures."""
import copy
from email.message import Message
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT/'scripts'))
import catalog_sync as sync
import catalog_source as source

BUNDLED = json.loads((ROOT/'data/apartments.json').read_text())
SVG = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 40"><rect width="60" height="40"/></svg>'
NOW = int(time.time())

class SyncContract(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory(prefix='dom-catalog-fixtures-')
        self.addCleanup(tmp.cleanup)
        self.store = sync.Store(Path(tmp.name), node=shutil.which('node'))
        self.store.root.parent.mkdir(mode=0o700)
        for path in (self.store.root, self.store.media, self.store.snapshots, self.store.website_lock.parent):
            path.mkdir(mode=0o700)
        for path in (self.store.running, self.store.website_lock):
            sync.atomic(path, b'lock')
        self.seed_lots = [
            sync.normalize_lot(lot, [sync.normalize_plan(p['type'], p['source_url'], p['sha256']) for p in lot['plans']])
            for lot in BUNDLED[:6]
        ]
        self.initial, raw = self.store.build_snapshot(self.seed_lots, NOW)
        sync.atomic(self.store.snapshots/(self.initial+'.json'), raw)
        self.store.save(dict(schema=1, active=self.initial, history=[self.initial], checked_at=NOW,
                             source_ok=True, published_checked_at=NOW, etags={}, outbox=[], history_events=[], started_at=None))
        for method in ('verify_render','verify_live'):
            context = patch.object(self.store, method)
            setattr(self, method, context.start())
            self.addCleanup(context.stop)
        self.withdrawal = patch.object(source, 'confirm_withdrawal')
        self.withdrawal.start()
        self.addCleanup(self.withdrawal.stop)
        self.mail = patch.object(self.store, 'flush', return_value=False)
        self.mail.start()
        self.addCleanup(self.mail.stop)

    def fixtures(self):
        return [(copy.deepcopy(row), [
            {'name':name,'img':plan['source_url']}
            for plan in row['plans'] for name, (view, _) in source.TABS.items() if view == plan['type']
        ]) for row in self.seed_lots]

    def test_no_change_skips_publication_and_notification(self):
        with patch.object(source, 'inventory', return_value=self.fixtures()), patch.object(self.store, 'download_plan') as asset:
            asset.side_effect = lambda url, *args: {'hash':next(p['sha256'] for r in self.seed_lots for p in r['plans'] if p['source_url']==url)}
            before = self.store.state.read_bytes()
            self.assertFalse(self.store.run(NOW+60, dry=True)['publish'])
            self.assertEqual(self.store.state.read_bytes(), before)
            self.store.run(NOW+60)
            state = self.store.read_state()
            self.assertEqual(state['active'], self.initial)
            self.assertEqual(state['checked_at'], NOW+60)
            self.assertEqual(state['published_checked_at'], NOW+60)
            self.assertEqual(state['outbox'], [])
            self.verify_live.assert_not_called()

    def test_price_addition_disappearance_replacement_and_smtp_retry(self):
        fixture = self.fixtures()
        fixture[0][0]['price_rub'] += 40_000
        removed, _ = fixture.pop()
        row = dict(fixture[-1][0], id='99001', number=999, source_url=source.PROJECT_URL+'/99001?projectId=1')
        tabs = [{'name':'Без мебели','img':'/upload/plans/house-by-the-sea/plan/test.svg'}]
        fixture.append((row, tabs))
        replacement = fixture[1][1][0]['img']
        old_hashes = {p['source_url']: p['sha256'] for r in self.seed_lots for p in r['plans']}
        with patch.object(source, 'inventory', return_value=fixture), patch.object(self.store, 'download_plan') as asset:
            asset.side_effect = lambda url, *args: {'hash': source.digest(SVG) if url == replacement else old_hashes.get(url, source.digest(SVG))}
            result = self.store.run(NOW+60)
            self.assertFalse(result['notification_ok'])
            state = self.store.read_state()
            version = state['active']
            self.assertNotEqual(version, self.initial)
            self.assertEqual(len(state['outbox']), 1)
            text = state['outbox'][0]['body']
            for value in (removed['id'], row['id'], 'Обновлены параметры или планировка', str(fixture[0][0]['price_rub'])):
                self.assertIn(value, text)
            current = {r['id']:r for r in self.store.read_snapshot(version)['lots']}
            self.assertNotIn(removed['id'], current)
            self.assertEqual(len(current['99001']['plans']), 1)
            self.assertEqual(current[fixture[1][0]['id']]['plans'][0]['sha256'], source.digest(SVG))
            self.mail.stop()
            with patch.object(sync.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0)) as transmitted:
                self.assertTrue(self.store.run(NOW+120)['notification_ok'])
                self.assertEqual(transmitted.call_count, 1)
            self.assertEqual(self.store.read_state()['active'], version)
            self.assertEqual(self.store.read_state()['outbox'], [])

    def test_defects_leave_last_snapshot_and_mark_public_status(self):
        for failure in (TimeoutError('официальный сайт TimeOut'), ValueError('Некорректный ответ'), OSError('частичная загрузка')):
            with patch.object(source, 'inventory', side_effect=failure):
                with self.assertRaises(ValueError):
                    self.store.run(NOW+60)
            state = self.store.read_state()
            self.assertEqual(state['active'], self.initial)
            self.assertFalse(state['source_ok'])
            self.assertEqual(state['published_checked_at'], NOW)
            self.assertTrue(state['outbox'])

    def test_new_lot_with_unavailable_plan_marks_partial_without_replacing_snapshot(self):
        fixture = self.fixtures()
        new_id = '99123'
        new_lot = dict(fixture[0][0], id=new_id, number=1000, source_url=source.PROJECT_URL+'/'+new_id+'?projectId=1')
        plan = '/upload/plans/house-by-the-sea/plan-meb/exact-fixture.svg'
        fixture.append((new_lot, [{'name':'С мебелью', 'img':plan}]))
        hashes = {p['source_url']: p['sha256'] for r in self.seed_lots for p in r['plans']}

        def missing_plan(url, *_):
            if url == source.ORIGIN+plan:
                raise OSError('Схема временно недоступна')
            return {'hash':hashes[url]}

        with patch.object(source, 'inventory', return_value=fixture), patch.object(self.store, 'download_plan') as asset:
            asset.side_effect = missing_plan
            dry = self.store.run(NOW+30, dry=True)
            self.assertEqual(dry['status'], 'partial')
            self.assertFalse(dry['publish'])
            result = self.store.run(NOW+60)
            state = self.store.read_state()
            self.assertEqual(result['status'], 'partial')
            self.assertEqual(result['active'], self.initial)
            self.assertEqual(state['history'], [self.initial])
            self.assertEqual(state['unresolved_count'], 1)
            self.assertEqual(state['published_checked_at'], NOW+60)
            self.assertEqual(len(self.store.read_snapshot(state['active'])['lots']), len(self.seed_lots))
            self.verify_live.assert_not_called()
            self.assertEqual(len(state['outbox']), 1)
            self.assertIn(new_id, state['outbox'][0]['body'])
            self.assertIn('каталог синхронизирован частично', state['outbox'][0]['subject'])
            self.assertIn('Схема временно недоступна', state['outbox'][0]['body'])
            self.assertIn(self.initial, state['outbox'][0]['body'])

            asset.side_effect = lambda url,*_: {'hash':hashes.get(url, source.digest(SVG))}
            result = self.store.run(NOW+120)
            state = self.store.read_state()
            self.assertEqual(result['status'], 'confirmed')
            self.assertEqual(state['unresolved_count'], 0)
            self.assertEqual(state['published_checked_at'], NOW+120)
            self.assertNotEqual(state['active'], self.initial)
            lots = self.store.read_snapshot(state['active'])['lots']
            self.assertIn(new_id, {row['id'] for row in lots})
            self.assertEqual({row['id']:row['price_rub'] for row in lots if row['id'] != new_id},
                             {row['id']:row['price_rub'] for row in self.seed_lots})
            self.verify_live.assert_called_with(state['active'], 'confirmed')
            self.assertEqual(len(state['outbox']), 2)
            self.assertIn('Добавлена: №1000, ID '+new_id, state['outbox'][1]['body'])
            expected = list(state['outbox'])
            self.mail.stop()
            with patch.object(sync.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0)) as smtp:
                self.assertTrue(self.store.flush(state))
            delivered = [json.loads(call.kwargs['input']) for call in smtp.call_args_list]
            self.assertEqual(delivered, expected)
            self.assertEqual(self.store.read_state()['outbox'], [])

    def test_invalid_plan_isolated(self):
        fixture = self.fixtures()
        new_lot = dict(fixture[0][0], id='99123', number=1000, source_url=source.PROJECT_URL+'/99123?projectId=1')
        fixture.append((new_lot, [{'name':'С мебелью', 'img':'https://example.invalid/forged.svg'}]))
        fixture[0][0]['price_rub'] += 50_000
        hashes = {p['source_url']: p['sha256'] for r in self.seed_lots for p in r['plans']}
        with patch.object(source, 'inventory', return_value=fixture), patch.object(self.store, 'download_plan', side_effect=lambda url,*a: {'hash':hashes[url]}):
            result = self.store.run(NOW+60)
        self.assertEqual(len(result['issues']), 1)
        state = self.store.read_state()
        self.assertNotEqual(state['active'], self.initial)
        self.assertEqual(len(state['outbox']), 2)
        self.assertNotIn('99123', {x['id'] for x in self.store.read_snapshot(state['active'])['lots']})

    def test_unconfirmed_existing_price_does_not_advance_public_date(self):
        candidate = copy.deepcopy(self.seed_lots)
        candidate[0]['developer_availability'] = None
        with patch.object(self.store, 'prepare', return_value=(candidate, {}, ['Scheme unavailable'])):
            result = self.store.run(NOW+60)
        state = self.store.read_state()
        self.assertEqual(result['status'], 'partial')
        self.assertEqual(state['checked_at'], NOW+60)
        self.assertEqual(state['published_checked_at'], NOW)
        lots = self.store.read_snapshot(state['active'])['lots']
        self.assertIsNone(lots[0]['developer_availability'])
        self.assertEqual(lots[0]['price_rub'], self.seed_lots[0]['price_rub'])

    def test_unfinished_write_and_live_verification_roll_back(self):
        prepared = copy.deepcopy(self.seed_lots)
        prepared[0]['price_rub'] += 10_000
        with patch.object(self.store, 'prepare', return_value=(prepared, {}, [])):
            original = sync.atomic
            def fail_snapshot(path, data):
                if path.parent == self.store.snapshots:
                    raise OSError('disk write failed')
                original(path, data)
            with patch.object(sync, 'atomic', side_effect=fail_snapshot):
                with self.assertRaisesRegex(ValueError, 'disk write failed'):
                    self.store.run(NOW+60)
            self.assertEqual(self.store.read_state()['active'], self.initial)
            self.verify_live.side_effect = ValueError('live verification failed')
            with self.assertRaisesRegex(ValueError, 'live verification failed'):
                self.store.run(NOW+120)
            self.assertEqual(self.store.read_state()['active'], self.initial)
            self.assertFalse(self.store.read_state()['source_ok'])
            self.assertEqual(self.store.read_state()['published_checked_at'], NOW)

    def test_restore_exposes_previous_snapshot_and_keeps_notification(self):
        candidate = copy.deepcopy(self.seed_lots)
        candidate[0]['price_rub'] += 20_000
        with patch.object(self.store, 'prepare', return_value=(candidate, {}, [])):
            result = self.store.run(NOW+60)
        self.assertNotEqual(result['active'], self.initial)
        self.store.restore(self.initial, NOW+120)
        state = self.store.read_state()
        self.assertEqual(state['active'], self.initial)
        self.assertFalse(state['source_ok'])
        self.assertEqual(len(state['outbox']), 2)

    def test_bulk_and_identity_anomalies_stop_before_publication(self):
        with self.assertRaisesRegex(ValueError, 'состава'):
            source.verify_changes(self.seed_lots, self.seed_lots[:1])
        changed = [dict(lot, price_rub=int(lot['price_rub']*1.15)) for lot in self.seed_lots]
        with self.assertRaisesRegex(ValueError, 'массовые'):
            source.verify_changes(self.seed_lots, changed)
        changed[0]['number'] += 1
        with self.assertRaisesRegex(ValueError, 'идентичность'):
            source.verify_changes(self.seed_lots, changed)

    def test_parallel_run_refuses_to_write(self):
        before = self.store.state.read_bytes()
        with sync.lock(self.store.running), self.assertRaises(BlockingIOError):
            self.store.run(NOW+60)
        self.assertEqual(self.store.state.read_bytes(), before)

    def test_validators_do_not_redownload_identical_images(self):
        url = self.seed_lots[0]['plans'][0]['source_url']
        hash_ = source.validate_svg(SVG)
        self.store.put_media(hash_, SVG, b'RIFF0000WEBP' + b'1234567890')
        headers = Message()
        with patch.object(source, 'read_https', return_value=(304, headers, b'')) as network:
            previous = {url:{'hash':hash_, 'etag':'"fixture"', 'fetched_at':NOW}}
            self.assertEqual(self.store.download_plan(url, previous, NOW+60, False), previous[url])
            self.assertEqual(network.call_args.args[2]['If-None-Match'], '"fixture"')
        with self.assertRaises(ValueError):
            source.validate_svg(SVG.replace(b'<rect', b'<script'))
        with self.assertRaises(ValueError):
            source.validate_svg(SVG.replace(b'<rect ', b'<rect style="fill:url(https://example.invalid/x)" '))

if __name__ == '__main__':
    unittest.main(verbosity=2)
