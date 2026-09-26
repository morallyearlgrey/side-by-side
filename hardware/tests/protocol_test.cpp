#include <assert.h>
#include <stdio.h>
#include "../core2-badge/badge_protocol.h"

int main() {
  uint8_t session[] = {0, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77};
  uint8_t packet[badge::kAdvertisementBytes + 1] = {};
  packet[badge::kAdvertisementBytes] = 0xaa;
  badge::advertisement(packet, session);
  assert(packet[badge::kAdvertisementBytes] == 0xaa);
  assert(packet[0] == 2 && packet[1] == 1 && packet[2] == 6);
  assert(packet[3] == 26 && packet[4] == 0x21 && packet[21] == 1);
  assert(memcmp(packet + 22, session, sizeof(session)) == 0);
  assert(memcmp(packet + 5, badge::kUuidLittleEndian, 16) == 0);
  uint8_t response[badge::kScanResponseBytes + 1] = {};
  response[badge::kScanResponseBytes] = 0xbb;
  badge::scanResponse(response);
  assert(response[badge::kScanResponseBytes] == 0xbb);
  assert(response[0] == 17 && response[1] == 7);
  assert(response[18] == 10 && response[19] == 9);
  assert(memcmp(response + 20, "SidebySide", 9) == 0);
  puts("BLE packet length, wire layout, and buffer bounds checks passed.");
}
