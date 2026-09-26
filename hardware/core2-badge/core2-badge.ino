#include <M5Unified.h>
#include <esp_bt.h>
#include <NimBLEDevice.h>
#include <nvs_flash.h>
#include <esp_random.h>
#include <esp_sleep.h>
#include "badge_cloud.h"
#include "badge_protocol.h"
#include "charm_identity.h"
#include "astronaut_rgb565.h"

// NimBLE pulls in Arduino's Bluetooth controller support, including the strong
// btInUse marker that keeps Bluetooth memory available before setup().

enum class CharmScreen : uint8_t { Home, Tag, SharingOff };
CharmScreen screen = CharmScreen::Home;
NimBLEAdvertising* advertising = nullptr;
uint8_t sessionId[badge::kSessionBytes] = {};
uint8_t advertisingPacket[badge::kAdvertisementBytes] = {};
uint8_t scanPacket[badge::kScanResponseBytes] = {};
char sessionHex[badge::kSessionBytes * 2 + 1] = {};
uint32_t sessionStarted = 0;
bool available = false;
bool radioReady = false;
bool radioFault = false;
bool poweringOff = false;
uint32_t powerOffStarted = 0;
bool enableRequested = false;
uint32_t enableRequestedAt = 0;

void centerText(const char* text, int y, int size, uint16_t color) {
  M5.Display.setTextColor(color, BLACK);
  M5.Display.setTextSize(size);
  while (M5.Display.textWidth(text) > 288 && size > 1) {
    M5.Display.setTextSize(--size);
  }
  M5.Display.setCursor((320 - M5.Display.textWidth(text)) / 2, y);
  M5.Display.print(text);
}

void drawStableCompanionTag() {
  // Fill the screen with the fixed marker and its white quiet zone. Nothing
  // overlays the marker; the three capacitive buttons remain below the LCD.
  M5.Display.fillScreen(WHITE);
  constexpr int originX = (320 - charm::kTagCell * 10) / 2;
  constexpr int originY = (240 - charm::kTagCell * 10) / 2;
  for (int row = 0; row < 10; ++row) {
    for (int column = 0; column < 10; ++column) {
      if (charm::kTagRows[row] & (1u << (9 - column))) {
        M5.Display.fillRect(originX + column * charm::kTagCell,
                            originY + row * charm::kTagCell,
                            charm::kTagCell, charm::kTagCell, BLACK);
      }
    }
  }
}

void drawButtonLabels() {
  M5.Display.setTextSize(1);
  M5.Display.setTextColor(TFT_LIGHTGREY, BLACK);
  M5.Display.setCursor(26, 228);
  M5.Display.print("HOME");
  M5.Display.setCursor(147, 228);
  M5.Display.print("TAG");
  M5.Display.setCursor(262, 228);
  M5.Display.print("POWER");
}

void drawHomeScreen() {
  centerText("Side by Side", 10, 2, WHITE);
  // The supplied artwork is already RGB565 in flash; no image decoder or
  // full-screen framebuffer competes with BLE/HTTPS for working memory.
  const bool previousSwap = M5.Display.getSwapBytes();
  M5.Display.setSwapBytes(true);
  M5.Display.pushImage(10, 34, charm_art::kWidth, charm_art::kHeight,
                       charm_art::kAstronaut);
  M5.Display.setSwapBytes(previousSwap);
  M5.Display.setTextColor(WHITE, BLACK);
  M5.Display.setTextSize(2);
  M5.Display.setCursor(180, 60);
  M5.Display.print("Companion");
  M5.Display.setCursor(180, 84);
  M5.Display.print("Charm");
  M5.Display.setTextSize(3);
  M5.Display.setCursor(180, 122);
  M5.Display.print(charm::kDisplayName);
  M5.Display.setTextSize(1);
  M5.Display.setTextColor(TFT_LIGHTGREY, BLACK);
  M5.Display.setCursor(180, 169);
  M5.Display.printf("Your serial ID: %d", charm::kTagId);
  M5.Display.setCursor(180, 192);
  M5.Display.setTextColor(available ? TFT_GREEN : TFT_LIGHTGREY, BLACK);
  M5.Display.print(available ? "Sharing on" : "Sharing off");
  drawButtonLabels();
}

void drawSharingOffScreen() {
  centerText("Companion Charm", 30, 2, WHITE);
  centerText(charm::kDisplayName, 76, 3, WHITE);
  char identity[48];
  if (charm::kProvisioned) snprintf(identity, sizeof(identity), "Your serial ID: %d", charm::kTagId);
  else snprintf(identity, sizeof(identity), "Pair this charm in the app");
  centerText(identity, 122, 2, TFT_LIGHTGREY);
  centerText("Sharing off", 160, 3, WHITE);
  if (enableRequested) {
    centerText("Waiting for connection", 190, 1, TFT_LIGHTGREY);
    centerText("Press middle to cancel", 207, 1, TFT_LIGHTGREY);
  } else {
    centerText(radioFault ? "Restart to reconnect Bluetooth" : "Press middle to show your tag", 202, 1, TFT_LIGHTGREY);
  }
  drawButtonLabels();
}

void drawScreen() {
  if (available && screen == CharmScreen::Tag && !poweringOff && !radioFault) {
    drawStableCompanionTag();
    return;
  }
  M5.Display.fillScreen(BLACK);
  if (poweringOff) {
    centerText("Powering off...", 100, 2, WHITE);
    return;
  }
  if (screen == CharmScreen::Home) drawHomeScreen();
  else drawSharingOffScreen();
}

const char* screenLabel() {
  if (available && screen == CharmScreen::Tag) return "tag";
  return screen == CharmScreen::Home ? "home" : "off";
}

void shutdownRadio() {
  if (advertising && NimBLEDevice::isInitialized()) advertising->stop();
  NimBLEDevice::deinit(true);
  advertising = nullptr;
  // Clean up a controller that failed before NimBLE finished initialization.
  if (esp_bt_controller_get_status() == ESP_BT_CONTROLLER_STATUS_ENABLED) {
    esp_bt_controller_disable();
  }
  if (esp_bt_controller_get_status() == ESP_BT_CONTROLLER_STATUS_INITED) {
    esp_bt_controller_deinit();
  }
  radioReady = false;
}

bool initializeRadio() {
  // This charm only advertises; it needs no GATT server, scanner, or Bluetooth
  // Classic host. NimBLE leaves enough internal heap for verified HTTPS.
  // Preflight NVS so a library recovery path cannot erase our sequence counter.
  if (nvs_flash_init() != ESP_OK || !NimBLEDevice::init("SidebySide")) {
    Serial.println("BLE initialization failed");
    shutdownRadio();
    return false;
  }
  advertising = NimBLEDevice::getAdvertising();
  if (!advertising ||
      !advertising->setConnectableMode(BLE_GAP_CONN_MODE_NON) ||
      !advertising->setDiscoverableMode(BLE_GAP_DISC_MODE_GEN)) {
    shutdownRadio();
    return false;
  }
  advertising->setMinInterval(0x190);  // 250 ms, in 0.625 ms units.
  advertising->setMaxInterval(0x1e0);
  advertising->enableScanResponse(true);
  badge::scanResponse(scanPacket);
  NimBLEAdvertisementData scanData;
  if (!scanData.addData(scanPacket, sizeof(scanPacket)) ||
      !advertising->setScanResponseData(scanData)) {
    shutdownRadio();
    return false;
  }
  radioReady = true;
  return true;
}

void failRadio() {
  available = false;
  enableRequested = false;
  radioFault = true;
  shutdownRadio();
  Serial.println("STATE error; restart required");
  badgecloud::publish(false);
  drawScreen();
}

bool stopBroadcast() {
  if (!available) return true;
  if (!advertising || !advertising->stop() || advertising->isAdvertising()) return false;
  available = false;
  return true;
}

void startFreshSession() {
  if (!radioReady || radioFault || !charm::kProvisioned) return;
  if (!available && !badgecloud::canShare()) { screen = CharmScreen::SharingOff; drawScreen(); return; }
  if (!stopBroadcast()) {
    failRadio();
    return;
  }
  esp_fill_random(sessionId, sizeof(sessionId));
  for (size_t i = 0; i < sizeof(sessionId); ++i) {
    snprintf(sessionHex + i * 2, 3, "%02x", sessionId[i]);
  }
  badge::advertisement(advertisingPacket, sessionId);
  ble_addr_t address;
  // Rotate only the transport address/token. The owner-bound AprilTag is fixed.
  // NimBLE's GAP calls confirm each controller operation before returning.
  NimBLEAdvertisementData data;
  if (ble_hs_id_gen_rnd(1, &address) != 0 ||
      !NimBLEDevice::setOwnAddr(address.val) ||
      !NimBLEDevice::setOwnAddrType(BLE_OWN_ADDR_RANDOM) ||
      !data.addData(advertisingPacket, sizeof(advertisingPacket)) ||
      !advertising->setAdvertisementData(data) ||
      !advertising->start() || !advertising->isAdvertising()) {
    failRadio();
    return;
  }
  available = true;
  enableRequested = false;
  sessionStarted = millis();
  Serial.printf("STATE available session=%s expires_in_seconds=120\n", sessionHex);
  badgecloud::publish(true, sessionHex, sessionStarted);
  drawScreen();
}

void pauseBadge() {
  enableRequested = false;
  screen = CharmScreen::SharingOff;
  if (radioFault) { drawScreen(); return; }
  if (!stopBroadcast()) {
    failRadio();
    return;
  }
  memset(sessionId, 0, sizeof(sessionId));
  memset(sessionHex, 0, sizeof(sessionHex));
  Serial.println("STATE paused");
  badgecloud::publish(false);
  drawScreen();
}

void pressMiddleButton() {
  if ((screen == CharmScreen::Tag && available) || enableRequested) {
    pauseBadge();
  } else {
    // From Home, this button opens the tag even if sharing was already on.
    // From Sharing Off it starts a new radio session with the same visual ID.
    if (available) {
      screen = CharmScreen::Tag;
      drawScreen();
    } else if (badgecloud::canShare()) {
      screen = CharmScreen::Tag;
      startFreshSession();
    } else {
      screen = CharmScreen::SharingOff;
      enableRequested = radioReady && !radioFault && charm::kProvisioned &&
                        badgecloud::canWaitForSharing();
      enableRequestedAt = millis();
      drawScreen();
    }
  }
}

void powerOffBadge() {
  enableRequested = false;
  if (radioReady) {
    if (!stopBroadcast()) failRadio();
    if (radioReady) shutdownRadio();
  }
  available = false;
  radioReady = false;
  memset(sessionId, 0, sizeof(sessionId));
  memset(sessionHex, 0, sizeof(sessionHex));
  badgecloud::publish(false);
  poweringOff = true;
  powerOffStarted = millis();
  drawScreen();
}

void finishPowerOffBadge() {
  M5.Power.powerOff();
  esp_deep_sleep_start();
}

void setup() {
  auto cfg = M5.config();
  cfg.internal_spk = false;
  cfg.internal_mic = false;
  cfg.internal_rtc = false;  // NTP sets UTC; omit the unused RTC/timezone path.
  M5.begin(cfg);
  Serial.begin(115200);
  M5.Display.setRotation(1);
  M5.Display.setBrightness(100);
  M5.Display.setTextWrap(false);
  badgecloud::begin();
  drawScreen();
  if (!initializeRadio()) {
    failRadio();
    return;
  }
  badgecloud::printDiagnostics();
  Serial.printf("SidebySide badge ready. service=%s\n", badge::kServiceUuid);
  Serial.printf("Companion Charm tag36h11=%d; boot sharing off\n", charm::kTagId);
  Serial.println("USB controls: a=sharing-on p=sharing-off h=home b=middle s=status x=power-off");
}

void loop() {
  M5.update();
  if (badgecloud::poll() && !(available && screen == CharmScreen::Tag)) drawScreen();
  if (available && badgecloud::mustPause()) pauseBadge();
  if (poweringOff) {
    // Local broadcasting is already stopped. Give a pending cloud pause a
    // bounded chance to finish without freezing the display/event loop.
    if ((!badgecloud::enabled() && millis() - powerOffStarted >= 300) ||
        badgecloud::pauseAcknowledged() || millis() - powerOffStarted >= 4000) {
      finishPowerOffBadge();
    }
    delay(10);
    return;
  }
  if (M5.BtnC.wasPressed()) {
    powerOffBadge();
    return;
  } else if (M5.BtnA.wasPressed()) {
    enableRequested = false;
    screen = CharmScreen::Home;
    drawScreen();
  } else if (M5.BtnB.wasPressed()) {
    pressMiddleButton();
  }
  if (Serial.available()) {
    switch (Serial.read()) {
      case 'a': screen = CharmScreen::Tag; if (!available) startFreshSession(); else drawScreen(); break;
      case 'p': pauseBadge(); break;
      case 'h': enableRequested = false; screen = CharmScreen::Home; drawScreen(); break;
      case 'b': pressMiddleButton(); break;
      case 'x': powerOffBadge(); break;
      case 's': Serial.printf("STATE %s screen=%s tag=%d session=%s pending=%d %s\n", radioFault ? "error" : available ? "available" : "paused", screenLabel(), charm::kTagId, sessionHex, enableRequested, badgecloud::statusLabel()); badgecloud::printDiagnostics(); break;
    }
  }
  // Process cancellation before fulfilling a request, including when the
  // connection recovers on the same frame as a Home/Middle/Power press.
  if (enableRequested && !poweringOff) {
    if (!badgecloud::canWaitForSharing() ||
        static_cast<uint32_t>(millis() - enableRequestedAt) >= 30000) {
      enableRequested = false;
      drawScreen();
    } else if (badgecloud::canShare()) {
      enableRequested = false;
      screen = CharmScreen::Tag;
      startFreshSession();
    }
  }
  if (available && static_cast<uint32_t>(millis() - sessionStarted) >= badge::kRotationMs) {
    startFreshSession();
  }
  delay(10);
}
