#!/usr/bin/env node
/**
 * CI check — dist/build-env.js must contain DEMO_TOKEN and no local-dev-only keys.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.resolve(__dirname, '../dist/build-env.js');

if (!fs.existsSync(distPath)) {
  console.error(`[verify-build-env] Missing ${distPath}`);
  process.exit(1);
}

const content = fs.readFileSync(distPath, 'utf8');
const marker = '__OHIF_BUILD_ENV__ = ';
const markerIndex = content.indexOf(marker);
if (markerIndex === -1) {
  console.error('[verify-build-env] Could not find __OHIF_BUILD_ENV__ in build-env.js');
  process.exit(1);
}

const jsonStart = content.indexOf('{', markerIndex + marker.length);
const jsonEnd = content.indexOf('};', jsonStart);
if (jsonStart === -1 || jsonEnd === -1) {
  console.error('[verify-build-env] Could not parse __OHIF_BUILD_ENV__ JSON');
  process.exit(1);
}

let buildEnv;
try {
  buildEnv = JSON.parse(content.slice(jsonStart, jsonEnd + 1));
} catch (err) {
  console.error('[verify-build-env] Invalid JSON in build-env.js:', err?.message || err);
  process.exit(1);
}

const localDevKeys = ['RIS_DEV_PORTAL_ORIGIN', 'RIS_DEV_API_BASE', 'VIEWER_IS_DEV'];
const localHits = localDevKeys.filter(key => buildEnv[key] != null && String(buildEnv[key]).trim() !== '');
if (localHits.length > 0) {
  console.error('[verify-build-env] Local-dev-only keys found:', localHits.join(', '));
  process.exit(1);
}

if (!buildEnv.DEMO_TOKEN || !String(buildEnv.DEMO_TOKEN).trim()) {
  console.error('[verify-build-env] DEMO_TOKEN missing or empty in dist/build-env.js');
  console.error('[verify-build-env] Ensure DEMO_TOKEN is set in GitHub environment viewer-frontend secrets.');
  process.exit(1);
}

if (/YOUR_AZURE_DICOM_TOKEN_HERE/i.test(content)) {
  console.error('[verify-build-env] Placeholder credential found in build-env.js');
  process.exit(1);
}

console.log('[verify-build-env] OK — DEMO_TOKEN present, no local-dev keys');
