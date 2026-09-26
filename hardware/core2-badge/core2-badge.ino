#include <M5Unified.h>
#include <esp_bt.h>
#include <NimBLEDevice.h>
#include <nvs_flash.h>
#include <esp_random.h>
#include <esp_sleep.h>
#include "badge_cloud.h"
#include "badge_protocol.h"
#include "charm_identity.h"

// NimBLE pulls in Arduino's Bluetooth controller support, including the strong
// btInUse marker that keeps Bluetooth memory available before setup().

bool tagScreen = false;
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

void drawScreen() {
  if (available && tagScreen && !poweringOff && !radioFault) {
    drawStableCompanionTag();
    return;
  }
  M5.Display.fillScreen(BLACK);
  if (poweringOff) {
    centerText("Powering off...", 100, 2, WHITE);
    centerText(badgecloud::statusLabel(), 140, 1, TFT_LIGHTGREY);
    return;
  }
  centerText("Companion Charm", 16, 2, WHITE);
  centerText(charm::kDisplayName, 58, 3, WHITE);
  char identity[40];
  if (charm::kProvisioned) snprintf(identity, sizeof(identity), "Your special ID: %d", charm::kTagId);
  else snprintf(identity, sizeof(identity), "Pair this charm to get your ID");
  centerText(identity, 97, 1, TFT_LIGHTGREY);
  uint16_t color = radioFault ? TFT_RED : available ? TFT_GREEN : TFT_LIGHTGREY;
  centerText(radioFault ? "BLUETOOTH ERROR" : available ? "Sharing on" : "Sharing off", 128, 2, color);
  centerText(available ? "Middle button turns sharing off" : "Middle button shows your AprilTag", 159, 1, TFT_LIGHTGREY);
  centerText(badgecloud::statusLabel(), 181, 1, TFT_LIGHTGREY);
  M5.Display.drawFastHLine(16, 207, 288, TFT_DARKGREY);
  M5.Display.setTextSize(1);
  M5.Display.setTextColor(WHITE, BLACK);
  M5.Display.setCursor(26, 222);
  M5.Display.print("HOME");
  M5.Display.setCursor(125, 222);
  M5.Display.print(available ? "SHARING OFF" : "TAG / ON");
  M5.Display.setCursor(262, 222);
  M5.Display.print("POWER");
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
  if (!available && !badgecloud::canShare()) { tagScreen = false; drawScreen(); return; }
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
  sessionStarted = millis();
  Serial.printf("STATE available session=%s expires_in_seconds=120\n", sessionHex);
  badgecloud::publish(true, sessionHex, sessionStarted);
  drawScreen();
}

void pauseBadge() {
  tagScreen = false;
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

void powerOffBadge() {
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
  if (badgecloud::poll() && !(available && tagScreen)) drawScreen();
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
    tagScreen = false;
    drawScreen();
  } else if (M5.BtnB.wasPressed()) {
    if (available) pauseBadge();
    else { tagScreen = true; startFreshSession(); }
  }
  if (Serial.available()) {
    switch (Serial.read()) {
      case 'a': if (!available) { tagScreen = true; startFreshSession(); } break;
      case 'p': pauseBadge(); break;
      case 'h': tagScreen = false; drawScreen(); break;
      case 'b': if (available) pauseBadge(); else { tagScreen = true; startFreshSession(); } break;
      case 'x': powerOffBadge(); break;
      case 's': Serial.printf("STATE %s screen=%s tag=%d session=%s %s\n", radioFault ? "error" : available ? "available" : "paused", tagScreen && available ? "tag" : "home", charm::kTagId, sessionHex, badgecloud::statusLabel()); badgecloud::printDiagnostics(); break;
    }
  }
  if (available && static_cast<uint32_t>(millis() - sessionStarted) >= badge::kRotationMs) {
    startFreshSession();
  }
  delay(10);
}
