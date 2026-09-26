#include "badge_cloud.h"
#include "charm_identity.h"

#if __has_include("badge_config.h")
#include "badge_config.h"
#define BADGE_CLOUD_ENABLED 1
#else
#define BADGE_CLOUD_ENABLED 0
#endif

#if BADGE_CLOUD_ENABLED
#include <Arduino.h>
#include <Preferences.h>
#include <WiFi.h>
#include <esp_http_client.h>
#include <cJSON.h>
#include <esp_heap_caps.h>
#include <esp_netif_sntp.h>
#include <freertos/queue.h>
#include <mbedtls/sha256.h>
#include <time.h>
#include "badge_sync_policy.h"

#ifndef BADGE_ALLOW_INSECURE_HTTP
#define BADGE_ALLOW_INSECURE_HTTP 0
#endif

namespace {
enum class Status : uint8_t {
  Syncing, Synced, Offline, ClockWait, AuthError, SequenceError, ConfigError
};
struct DesiredState {
  uint32_t revision;
  bool available;
  char session[17];
  uint32_t sessionStarted;
};
struct Result {
  uint32_t revision;
  uint32_t createdAt;
  Status status;
  bool sharingAllowed;
};
QueueHandle_t desiredQueue = nullptr;
QueueHandle_t resultQueue = nullptr;
DesiredState desired = {0, false};
Status status = Status::ConfigError;
uint32_t acknowledgedAt = 0;
bool started = false;
bool sharingAllowed = false;
uint32_t desiredAt = 0;

bool terminal(Status value) {
  return value == Status::AuthError || value == Status::SequenceError ||
         value == Status::ConfigError;
}

void report(Status value, const DesiredState& state, uint32_t createdAt, bool allowed = false) {
  Result result = {state.revision, createdAt, value, allowed};
  xQueueOverwrite(resultQueue, &result);
}

bool reserve(Preferences& preferences, uint64_t& next, uint64_t& end) {
  uint64_t first = 0;
  uint64_t newEnd = 0;
  if (!badge::reserveSequenceBlock(preferences.getULong64("end", 0), first, newEnd)) return false;
  if (preferences.putULong64("end", newEnd) != sizeof(newEnd)) return false;
  next = first;
  end = newEnd;
  return true;
}

struct ResponseBody {
  char data[1536] = {};
  size_t length = 0;
  bool overflow = false;
};

esp_err_t receiveResponse(esp_http_client_event_t* event) {
  auto* body = static_cast<ResponseBody*>(event->user_data);
  if (event->event_id == HTTP_EVENT_ON_DATA && body && event->data_len > 0) {
    size_t count = static_cast<size_t>(event->data_len);
    if (count >= sizeof(body->data) - body->length) body->overflow = true;
    else {
      memcpy(body->data + body->length, event->data, count);
      body->length += count;
      body->data[body->length] = 0;
    }
  }
  return ESP_OK;
}

int sendState(const DesiredState& state, uint64_t sequence, bool https, bool& allowed) {
  String url = BADGE_API_BASE_URL;
  while (url.endsWith("/")) url.remove(url.length() - 1);
  url += "/v1/badges/state";
  char body[256];
  if (state.available) {
    uint32_t age = millis() - state.sessionStarted;
    // Do not register an already expired or nearly expired radio session.
    if (age >= 119000) return -1;
    uint32_t remaining = (120000 - age) / 1000;
    snprintf(body, sizeof(body),
             "{\"state\":\"available\",\"sequence\":%llu,\"session_token\":\"%s\",\"tag_id\":%d,\"marker_size_tenths_mm\":%d,\"remaining_seconds\":%lu}",
             static_cast<unsigned long long>(sequence), state.session, charm::kTagId,
             charm::kMarkerSizeTenthsMm, static_cast<unsigned long>(remaining));
  } else {
    snprintf(body, sizeof(body), "{\"state\":\"paused\",\"sequence\":%llu}",
             static_cast<unsigned long long>(sequence));
  }
  ResponseBody response;
  // The IDF client avoids Arduino HTTPClient's unused cookie/date parser,
  // which consumes scarce instruction RAM on the original ESP32.
  esp_http_client_config_t config = {};
  config.url = url.c_str();
  config.event_handler = receiveResponse;
  config.user_data = &response;
  config.method = HTTP_METHOD_PUT;
  config.timeout_ms = 2000;
  config.disable_auto_redirect = true;  // Never forward a credential elsewhere.
  config.max_authorization_retries = -1;
  config.cert_pem = https ? BADGE_API_ROOT_CA : nullptr;
  config.skip_cert_common_name_check = false;
  config.transport_type = https ? HTTP_TRANSPORT_OVER_SSL : HTTP_TRANSPORT_OVER_TCP;
  config.keep_alive_enable = false;
  esp_http_client_handle_t client = esp_http_client_init(&config);
  if (!client) return -1;
  String authorization = String("Bearer ") + BADGE_DEVICE_TOKEN;
  esp_err_t result = esp_http_client_set_header(client, "Authorization", authorization.c_str());
  if (result == ESP_OK) result = esp_http_client_set_header(client, "Content-Type", "application/json");
  // set_post_field borrows this buffer; it stays alive until perform returns.
  if (result == ESP_OK) result = esp_http_client_set_post_field(client, body, strlen(body));
  if (result == ESP_OK) result = esp_http_client_perform(client);
  int code = badge::httpResultCode(result == ESP_OK, esp_http_client_get_status_code(client));
  esp_http_client_cleanup(client);
  allowed = false;
  if (code == 200) {
    cJSON* json = response.overflow ? nullptr : cJSON_Parse(response.data);
    const cJSON* permission = json ? cJSON_GetObjectItemCaseSensitive(json, "sharing_allowed") : nullptr;
    if (!cJSON_IsBool(permission)) code = 422; // Never assume an old API authorizes sharing.
    else allowed = cJSON_IsTrue(permission);
    cJSON_Delete(json);
  }
  return code;
}

void syncTask(void*) {
  DesiredState current = {0, false};
  Preferences preferences;
  // New credentials get a new counter namespace without retaining their text.
  unsigned char digest[32];
  char storageNamespace[16] = "b";
  if (mbedtls_sha256(reinterpret_cast<const unsigned char*>(BADGE_DEVICE_TOKEN),
                     strlen(BADGE_DEVICE_TOKEN), digest, 0) != 0) {
    report(Status::ConfigError, current, 0);
    vTaskDelete(nullptr);
    return;
  }
  for (size_t i = 0; i < 7; ++i) snprintf(storageNamespace + 1 + 2 * i, 3, "%02x", digest[i]);
  uint64_t next = 0;
  uint64_t end = 0;
  if (!preferences.begin(storageNamespace, false) || !reserve(preferences, next, end)) {
    report(Status::ConfigError, current, 0);
    preferences.end();
    vTaskDelete(nullptr);
    return;
  }

  const bool https = String(BADGE_API_BASE_URL).startsWith("https://");
  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(BADGE_WIFI_SSID, BADGE_WIFI_PASSWORD);
  if (https) {
    // TLS needs UTC epoch time only; no timezone/date-formatting helpers.
    esp_sntp_config_t ntp = ESP_NETIF_SNTP_DEFAULT_CONFIG_MULTIPLE(
        2, ESP_SNTP_SERVER_LIST("pool.ntp.org", "time.nist.gov"));
    ntp.wait_for_sync = false;
    if (esp_netif_sntp_init(&ntp) != ESP_OK) {
      report(Status::ConfigError, current, 0);
      preferences.end();
      vTaskDelete(nullptr);
      return;
    }
  }
  uint32_t wifiAttemptAt = millis();
  uint32_t createdAt = 0;
  uint32_t retryAt = 0;
  uint32_t retryDelay = 1000;
  uint64_t sequence = 0;
  bool pending = false;
  bool failedPermanently = false;
  for (;;) {
    uint32_t now = millis();
    DesiredState latest;
    bool changed = xQueuePeek(desiredQueue, &latest, 0) == pdTRUE &&
                   latest.revision != current.revision;
    if (changed) current = latest;
    if (failedPermanently) {
      vTaskDelay(pdMS_TO_TICKS(100));
      continue;
    }
    if (changed || (current.revision && badge::elapsed(now, createdAt, badge::kHeartbeatMs))) {
      if (next == end && !reserve(preferences, next, end)) {
        report(Status::ConfigError, current, now);
        failedPermanently = true;
        continue;
      }
      sequence = next++;
      createdAt = now;
      retryAt = now;
      retryDelay = 1000;
      pending = true;
    }
    if (WiFi.status() != WL_CONNECTED) {
      report(Status::Offline, current, createdAt);
      if (badge::elapsed(now, wifiAttemptAt, 10000)) {
        WiFi.reconnect();
        wifiAttemptAt = now;
      }
    } else if (https && time(nullptr) < 1700000000) {
      report(Status::ClockWait, current, createdAt);
    } else if (pending && static_cast<int32_t>(now - retryAt) >= 0) {
      // Exactly one request is in flight. A newer local state replaces this
      // snapshot at the next iteration; an old response cannot mark it synced.
      bool allowed = false;
      int code = sendState(current, sequence, https, allowed);
      now = millis();
      if (code == 200) {
        report(Status::Synced, current, createdAt, allowed);
        pending = false;
      } else if (code == 401 || code == 403 || code == 409 ||
                 (code >= 400 && code < 500 && code != 408 && code != 429)) {
        Status failure = code == 401 || code == 403 ? Status::AuthError :
                         code == 409 ? Status::SequenceError : Status::ConfigError;
        report(failure, current, createdAt);
        failedPermanently = true;
      } else {
        report(Status::Offline, current, createdAt);
        retryAt = now + retryDelay;
        retryDelay = retryDelay < 8000 ? retryDelay * 2 : 15000;
      }
    }
    vTaskDelay(pdMS_TO_TICKS(50));
  }
}
}  // namespace

namespace badgecloud {
void begin() {
  String base = BADGE_API_BASE_URL;
  bool https = base.startsWith("https://");
  bool permittedHttp = BADGE_ALLOW_INSECURE_HTTP && base.startsWith("http://");
  if (!strlen(BADGE_WIFI_SSID) || !strlen(BADGE_DEVICE_TOKEN) ||
      (!https && !permittedHttp) || (https && !strlen(BADGE_API_ROOT_CA))) return;
  desiredQueue = xQueueCreate(1, sizeof(DesiredState));
  resultQueue = xQueueCreate(1, sizeof(Result));
  if (!desiredQueue || !resultQueue) return;
  status = Status::Syncing;
  // Reserve enough stack for TLS while leaving display work on the main loop.
  if (xTaskCreate(syncTask, "badge-cloud", 12288, nullptr, 1, nullptr) != pdPASS) {
    status = Status::ConfigError;
    return;
  }
  started = true;
  publish(false);
}

void publish(bool available, const char* session, uint32_t sessionStarted) {
  desired.available = available;
  snprintf(desired.session, sizeof(desired.session), "%s", available && session ? session : "");
  desired.sessionStarted = available ? sessionStarted : 0;
  desiredAt = millis();
  ++desired.revision;
  if (!started) return;
  if (!terminal(status)) status = Status::Syncing;
  xQueueOverwrite(desiredQueue, &desired);
}

bool poll() {
  Status previous = status;
  bool previousPermission = sharingAllowed;
  Result result;
  if (resultQueue && xQueueReceive(resultQueue, &result, 0) == pdTRUE &&
      (terminal(result.status) || result.revision == desired.revision)) {
    status = result.status;
    if (status == Status::Synced) {
      acknowledgedAt = result.createdAt;
      sharingAllowed = result.sharingAllowed;
    }
  }
  // A duplicate retry does not renew the server lease: measure freshness from
  // when that sequence was created, never from when its reply was received.
  if (status == Status::Synced && badge::elapsed(millis(), acknowledgedAt, badge::kSyncFreshMs)) {
    status = Status::Offline;
  }
  return status != previous || sharingAllowed != previousPermission;
}

const char* statusLabel() {
  switch (status) {
    case Status::Syncing: return "CLOUD: SYNCING";
    case Status::Synced: return sharingAllowed ? "CLOUD: CONNECTED" : "TURN ON SHARING IN THE APP";
    case Status::Offline: return "CLOUD: OFFLINE";
    case Status::ClockWait: return "CLOUD: WAIT FOR CLOCK";
    case Status::AuthError: return "CLOUD: CHECK DEVICE KEY";
    case Status::SequenceError: return "CLOUD: REPROVISION BADGE";
    default: return "CLOUD: CONFIG ERROR";
  }
}
bool enabled() { return started; }
bool pauseAcknowledged() { return !desired.available && status == Status::Synced; }
bool canShare() {
  return started && sharingAllowed && status == Status::Synced &&
         !badge::elapsed(millis(), acknowledgedAt, badge::kSyncFreshMs);
}
bool mustPause() {
  if (!desired.available) return false;
  if (terminal(status) || (status == Status::Synced && !sharingAllowed)) return true;
  // Losing contact eventually hides the tag and stops radio transmission.
  return badge::elapsed(millis(), acknowledgedAt, badge::kSyncFreshMs) &&
         badge::elapsed(millis(), desiredAt, badge::kSyncFreshMs);
}
void printDiagnostics() {
  Serial.printf("NETWORK wifi=%s heap=%u largest=%u psram=%u\n",
                WiFi.status() == WL_CONNECTED ? "connected" : "disconnected",
                static_cast<unsigned>(ESP.getFreeHeap()),
                static_cast<unsigned>(heap_caps_get_largest_free_block(MALLOC_CAP_8BIT)),
                static_cast<unsigned>(ESP.getFreePsram()));
}
}  // namespace badgecloud

#else
namespace badgecloud {
void begin() {}
void publish(bool, const char*, uint32_t) {}
bool poll() { return false; }
const char* statusLabel() { return "CLOUD: NOT CONFIGURED"; }
bool enabled() { return false; }
bool pauseAcknowledged() { return false; }
bool canShare() { return false; }
bool mustPause() { return true; }
void printDiagnostics() {}
}  // namespace badgecloud
#endif
