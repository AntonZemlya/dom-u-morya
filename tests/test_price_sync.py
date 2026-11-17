#!/usr/bin/env python3
"""Offline regression checks for the daily price audit; no network calls."""
import importlib.util
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("price_checker", ROOT / "scripts/check_official_prices.py")
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)


def offer(id, price=7_000_000, number=6):
    return dict(id=str(id), number=number, price=price, area_m2=29., bedrooms=0,
                floor=2, building="1", section="1", floors_total=18, features=[],
                source_url=checker.PROJECT_URL + "/" + str(id) + "?projectId=1")


def lot(id, price=7_000_000, number=6):
    return dict(id=str(id), number=number, price_rub=price, area_m2=29., bedrooms=0,
                floor=2, building="1", section="1", floors_total=18,
                developer_availability="InStock")


class PriceAuditSafety(unittest.TestCase):
    def test_unchanged(self):
        _, rows, missing, added = checker.compare([lot(1)], {"1": offer(1)})
        self.assertEqual((missing, added), ([], []))
        self.assertEqual(rows[0]["delta"], 0)

    def test_valid_price_increase(self):
        _, rows, missing, added = checker.compare([lot(1)], {"1": offer(1, 7_140_000)})
        self.assertEqual(rows[0]["delta"], 140_000)
        self.assertEqual(rows[0]["percent"], 2.0)

    def test_membership_is_explicit(self):
        _, rows, missing, added = checker.compare([lot(1)], {"2": offer(2)})
        self.assertEqual(missing, ["1"])
        self.assertEqual(added, ["2"])
        self.assertEqual(rows, [])

    def test_changed_number_blocks_sync(self):
        with self.assertRaisesRegex(ValueError, "Identity mismatch"):
            checker.compare([lot(1)], {"1": offer(1, number=9)})

    def test_large_price_jump_blocks_sync(self):
        with self.assertRaisesRegex(ValueError, "30%"):
            checker.compare([lot(1)], {"1": offer(1, 12_000_000)})

    def test_unknown_status_blocks_sync(self):
        before = lot(1)
        before["developer_availability"] = "Unknown"
        with self.assertRaisesRegex(ValueError, "Availability changed"):
            checker.compare([before], {"1": offer(1)})

    def test_duplicate_ids_block_sync(self):
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            checker.compare([lot(1), lot(1)], {"1": offer(1)})

    def test_url_scope_guard(self):
        with self.assertRaises(ValueError):
            checker.load_html("https://example.org/somewhere")


if __name__ == "__main__":
    unittest.main(verbosity=2)
