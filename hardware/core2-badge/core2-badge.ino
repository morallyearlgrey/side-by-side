#include <M5Unified.h>
#include <BLEDevice.h>
#include <esp_gap_ble_api.h>
#include <esp_random.h>
#include <esp_sleep.h>
#include <freertos/event_groups.h>
#include "badge_protocol.h"

// Visible on the physical screen only; never included in Bluetooth packets.
constexpr char DISPLAY_NAME[] = "Bryan";
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

void centerText(const char* text, int y, int size, uint16_t color) {
  M5.Display.setTextColor(color, BLACK);
  M5.Display.setTextSize(size);
  while (M5.Display.textWidth(text) > 288 && size > 1) {
    M5.Display.setTextSize(--size);
  }
  M5.Display.setCursor((320 - M5.Display.textWidth(text)) / 2, y);
  M5.Display.print(text);
}

void drawScreen() {
  M5.Display.fillScreen(BLACK);
  centerText("SidebySide", 12, 2, WHITE);
  centerText(DISPLAY_NAME, 55, 4, WHITE);
  uint16_t color = radioFault ? TFT_RED : available ? TFT_GREEN : TFT_LIGHTGREY;
  M5.Display.drawRoundRect(16, 108, 288, 62, 6, color);
  centerText(radioFault ? "BLE ERROR" : available ? "AVAILABLE" : "PAUSED", 129, 3, color);
  centerText(radioFault ? "Restart badge" : available ? sessionHex : "Not broadcasting", 186, 1, TFT_LIGHTGREY);
  M5.Display.drawFastHLine(16, 205, 288, TFT_DARKGREY);
  M5.Display.setTextSize(1);
  M5.Display.setTextColor(WHITE, BLACK);
  M5.Display.setCursor(24, 220);
  M5.Display.print(available ? "PAUSE" : "GO LIVE");
  M5.Display.setCursor(140, 220);
  M5.Display.print("NEW ID");
  M5.Display.setCursor(270, 220);
  M5.Display.print("OFF");
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

void failRadio() {
  available = false;
  radioFault = true;
  if (radioReady) {
    esp_ble_gap_stop_advertising();
    BLEDevice::deinit(false);
    radioReady = false;
  }
  Serial.println("STATE error; restart required");
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
  if (!radioReady || radioFault) return;
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
  drawScreen();
}

void pauseBadge() {
  if (radioFault) return;
  if (!stopBroadcast()) {
    failRadio();
    return;
  }
  memset(sessionId, 0, sizeof(sessionId));
  memset(sessionHex, 0, sizeof(sessionHex));
  Serial.println("STATE paused");
  drawScreen();
}

void powerOffBadge() {
  if (radioReady) {
    stopBroadcast();
    BLEDevice::deinit(false);
  }
  available = false;
  radioReady = false;
  M5.Display.fillScreen(BLACK);
  centerText("Powering off...", 110, 2, WHITE);
  delay(300);
  M5.Power.powerOff();
  esp_deep_sleep_start();
}

void setup() {
  auto cfg = M5.config();
  cfg.internal_spk = false;
  cfg.internal_mic = false;
  M5.begin(cfg);
  Serial.begin(115200);
  M5.Display.setRotation(1);
  M5.Display.setBrightness(100);
  M5.Display.setTextWrap(false);
  drawScreen();
  radioEvents = xEventGroupCreate();
  if (!radioEvents || !BLEDevice::init("SidebySide")) {
    failRadio();
    return;
  }
  radioReady = true;
  BLEDevice::setCustomGapHandler(gapEvent);
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
  Serial.println("STATE paused; USB controls: a=available p=pause n=new-session s=status");
}

void loop() {
  M5.update();
  if (M5.BtnC.wasPressed()) {
    powerOffBadge();
  } else if (M5.BtnA.wasPressed()) {
    if (available) pauseBadge(); else startFreshSession();
  } else if (M5.BtnB.wasPressed()) {
    if (available) startFreshSession();
  } else if (M5.Touch.getCount()) {
    const auto& touch = M5.Touch.getDetail();
    if (touch.wasPressed() && touch.x >= 16 && touch.x < 304 && touch.y >= 108 && touch.y < 170) {
      if (available) pauseBadge(); else startFreshSession();
    }
  }
  if (Serial.available()) {
    switch (Serial.read()) {
      case 'a': if (!available) startFreshSession(); break;
      case 'p': pauseBadge(); break;
      case 'n': if (available) startFreshSession(); break;
      case 's': Serial.printf("STATE %s session=%s\n", radioFault ? "error" : available ? "available" : "paused", sessionHex); break;
    }
  }
  if (available && static_cast<uint32_t>(millis() - sessionStarted) >= badge::kRotationMs) {
    startFreshSession();
  }
  delay(10);
}
