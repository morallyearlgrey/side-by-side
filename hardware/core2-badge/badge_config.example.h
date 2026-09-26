#pragma once

// Copy to badge_config.h (gitignored), then fill in this device's values.
// Leave the file absent to build the original local-only BLE prototype.
#define BADGE_WIFI_SSID "your-wifi-name"
#define BADGE_WIFI_PASSWORD "your-wifi-password"
#define BADGE_API_BASE_URL "https://your-api.example.com"
// Obtain with authenticated POST /v1/badges; never use a Supabase service key.
#define BADGE_DEVICE_TOKEN "sbs_badge_<device-uuid>.<device-secret>"

// PEM root CA that validates the API host. Obtain from its certificate issuer.
// Never substitute setInsecure(). The badge uses NTP to validate certificate dates.
static constexpr char BADGE_API_ROOT_CA[] = R"PEM(
-----BEGIN CERTIFICATE-----
PASTE_YOUR_API_ROOT_CA_HERE
-----END CERTIFICATE-----
)PEM";

// DEVELOPMENT ONLY: permits http:// to a trusted LAN API. Sends the device
// credential unencrypted. HTTPS still validates its CA even with this set to 1.
#define BADGE_ALLOW_INSECURE_HTTP 0
