#include "badge_cloud.h"

#if __has_include("badge_config.h")
#include "badge_config.h"
#define BADGE_CLOUD_ENABLED 1
#else
#define BADGE_CLOUD_ENABLED 0
#endif

#if BADGE_CLOUD_ENABLED
#include <Arduino.h>
#include <HTTPClient.h>
#include <NetworkClientSecure.h>
#include <Preferences.h>
#include <WiFi.h>
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
};
struct Result {
  uint32_t revision;
  uint32_t createdAt;
  Status status;
};
QueueHandle_t desiredQueue = nullptr;
QueueHandle_t resultQueue = nullptr;
DesiredState desired = {0, false};
Status status = Status::ConfigError;
uint32_t acknowledgedAt = 0;
bool started = false;

bool terminal(Status value) {
  return value == Status::AuthError || value == Status::SequenceError ||
         value == Status::ConfigError;
}

void report(Status value, const DesiredState& state, uint32_t createdAt) {
  Result result = {state.revision, createdAt, value};
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

int sendState(const DesiredState& state, uint64_t sequence, bool https) {
  NetworkClientSecure secure;
  NetworkClient plain;
  HTTPClient http;
  String url = BADGE_API_BASE_URL;
  while (url.endsWith("/")) url.remove(url.length() - 1);
  url += "/v1/badges/state";
  if (https) {
    secure.setCACert(BADGE_API_ROOT_CA);
    secure.setHandshakeTimeout(3);
  }
  NetworkClient& client = https ? static_cast<NetworkClient&>(secure) : plain;
  if (!http.begin(client, url)) return -1;
  http.setConnectTimeout(2000);
  http.setTimeout(2000);
  // Never forward the device credential to a redirect destination.
  http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
  http.setReuse(false);
  http.addHeader("Authorization", String("Bearer ") + BADGE_DEVICE_TOKEN);
  http.addHeader("Content-Type", "application/json");
  char body[100];
  snprintf(body, sizeof(body), "{\"state\":\"%s\",\"sequence\":%llu}",
           state.available ? "available" : "paused",
           static_cast<unsigned long long>(sequence));
  int code = http.PUT(reinterpret_cast<uint8_t*>(body), strlen(body));
  http.end();
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
  if (https) configTime(0, 0, "pool.ntp.org", "time.nist.gov");
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
      int code = sendState(current, sequence, https);
      now = millis();
      if (code == 200) {
        report(Status::Synced, current, createdAt);
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

void publish(bool available) {
  desired.available = available;
  ++desired.revision;
  if (!started) return;
  if (!terminal(status)) status = Status::Syncing;
  xQueueOverwrite(desiredQueue, &desired);
}

bool poll() {
  Status previous = status;
  Result result;
  if (resultQueue && xQueueReceive(resultQueue, &result, 0) == pdTRUE &&
      (terminal(result.status) || result.revision == desired.revision)) {
    status = result.status;
    if (status == Status::Synced) acknowledgedAt = result.createdAt;
  }
  // A duplicate retry does not renew the server lease: measure freshness from
  // when that sequence was created, never from when its reply was received.
  if (status == Status::Synced && badge::elapsed(millis(), acknowledgedAt, badge::kSyncFreshMs)) {
    status = Status::Offline;
  }
  return status != previous;
}

const char* statusLabel() {
  switch (status) {
    case Status::Syncing: return "CLOUD: SYNCING";
    case Status::Synced: return "CLOUD: SYNCED";
    case Status::Offline: return "CLOUD: OFFLINE";
    case Status::ClockWait: return "CLOUD: WAIT FOR CLOCK";
    case Status::AuthError: return "CLOUD: CHECK DEVICE KEY";
    case Status::SequenceError: return "CLOUD: REPROVISION BADGE";
    default: return "CLOUD: CONFIG ERROR";
  }
}
bool enabled() { return started; }
bool pauseAcknowledged() { return !desired.available && status == Status::Synced; }
}  // namespace badgecloud

#else
namespace badgecloud {
void begin() {}
void publish(bool) {}
bool poll() { return false; }
const char* statusLabel() { return "CLOUD: NOT CONFIGURED"; }
bool enabled() { return false; }
bool pauseAcknowledged() { return false; }
}  // namespace badgecloud
#endif
