#pragma once
#include <stdint.h>

// Called only from the Arduino/M5 loop; networking runs in a separate task.
namespace badgecloud {
void begin();
void publish(bool available, const char* session = nullptr, uint32_t sessionStarted = 0);
bool poll();  // True if the status label changed and the screen should redraw.
const char* statusLabel();
bool enabled();
bool pauseAcknowledged();
bool canShare();
bool mustPause();
}  // namespace badgecloud
