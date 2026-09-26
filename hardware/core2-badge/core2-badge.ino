#include <M5Unified.h>
#include <esp_bt.h>
#include <esp_bt_main.h>
#include <esp_gap_ble_api.h>
#include <esp_random.h>
#include <esp_sleep.h>
#include <freertos/event_groups.h>
#include "badge_cloud.h"
#include "badge_protocol.h"
#include "charm_identity.h"

// Arduino's weak default releases all Bluetooth memory before setup(). The
// BLEDevice wrapper previously supplied this override; direct GAP needs it too.
extern "C" bool btInUse() { return true; }

bool tagScreen = false;
constexpr EventBits_t ADDRESS_READY = 1 << 0;
constexpr EventBits_t DATA_READY = 1 << 1;
constexpr EventBits_t SCAN_READY = 1 << 2;
constexpr EventBits_t STARTED = 1 << 3;
constexpr EventBits_t STOPPED = 1 << 4;
constexpr EventBits_t FAILED = 1 << 5;

EventGroupHandle_t radioEvents = nullptr;
esp_ble_adv_params_t advertisingParameters = {};
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

void gapEvent(esp_gap_ble_cb_event_t event, esp_ble_gap_cb_param_t* param) {
  EventBits_t bit = 0;
  esp_bt_status_t status = ESP_BT_STATUS_SUCCESS;
  switch (event) {
    case ESP_GAP_BLE_SET_STATIC_RAND_ADDR_EVT:
      bit = ADDRESS_READY;
      status = param->set_rand_addr_cmpl.status;
      break;
    case ESP_GAP_BLE_ADV_DATA_RAW_SET_COMPLETE_EVT:
      bit = DATA_READY;
      status = param->adv_data_raw_cmpl.status;
      break;
    case ESP_GAP_BLE_SCAN_RSP_DATA_RAW_SET_COMPLETE_EVT:
      bit = SCAN_READY;
      status = param->scan_rsp_data_raw_cmpl.status;
      break;
    case ESP_GAP_BLE_ADV_START_COMPLETE_EVT:
      bit = STARTED;
      status = param->adv_start_cmpl.status;
      break;
    case ESP_GAP_BLE_ADV_STOP_COMPLETE_EVT:
      bit = STOPPED;
      status = param->adv_stop_cmpl.status;
      break;
    default:
      return;
  }
  // Never draw, block, or reconfigure Bluetooth from its callback task.
  xEventGroupSetBits(radioEvents, status == ESP_BT_STATUS_SUCCESS ? bit : FAILED);
}

bool waitForRadio(esp_err_t result, EventBits_t expected) {
  if (result != ESP_OK) {
    Serial.printf("BLE request failed: %s\n", esp_err_to_name(result));
    return false;
  }
  EventBits_t bits = xEventGroupWaitBits(radioEvents, expected | FAILED, pdTRUE, pdFALSE, pdMS_TO_TICKS(2000));
  if ((bits & FAILED) || !(bits & expected)) {
    Serial.println("BLE operation failed or timed out; disabling radio.");
    return false;
  }
  return true;
}

void shutdownRadio() {
  // Clean up partial initialization too. No GATT client/server or scanner is
  // needed by this advertisement-only badge.
  if (esp_bluedroid_get_status() == ESP_BLUEDROID_STATUS_ENABLED) {
    esp_ble_gap_stop_advertising();
    esp_bluedroid_disable();
  }
  if (esp_bluedroid_get_status() == ESP_BLUEDROID_STATUS_INITIALIZED) {
    esp_bluedroid_deinit();
  }
  if (esp_bt_controller_get_status() == ESP_BT_CONTROLLER_STATUS_ENABLED) {
    esp_bt_controller_disable();
  }
  if (esp_bt_controller_get_status() == ESP_BT_CONTROLLER_STATUS_INITED) {
    esp_bt_controller_deinit();
  }
  radioReady = false;
}

bool initializeRadio() {
  esp_bt_controller_config_t config = BT_CONTROLLER_INIT_CONFIG_DEFAULT();
  config.mode = ESP_BT_MODE_BLE;
  // Release unused Classic Bluetooth resources before enabling BLE only.
  esp_err_t result = esp_bt_controller_mem_release(ESP_BT_MODE_CLASSIC_BT);
  if (result == ESP_OK) result = esp_bt_controller_init(&config);
  if (result == ESP_OK) result = esp_bt_controller_enable(ESP_BT_MODE_BLE);
  if (result == ESP_OK) result = esp_bluedroid_init();
  if (result == ESP_OK) result = esp_bluedroid_enable();
  if (result == ESP_OK) result = esp_ble_gap_register_callback(gapEvent);
  if (result != ESP_OK) {
    Serial.printf("BLE initialization failed: %s\n", esp_err_to_name(result));
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
  xEventGroupClearBits(radioEvents, STOPPED | FAILED);
  if (!waitForRadio(esp_ble_gap_stop_advertising(), STOPPED)) return false;
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
  esp_bd_addr_t address;
  if (esp_ble_gap_addr_create_nrpa(address) != ESP_OK) {
    failRadio();
    return;
  }
  // Serialize address, payload, and start confirmations. API success alone
  // only means a request was queued, not that advertising is active.
  xEventGroupClearBits(radioEvents, ADDRESS_READY | FAILED);
  if (!waitForRadio(esp_ble_gap_set_rand_addr(address), ADDRESS_READY)) {
    failRadio();
    return;
  }
  xEventGroupClearBits(radioEvents, DATA_READY | FAILED);
  if (!waitForRadio(esp_ble_gap_config_adv_data_raw(advertisingPacket, sizeof(advertisingPacket)), DATA_READY)) {
    failRadio();
    return;
  }
  xEventGroupClearBits(radioEvents, STARTED | FAILED);
  if (!waitForRadio(esp_ble_gap_start_advertising(&advertisingParameters), STARTED)) {
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
  radioEvents = xEventGroupCreate();
  if (!radioEvents) {
    failRadio();
    return;
  }
  if (!initializeRadio()) {
    failRadio();
    return;
  }
  advertisingParameters.adv_int_min = 0x190;  // 250 ms, in 0.625 ms units.
  advertisingParameters.adv_int_max = 0x1e0;
  advertisingParameters.adv_type = ADV_TYPE_SCAN_IND;
  advertisingParameters.own_addr_type = BLE_ADDR_TYPE_RANDOM;
  advertisingParameters.channel_map = ADV_CHNL_ALL;
  advertisingParameters.adv_filter_policy = ADV_FILTER_ALLOW_SCAN_ANY_CON_ANY;
  badge::scanResponse(scanPacket);
  if (!waitForRadio(esp_ble_gap_config_scan_rsp_data_raw(scanPacket, sizeof(scanPacket)), SCAN_READY)) {
    failRadio();
    return;
  }
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
      case 's': Serial.printf("STATE %s screen=%s tag=%d session=%s %s\n", radioFault ? "error" : available ? "available" : "paused", tagScreen && available ? "tag" : "home", charm::kTagId, sessionHex, badgecloud::statusLabel()); break;
    }
  }
  if (available && static_cast<uint32_t>(millis() - sessionStarted) >= badge::kRotationMs) {
    startFreshSession();
  }
  delay(10);
}
