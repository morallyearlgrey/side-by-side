#!/usr/bin/env node
// Use the owner's tag_id from /v1/me; this does not allocate or pair a device.
const fs = require('node:fs');
const path = require('node:path');
const { AprilTagFamily } = require('apriltag');
const familyData = require('apriltag/families/36h11.json');
const [idArg, displayName] = process.argv.slice(2);
const tagId = Number(idArg);
if (!/^\d+$/.test(idArg ?? '') || !Number.isInteger(tagId) || tagId < 0 || tagId > 586 || !displayName || displayName.length > 40 || /[\r\n\x00-\x1f]/.test(displayName)) {
  console.error('Usage: node hardware/generate-charm-identity.cjs <existing-tag-id 0..586> <display-name>');
  process.exit(1);
}
const rows = new AprilTagFamily(familyData).render(tagId).map(row =>
  row.reduce((bits, cell) => (bits << 1) | (cell === 'b' ? 1 : 0), 0));
const output = path.join(__dirname, 'core2-badge', 'badge_identity.h');
fs.writeFileSync(output, `// Generated from the owner's stable tag36h11 record. Do not commit.\n#pragma once\n#include <stdint.h>\nnamespace charm {\nconstexpr bool kProvisioned = true;\nconstexpr char kDisplayName[] = ${JSON.stringify(displayName)};\nconstexpr int kTagId = ${tagId};\nconstexpr uint16_t kTagRows[10] = {${rows.map(row => '0x' + row.toString(16).padStart(3, '0')).join(', ')}};\n}\n`, { mode: 0o600 });
console.log(`Generated tag36h11 #${tagId} identity header. No credentials included.`);
