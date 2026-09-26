#pragma once

#include <stdint.h>

namespace badge {
constexpr uint64_t kMaxSequence = 9007199254740991ULL;
constexpr uint64_t kSequenceBlockSize = 1024;
constexpr uint32_t kHeartbeatMs = 15000;
constexpr uint32_t kSyncFreshMs = 30000;

// Store the returned exclusive upper bound durably BEFORE using this block.
// Skipping unused values after reboot prevents an old request winning over
// the boot-time pause. Zero is reserved for "no report yet" on the server.
inline bool reserveSequenceBlock(uint64_t previousEnd, uint64_t& first,
                                 uint64_t& end) {
  if (previousEnd == 0) previousEnd = 1;
  if (previousEnd > kMaxSequence - kSequenceBlockSize) return false;
  first = previousEnd;
  end = previousEnd + kSequenceBlockSize;
  return true;
}

inline bool elapsed(uint32_t now, uint32_t since, uint32_t interval) {
  return static_cast<uint32_t>(now - since) >= interval;
}

inline int httpResultCode(bool transportSucceeded, int responseCode) {
  // IDF returns ESP_FAIL for a parsed 401 when auth retries are disabled.
  // Preserve client errors, but never claim a successful sync on transport
  // failure just because a partial response contained a success status.
  return transportSucceeded || (responseCode >= 400 && responseCode < 500)
             ? responseCode : -1;
}
}  // namespace badge
