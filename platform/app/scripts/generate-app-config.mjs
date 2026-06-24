#!/usr/bin/env node
/**
 * Generates build-time config from platform/app/.env and process.env.
 * Substitutes %%ENV_VAR%% placeholders in public/config/default.js.
 * Never put credentials or API keys here — URLs and non-secret deployment settings only.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');
const templatePath = path.join(appRoot, 'public', 'config', 'default.js');
const staticWebAppTemplatePath = path.join(appRoot, 'staticwebapp.config.json');
const envPath = path.join(appRoot, '.env');

/** Injected into default.js at build time. */
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
];

const REQUIRED_IN_PRODUCTION = [
  'MED_PACS_DICOMWEB_API_ROOT',
  'MED_PACS_DICOMWEB_WADOURI_ROOT',
  'AZURE_DICOM_SERVICE_URL',
  'RIS_PROD_PORTAL_ORIGIN',
  'RIS_PROD_API_BASE',
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
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function substitutePlaceholders(template, env) {
  let out = template;
  for (const key of ENV_KEYS) {
    const placeholder = `%%${key}%%`;
    const value = env[key];
    if (value != null && String(value).trim() !== '') {
      out = out.split(placeholder).join(String(value).trim());
    }
  }
  return out;
}

function assertNoClientSecrets(content, label) {
  const forbidden = [
    { name: 'DEMO_TOKEN', re: /DEMO_TOKEN\s*[=:]/i },
    { name: 'EXTERNAL_VIEWER_BASIC_TOKEN', re: /EXTERNAL_VIEWER_BASIC_TOKEN\s*[=:]/i },
    { name: 'SHARE_LINK_BASIC_TOKEN', re: /SHARE_LINK_BASIC_TOKEN\s*[=:]/i },
    { name: 'keyImagesBasicAuthToken', re: /keyImagesBasicAuthToken\s*[=:]/i },
    { name: 'YOUR_AZURE_DICOM', re: /YOUR_AZURE_DICOM_TOKEN_HERE/ },
    { name: 'pentest_token', re: /QjdYOVYzTFEyWlc4TTZSRkQwSjVQWVQ0S04xR0hTVTpaNE0xSzlGOFFYN1RSRDVXMkxDVjBCSk42U0dZSFAz/ },
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
  if (process.env.NODE_ENV !== 'production') {
    return;
  }
  const missing = REQUIRED_IN_PRODUCTION.filter(
    key => !env[key] || String(env[key]).trim() === ''
  );
  if (missing.length > 0) {
    console.error(
      '[generate-app-config] Production build missing required env vars:\n  ' +
        missing.join('\n  ')
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

const staticWebAppOnly = process.argv.includes('--staticwebapp-only');
const env = { ...process.env, ...loadDotEnv(envPath) };

if (staticWebAppOnly) {
  generateStaticWebAppConfig(env);
  process.exit(0);
}

assertProductionEnv(env);

let template = fs.readFileSync(templatePath, 'utf8');
template = substitutePlaceholders(template, env);
assertNoClientSecrets(template, 'app-config output');

const outArg = process.argv.slice(2).find(arg => !arg.startsWith('-') && arg.endsWith('.js'));
if (outArg) {
  const outPath = path.isAbsolute(outArg) ? outArg : path.resolve(appRoot, outArg);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, template, 'utf8');
  console.log(`[generate-app-config] Wrote ${outPath}`);
} else {
  process.stdout.write(template);
}
