#!/usr/bin/env node
/**
 * Generates app-config.js from public/config/default.js by substituting %%ENV_VAR%% placeholders.
 * Only non-secret deployment URLs belong here — never credentials or API keys.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');
const templatePath = path.join(appRoot, 'public', 'config', 'default.js');
const envPath = path.join(appRoot, '.env');

const URL_ENV_KEYS = [
  'MED_PACS_DICOMWEB_API_ROOT',
  'MED_PACS_DICOMWEB_WADOURI_ROOT',
  'AZURE_DICOM_SERVICE_URL',
  'RIS_DEV_PORTAL_ORIGIN',
  'RIS_PROD_PORTAL_ORIGIN',
  'RIS_DEV_API_BASE',
  'RIS_PROD_API_BASE',
  'REACT_APP_RIS_WORKLIST_URL',
  'REACT_APP_RIS_LOGIN_URL',
  'REACT_APP_RIS_API_BASE',
  'REACT_APP_BACKEND_HOTKEY_URL',
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

const env = { ...process.env, ...loadDotEnv(envPath) };
let template = fs.readFileSync(templatePath, 'utf8');

for (const key of URL_ENV_KEYS) {
  const placeholder = `%%${key}%%`;
  const value = env[key];
  if (value && String(value).trim()) {
    template = template.split(placeholder).join(String(value).trim());
  }
}

const outArg = process.argv[2];
if (outArg) {
  const outPath = path.isAbsolute(outArg)
    ? outArg
    : path.resolve(appRoot, outArg);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, template, 'utf8');
  console.log(`[generate-app-config] Wrote ${outPath}`);
} else {
  process.stdout.write(template);
}
