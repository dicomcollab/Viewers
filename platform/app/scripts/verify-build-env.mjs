#!/usr/bin/env node
/**
 * CI check — dist/app-config.js must have required public env, no credentials,
 * and no separate build-env.js artifact.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '../dist');
const distAppConfig = path.join(distDir, 'app-config.js');
const legacyBuildEnv = path.join(distDir, 'build-env.js');

if (fs.existsSync(legacyBuildEnv)) {
  console.error('[verify-build-env] Unexpected dist/build-env.js — credentials must not be shipped as a separate public file');
  process.exit(1);
}

if (!fs.existsSync(distAppConfig)) {
  console.error(`[verify-build-env] Missing ${distAppConfig}`);
  process.exit(1);
}

const content = fs.readFileSync(distAppConfig, 'utf8');
const marker = '__OHIF_BUILD_ENV__ = ';
const markerIndex = content.indexOf(marker);
if (markerIndex === -1) {
  console.error('[verify-build-env] Could not find __OHIF_BUILD_ENV__ in app-config.js');
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
  console.error('[verify-build-env] Invalid JSON in app-config.js:', err?.message || err);
  process.exit(1);
}

const localDevKeys = ['RIS_DEV_PORTAL_ORIGIN', 'RIS_DEV_API_BASE', 'VIEWER_IS_DEV'];
const localHits = localDevKeys.filter(
  key => buildEnv[key] != null && String(buildEnv[key]).trim() !== ''
);
if (localHits.length > 0) {
  console.error('[verify-build-env] Local-dev-only keys found:', localHits.join(', '));
  process.exit(1);
}

const required = [
  'MED_PACS_DICOMWEB_API_ROOT',
  'MED_PACS_DICOMWEB_WADOURI_ROOT',
  'AZURE_DICOM_SERVICE_URL',
  'RIS_PROD_PORTAL_ORIGIN',
  'RIS_PROD_API_BASE',
  'DEMO_STUDY_UID',
];
const missing = required.filter(key => !buildEnv[key] || !String(buildEnv[key]).trim());
if (missing.length > 0) {
  console.error('[verify-build-env] Missing required public env keys:', missing.join(', '));
  process.exit(1);
}

if (buildEnv.DEMO_TOKEN != null || /["']DEMO_TOKEN["']\s*:/.test(content)) {
  console.error('[verify-build-env] DEMO_TOKEN must never appear in client app-config.js');
  process.exit(1);
}

if (/YOUR_AZURE_DICOM_TOKEN_HERE/i.test(content)) {
  console.error('[verify-build-env] Placeholder credential found in app-config.js');
  process.exit(1);
}

if (/QjdYOVYzTFEyWlc4TTZSRkQwSjVQWVQ0S04xR0hTVTpaNE0xSzlGOFFYN1RSRDVXMkxDVjBCSk42U0dZSFAz/.test(content)) {
  console.error('[verify-build-env] Known demo Basic credential found in app-config.js');
  process.exit(1);
}

console.log('[verify-build-env] OK — public env present, no DEMO_TOKEN / build-env.js');
