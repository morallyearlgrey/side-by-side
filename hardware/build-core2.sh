#!/usr/bin/env bash
# Build the provisioned Companion Charm. This script never uploads a device.
set -euo pipefail
umask 077

if [[ "${1:-}" == "--help" ]]; then
  cat <<'HELP'
Usage: hardware/build-core2.sh [private-build-directory]

Validated with ESP32 board package 3.3.5, M5Unified 0.2.23, and M5GFX 0.2.30.
Requires private core2-badge/badge_config.h and badge_identity.h files.

Optional environment variables:
  ARDUINO_CLI          Arduino CLI executable (default: arduino-cli on PATH)
  ARDUINO_CONFIG_FILE  Existing Arduino CLI configuration file
  M5UNIFIED_LIBRARY   Local M5Unified library directory
  M5GFX_LIBRARY       Local M5GFX library directory
  BUILD_JOBS          Parallel compiler jobs (default: 4)

Use fully downloaded local library directories, outside cloud-only folders.
Build output and logs contain device credentials; keep the directory private.
HELP
  exit 0
fi

if [[ $# -gt 1 ]]; then
  printf '%s\n' 'Expected at most one build directory. Use --help.' >&2
  exit 2
fi

hardware_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd -- "$hardware_dir/.." && pwd)"
build_dir="${1:-$repo_dir/artifacts/core2-build}"
cli="${ARDUINO_CLI:-arduino-cli}"
jobs="${BUILD_JOBS:-4}"
fqbn='esp32:esp32:m5stack_core2:PSRAM=disabled'

if ! [[ "$jobs" =~ ^[1-9][0-9]*$ ]]; then
  printf '%s\n' 'BUILD_JOBS must be a positive integer.' >&2
  exit 2
fi
if ! command -v "$cli" >/dev/null 2>&1; then
  printf '%s\n' 'Arduino CLI was not found. Set ARDUINO_CLI to its executable.' >&2
  exit 2
fi
for header in badge_config.h badge_identity.h; do
  if [[ ! -f "$hardware_dir/core2-badge/$header" ]]; then
    printf 'Missing private provisioning file: core2-badge/%s\n' "$header" >&2
    exit 2
  fi
done

args=(compile --fqbn "$fqbn" --jobs "$jobs")
if [[ -n "${ARDUINO_CONFIG_FILE:-}" ]]; then
  args+=(--config-file "$ARDUINO_CONFIG_FILE")
fi
for library in "${M5UNIFIED_LIBRARY:-}" "${M5GFX_LIBRARY:-}"; do
  if [[ -n "$library" ]]; then
    if [[ ! -f "$library/library.properties" ]]; then
      printf 'Not an Arduino library directory: %s\n' "$library" >&2
      exit 2
    fi
    args+=(--library "$library")
  fi
done

mkdir -p -- "$build_dir"
chmod 700 -- "$build_dir"
build_dir="$(cd -- "$build_dir" && pwd)"
# Arduino CLI can clear its build path when a sketch changes. Keep the log in
# this private parent directory so it survives a clean build.
firmware_dir="$build_dir/firmware"
args+=(
  --build-property 'compiler.cpp.extra_flags=-flto -fno-strict-aliasing'
  --build-property 'compiler.c.elf.extra_flags=-flto -fno-strict-aliasing'
  --build-path "$firmware_dir"
  "$hardware_dir/core2-badge"
)
# C++ LTO removes unused M5 paths. Keep C compilation unchanged: enabling C
# LTO breaks this ESP32 core's custom panic handler. The M5 filesystem helper
# uses an empty base extension across translation units, hence no strict aliasing.
printf 'Building Companion Charm for %s\n' "$fqbn"
if "$cli" "${args[@]}" >"$build_dir/compile.log" 2>&1; then
  printf 'Built: %s/core2-badge.ino.bin\n' "$firmware_dir"
  printf 'Private compiler log: %s/compile.log\n' "$build_dir"
else
  printf 'Build failed. Inspect the private log: %s/compile.log\n' "$build_dir" >&2
  exit 1
fi
