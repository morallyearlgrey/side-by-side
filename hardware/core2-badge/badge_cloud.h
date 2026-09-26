#pragma once

// Called only from the Arduino/M5 loop; networking runs in a separate task.
namespace badgecloud {
void begin();
void publish(bool available);
bool poll();  // True if the status label changed and the screen should redraw.
const char* statusLabel();
bool enabled();
bool pauseAcknowledged();
}  // namespace badgecloud
