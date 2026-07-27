#!/usr/bin/env node
/**
 * Generates public/config/.build-app-config.js from default.js + non-secret env
 * (platform/app/.env in dev, process.env in CI). Served as app-config.js.
 *
 * NEVER write credentials (DEMO_TOKEN, Basic auth, etc.) into client artifacts —
 * anything in the browser is public. Demo auth uses short-lived RIS JWTs at runtime.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');
const staticWebAppTemplatePath = path.join(appRoot, 'staticwebapp.config.json');
const envPath = path.join(appRoot, '.env');
const defaultConfigPath = path.join(appRoot, 'public', 'config', 'default.js');
const buildAppConfigOutPath = path.join(appRoot, 'public', 'config', '.build-app-config.js');
const legacyBuildEnvPath = path.join(appRoot, 'public', 'config', '.build-env.js');

const isProduction = process.env.NODE_ENV === 'production';

/** Public (non-secret) keys written to window.__OHIF_BUILD_ENV__. */
const ENV_KEYS = [
  'MED_PACS_DICOMWEB_API_ROOT',
  'MED_PACS_DICOMWEB_WADOURI_ROOT',
  'AZURE_DICOM_SERVICE_URL',
  'RIS_DEV_PORTAL_ORIGIN',
  'RIS_PROD_PORTAL_ORIGIN',
  'RIS_DEV_API_BASE',
  'RIS_PROD_API_BASE',
  'DEMO_STUDY_UID',
  'VIEWER_IS_DEV',
  'REACT_APP_RIS_WORKLIST_URL',
  'REACT_APP_RIS_LOGIN_URL',
  'REACT_APP_RIS_API_BASE',
  'REACT_APP_BACKEND_HOTKEY_URL',
  'CSP_FRAME_ANCESTORS',
  'RIS_AUTH_SESSION_ENABLED',
];

/** Never included in production client config. */
const LOCAL_DEV_ONLY_KEYS = new Set([
  'RIS_DEV_PORTAL_ORIGIN',
  'RIS_DEV_API_BASE',
  'VIEWER_IS_DEV',
]);

const REQUIRED_IN_PRODUCTION = [
  'MED_PACS_DICOMWEB_API_ROOT',
  'MED_PACS_DICOMWEB_WADOURI_ROOT',
  'AZURE_DICOM_SERVICE_URL',
  'RIS_PROD_PORTAL_ORIGIN',
  'RIS_PROD_API_BASE',
  'DEMO_STUDY_UID',
];

function loadDotEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  const raw = fs.readFileSync(file, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function resolveBuildEnvSource() {
  if (isProduction) {
    return { ...process.env };
  }
  return { ...process.env, ...loadDotEnv(envPath) };
}

function buildEnvObject(env) {
  const out = {};
  for (const key of ENV_KEYS) {
    if (isProduction && LOCAL_DEV_ONLY_KEYS.has(key)) {
      continue;
    }
    const value = env[key];
    if (value != null && String(value).trim() !== '') {
      out[key] = String(value).trim();
    }
  }
  return out;
}

function assertNoClientSecrets(content, label, envObject = null) {
  if (envObject && Object.prototype.hasOwnProperty.call(envObject, 'DEMO_TOKEN')) {
    console.error(`[generate-app-config] Refusing to write ${label}: DEMO_TOKEN must not be client-visible`);
    process.exit(1);
  }
  const forbidden = [
    { name: 'DEMO_TOKEN_ASSIGN', re: /["']DEMO_TOKEN["']\s*:/ },
    { name: 'EXTERNAL_VIEWER_BASIC_TOKEN', re: /EXTERNAL_VIEWER_BASIC_TOKEN\s*[=:]/i },
    { name: 'SHARE_LINK_BASIC_TOKEN', re: /SHARE_LINK_BASIC_TOKEN\s*[=:]/i },
    { name: 'keyImagesBasicAuthToken', re: /keyImagesBasicAuthToken\s*[=:]/i },
    { name: 'YOUR_AZURE_DICOM', re: /YOUR_AZURE_DICOM_TOKEN_HERE/ },
    {
      name: 'pentest_demo_basic',
      re: /QjdYOVYzTFEyWlc4TTZSRkQwSjVQWVQ0S04xR0hTVTpaNE0xSzlGOFFYN1RSRDVXMkxDVjBCSk42U0dZSFAz/,
    },
  ];
  const hits = forbidden.filter(p => p.re.test(content)).map(p => p.name);
  if (hits.length > 0) {
    console.error(
      `[generate-app-config] Refusing to write ${label}: forbidden credential patterns: ${hits.join(', ')}`
    );
    process.exit(1);
  }
}

function assertProductionEnv(env) {
  if (!isProduction) {
    return;
  }
  const missing = REQUIRED_IN_PRODUCTION.filter(key => !env[key] || String(env[key]).trim() === '');
  if (missing.length > 0) {
    console.error(
      '[generate-app-config] Production build missing required env vars:\n  ' + missing.join('\n  ')
    );
    process.exit(1);
  }
}

function resolveCspFrameAncestors(env) {
  const explicit = env.CSP_FRAME_ANCESTORS?.trim();
  if (explicit) {
    return explicit;
  }
  const portal = env.RIS_PROD_PORTAL_ORIGIN?.trim();
  if (portal) {
    return `'self' ${portal}`;
  }
  return "'self'";
}

function generateStaticWebAppConfig(env) {
  if (!fs.existsSync(staticWebAppTemplatePath)) {
    return;
  }
  const template = fs.readFileSync(staticWebAppTemplatePath, 'utf8');
  const csp = resolveCspFrameAncestors(env);
  const output = template.replace(/%%CSP_FRAME_ANCESTORS%%/g, csp);
  const distPath = path.join(appRoot, 'dist', 'staticwebapp.config.json');
  fs.mkdirSync(path.dirname(distPath), { recursive: true });
  fs.writeFileSync(distPath, output, 'utf8');
  console.log(`[generate-app-config] Wrote ${distPath}`);
}

function buildAppConfigContent(envObject) {
  if (!fs.existsSync(defaultConfigPath)) {
    console.error(`[generate-app-config] Missing ${defaultConfigPath}`);
    process.exit(1);
  }
  const defaultJs = fs.readFileSync(defaultConfigPath, 'utf8');
  const preamble = [
    '/** Generated by scripts/generate-app-config.mjs — do not edit or commit. */',
    '/** Public deployment settings only — never credentials. */',
    '(function (g) {',
    `  g.__OHIF_BUILD_ENV__ = ${JSON.stringify(envObject, null, 2)};`,
    "})(typeof window !== 'undefined' ? window : globalThis);",
    '',
  ].join('\n');
  return preamble + defaultJs;
}

function writeBuildAppConfig(envObject, outPath) {
  const content = buildAppConfigContent(envObject);
  assertNoClientSecrets(content, path.basename(outPath), envObject);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, content, 'utf8');
}

function removeLegacyBuildEnvArtifacts() {
  for (const p of [
    legacyBuildEnvPath,
    path.join(appRoot, 'dist', 'build-env.js'),
  ]) {
    if (fs.existsSync(p)) {
      fs.unlinkSync(p);
      console.log(`[generate-app-config] Removed legacy ${p}`);
    }
  }
}

const staticWebAppOnly = process.argv.includes('--staticwebapp-only');
const emitDistOnly = process.argv.includes('--emit-dist-only');
const env = resolveBuildEnvSource();

if (staticWebAppOnly) {
  generateStaticWebAppConfig(env);
  process.exit(0);
}

assertProductionEnv(env);
const buildEnv = buildEnvObject(env);

if (emitDistOnly) {
  const distAppConfigPath = path.join(appRoot, 'dist', 'app-config.js');
  writeBuildAppConfig(buildEnv, distAppConfigPath);
  removeLegacyBuildEnvArtifacts();
  console.log(`[generate-app-config] Wrote ${distAppConfigPath}`);
  process.exit(0);
}

writeBuildAppConfig(buildEnv, buildAppConfigOutPath);
removeLegacyBuildEnvArtifacts();
console.log(`[generate-app-config] Wrote ${buildAppConfigOutPath}`);
