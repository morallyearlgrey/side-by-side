#pragma once
#include <stdint.h>

// Generated for the paired owner's existing tag; never allocate tags locally.
#if __has_include("badge_identity.h")
#include "badge_identity.h"
#else
namespace charm {
constexpr bool kProvisioned = false;
constexpr char kDisplayName[] = "Companion";
constexpr int kTagId = -1;
constexpr uint16_t kTagRows[10] = {};
}
#endif

namespace charm {
// 192 px black border on the Core2's 2-inch 320x240 display is ~24.4 mm.
// The 10x10 matrix includes one white cell around its 8x8 black border.
constexpr int kTagCell = 24;
constexpr int kMarkerSizeTenthsMm = 244;
}
