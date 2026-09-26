import unittest

from scan_badge import PresenceTracker, SERVICE_UUID, parse_session


class BadgeTests(unittest.TestCase):
    def test_payload(self):
        self.assertEqual(parse_session(bytes.fromhex("010011223344556677")), "0011223344556677")

    def test_rejects_bad_payloads(self):
        for bad in (None, "bad", b"", b"\x01", b"\x02" + bytes(8), b"\x01" + bytes(9)):
            self.assertIsNone(parse_session(bad))

    def test_unknown_service_ignored(self):
        tracker = PresenceTracker()
        self.assertIsNone(tracker.observe({"other": b"\x01" + bytes(8)}, -60, 0))
        self.assertEqual(tracker.badges, {})

    def test_pause_expires_and_repeated_advertisements_refresh(self):
        tracker = PresenceTracker(5)
        data = {SERVICE_UUID.upper(): bytes.fromhex("010011223344556677")}
        session = tracker.observe(data, -60, 0)
        self.assertIsNone(tracker.observe(data, -55, 4))
        self.assertEqual(tracker.expire(8.9), [])
        self.assertEqual(tracker.expire(9), [session])
        self.assertEqual(tracker.expire(10), [])

    def test_rotating_sessions_not_assumed_same_person(self):
        tracker = PresenceTracker()
        old = tracker.observe({SERVICE_UUID: bytes.fromhex("010011223344556677")}, -60, 0)
        new = tracker.observe({SERVICE_UUID: bytes.fromhex("018877665544332211")}, -60, 3)
        self.assertNotEqual(old, new)
        self.assertEqual(tracker.expire(5), [old])
        self.assertIn(new, tracker.badges)


if __name__ == "__main__":
    unittest.main()
