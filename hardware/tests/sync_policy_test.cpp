#include <assert.h>
#include <stdint.h>
#include <stdio.h>
#include "../core2-badge/badge_sync_policy.h"

int main() {
  uint64_t first = 0;
  uint64_t end = 0;
  assert(badge::reserveSequenceBlock(0, first, end));
  assert(first == 1 && end == 1025);
  // A reboot skips the unused block, including any request still in flight.
  uint64_t oldLast = end - 1;
  assert(badge::reserveSequenceBlock(end, first, end));
  assert(first > oldLast && end == 2049);
  assert(!badge::reserveSequenceBlock(badge::kMaxSequence, first, end));
  assert(!badge::reserveSequenceBlock(UINT64_MAX, first, end));
  assert(badge::elapsed(1000, UINT32_MAX - 14999, badge::kHeartbeatMs));
  assert(!badge::elapsed(1000, UINT32_MAX - 999, badge::kHeartbeatMs));
  assert(badge::httpResultCode(true, 200) == 200);
  assert(badge::httpResultCode(false, 200) == -1);
  assert(badge::httpResultCode(false, 401) == 401);
  assert(badge::httpResultCode(false, 409) == 409);
  assert(badge::httpResultCode(false, -1) == -1);
  puts("Sequence reservation, millis rollover, and HTTP failure checks passed.");
}
