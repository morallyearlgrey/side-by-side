"""Local BLE discovery probe. No pairing, profile lookup, or network upload."""

import argparse
import asyncio
import time
from dataclasses import dataclass

SERVICE_UUID = "defb0de6-0009-47e1-acd7-b6de56c6978f"


def parse_session(data):
    if not isinstance(data, (bytes, bytearray)) or len(data) != 9 or data[0] != 1:
        return None
    return bytes(data[1:]).hex()


@dataclass
class SeenBadge:
    last_seen: float
    first_seen: float
    rssi: int


class PresenceTracker:
    def __init__(self, expiry=5.0):
        if expiry <= 0:
            raise ValueError("Expiry must be positive")
        self.expiry = expiry
        self.badges = {}

    def observe(self, service_data, rssi, now):
        data = next((value for key, value in service_data.items() if key.lower() == SERVICE_UUID), None)
        session = parse_session(data)
        if session is None:
            return None
        first = session not in self.badges
        initial = now if first else self.badges[session].first_seen
        self.badges[session] = SeenBadge(now, initial, rssi)
        return session if first else None

    def expire(self, now):
        expired = [key for key, value in self.badges.items() if now - value.last_seen >= self.expiry]
        for key in expired:
            del self.badges[key]
        return expired


async def scan(seconds, expiry):
    try:
        from bleak import BleakScanner
    except ImportError as error:
        raise RuntimeError("Install hardware/scanner/requirements.txt in the badge virtual environment first") from error

    tracker = PresenceTracker(expiry)

    def advertisement(_device, data):
        # Ignore unrelated radios: do not print their names, addresses, or payloads.
        new_session = tracker.observe(data.service_data, data.rssi, time.monotonic())
        if new_session:
            print(f"FOUND session={new_session} rssi={data.rssi} dBm", flush=True)

    print("Scanning for SidebySide badges. RSSI is signal strength, not distance or identity.", flush=True)
    print("The badge starts paused. Switch it to Available. Ctrl+C stops this scanner.", flush=True)
    async with BleakScanner(advertisement, service_uuids=[SERVICE_UUID], scanning_mode="active"):
        deadline = time.monotonic() + seconds if seconds else None
        while deadline is None or time.monotonic() < deadline:
            await asyncio.sleep(0.5)
            for session in tracker.expire(time.monotonic()):
                print(f"EXPIRED session={session}; no recent advertisements", flush=True)
    print(f"Scan ended; {len(tracker.badges)} recently seen session(s).", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seconds", type=float, default=60, help="Scan duration; 0 means until Ctrl+C")
    parser.add_argument("--expiry", type=float, default=5, help="Seconds without advertisements before expiry")
    args = parser.parse_args()
    if args.seconds < 0 or args.expiry <= 0:
        parser.error("Duration must be nonnegative and expiry positive")
    try:
        asyncio.run(scan(args.seconds, args.expiry))
    except KeyboardInterrupt:
        print("Scanner stopped.")
    except Exception as error:
        parser.exit(1, f"BLE scan failed: {error}\nCheck Bluetooth power and permission for the app running Python.\n")


if __name__ == "__main__":
    main()
