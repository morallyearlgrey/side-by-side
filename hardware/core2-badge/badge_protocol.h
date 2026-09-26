#pragma once

#include <stddef.h>
#include <stdint.h>
#include <string.h>

namespace badge {
constexpr char kServiceUuid[] = "defb0de6-0009-47e1-acd7-b6de56c6978f";
constexpr uint8_t kUuidLittleEndian[16] = {
    0x8f, 0x97, 0xc6, 0x56, 0xde, 0xb6, 0xd7, 0xac,
    0xe1, 0x47, 0x09, 0x00, 0xe6, 0x0d, 0xfb, 0xde};
constexpr uint8_t kVersion = 1;
constexpr size_t kSessionBytes = 8;
constexpr uint32_t kRotationMs = 120000;
constexpr size_t kAdvertisementBytes = 30;
constexpr size_t kScanResponseBytes = 29;

inline void advertisement(uint8_t* output, const uint8_t* session) {
  output[0] = 2;
  output[1] = 0x01;
  output[2] = 0x06;
  output[3] = 26;
  output[4] = 0x21;  // 128-bit service data, with UUID in BLE wire order.
  memcpy(output + 5, kUuidLittleEndian, 16);
  output[21] = kVersion;
  memcpy(output + 22, session, kSessionBytes);
}

inline void scanResponse(uint8_t* output) {
  output[0] = 17;
  output[1] = 0x07;
  memcpy(output + 2, kUuidLittleEndian, 16);
  output[18] = 10;
  output[19] = 0x09;
  memcpy(output + 20, "SidebySide", 9);
}

static_assert(kAdvertisementBytes <= 31 && kScanResponseBytes <= 31,
              "Legacy BLE packets must fit in 31 bytes");
}  // namespace badge
