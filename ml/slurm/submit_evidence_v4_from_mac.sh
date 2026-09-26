#!/bin/bash
# Authenticate interactively in Mac Terminal. Passwords never enter this file.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ARCHIVE="$ROOT/artifacts/sidebyside-evidence-v4-newton.tar.gz"
HOST="br123310@newton.ist.ucf.edu"
if [[ ! -f "$ARCHIVE" ]]; then
    printf 'Missing prepared transfer bundle: %s\n' "$ARCHIVE" >&2
    exit 2
fi
read -r ARCHIVE_SHA _ < <(shasum -a 256 "$ARCHIVE")
RUN="sidebyside-evidence-v4-$(date -u +%Y%m%dT%H%M%SZ)-$$"
CONTROL_DIR="$(mktemp -d /tmp/sidebyside-ssh.XXXXXX)"
SSH_OPTIONS=(-o ControlMaster=auto -o ControlPersist=60 -o "ControlPath=$CONTROL_DIR/socket" -o ConnectTimeout=15)
cleanup() {
    ssh "${SSH_OPTIONS[@]}" -O exit "$HOST" >/dev/null 2>&1 || true
    rmdir "$CONTROL_DIR" 2>/dev/null || true
}
trap cleanup EXIT
printf 'Uploading frozen Qwen 4B evaluation. Newton may ask for your password.\n'
ssh "${SSH_OPTIONS[@]}" "$HOST" "umask 077; mkdir \"\$HOME/$RUN\""
scp "${SSH_OPTIONS[@]}" "$ARCHIVE" "$HOST:$RUN/bundle.tar.gz"
ssh "${SSH_OPTIONS[@]}" "$HOST" \
    "set -eu; cd \"\$HOME/$RUN\"; printf '%s  %s\\n' '$ARCHIVE_SHA' bundle.tar.gz | sha256sum -c -; tar -xzf bundle.tar.gz; sbatch ml/slurm/evidence_v4.sbatch \"\$HOME/.cache/sidebyside-qwen\""
printf '\nNewton experiment directory: ~/%s\nKeep the Submitted batch job number above.\n' "$RUN"
