#!/usr/bin/env node
/**
 * Finding 1 verification — scans source + built config for hardcoded credentials.
 * Writes NDJSON to debug-7da908.log and posts to debug ingest.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(appRoot, '../..');
const logPath = path.join(repoRoot, 'debug-7da908.log');
const ingestUrl = 'http://127.0.0.1:7274/ingest/22d31b93-a5ea-47ab-a371-37f4f88fb2ba';
const sessionId = '7da908';

const SECRET_PATTERNS = [
  { id: 'A', name: 'DEMO_TOKEN', re: /DEMO_TOKEN\s*[=:]/i },
  { id: 'B', name: 'EXTERNAL_VIEWER_BASIC_TOKEN', re: /EXTERNAL_VIEWER_BASIC_TOKEN\s*[=:]/i },
  { id: 'C', name: 'SHARE_LINK_BASIC_TOKEN', re: /SHARE_LINK_BASIC_TOKEN\s*[=:]/i },
  { id: 'D', name: 'keyImagesBasicAuthToken', re: /keyImagesBasicAuthToken\s*[=:]/i },
  { id: 'E', name: 'YOUR_AZURE_DICOM', re: /YOUR_AZURE_DICOM_TOKEN_HERE/ },
  { id: 'F', name: 'exposed_basic_b64', re: /Authorization:\s*Basic\s+[A-Za-z0-9+/=]{20,}/ },
  {
    id: 'G',
    name: 'pentest_token',
    re: /QjdYOVYzTFEyWlc4TTZSRkQwSjVQWVQ0S04xR0hTVTpaNE0xSzlGOFFYN1RSRDVXMkxDVjBCSk42U0dZSFAz/,
  },
];

function log(entry) {
  const line = JSON.stringify({ sessionId, timestamp: Date.now(), ...entry }) + '\n';
  fs.appendFileSync(logPath, line);
  fetch(ingestUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': sessionId },
    body: JSON.stringify({ sessionId, timestamp: Date.now(), ...entry }),
  }).catch(() => {});
}

function scanText(label, text, hypothesisId) {
  const hits = [];
  for (const p of SECRET_PATTERNS) {
    if (p.re.test(text)) hits.push(p.name);
  }
  log({
    hypothesisId,
    location: 'verify-finding1.mjs:scanText',
    message: `scan ${label}`,
    data: { label, hitCount: hits.length, hits, pass: hits.length === 0 },
    runId: 'post-fix',
  });
  return hits;
}

// Generate fresh build-env from .env
execSync('node scripts/generate-app-config.mjs', {
  cwd: appRoot,
  stdio: 'pipe',
});

const defaultJs = fs.readFileSync(path.join(appRoot, 'public/config/default.js'), 'utf8');
const buildEnvJs = fs.readFileSync(path.join(appRoot, 'public/config/.build-env.js'), 'utf8');

scanText('default.js template', defaultJs, 'A');
scanText('.build-env.js', buildEnvJs, 'B');

// app-config.js is a copy of default.js (no env substitution)
const distDir = path.join(appRoot, 'dist');
const distAppConfig = path.join(distDir, 'app-config.js');
const distBuildEnv = path.join(distDir, 'build-env.js');
fs.mkdirSync(distDir, { recursive: true });
fs.copyFileSync(path.join(appRoot, 'public/config/default.js'), distAppConfig);
fs.copyFileSync(path.join(appRoot, 'public/config/.build-env.js'), distBuildEnv);
scanText('dist/app-config.js (deploy artifact)', fs.readFileSync(distAppConfig, 'utf8'), 'L');
scanText('dist/build-env.js (deploy artifact)', fs.readFileSync(distBuildEnv, 'utf8'), 'M');

// JWT flow checks (not secrets)
const jwtChecks = {
  fetchDemoAccessToken: /fetchDemoAccessToken/.test(defaultJs),
  getViewerAccessBearerToken: /getViewerAccessBearerToken/.test(defaultJs),
  usesViewerAccessProxy: /usesViewerAccessProxy/.test(defaultJs),
  getBuildEnv: /function getBuildEnv/.test(defaultJs),
  azurePreferCookieAuth: /AZURE_PACS_PREFER_COOKIE_AUTH\s*=\s*true/.test(defaultJs),
  deprecatedBasicAliasesReturnJwt:
    /function getShareLinkBasicToken\(\)/.test(defaultJs) &&
    /getShareLinkAccessToken\(\)/.test(defaultJs),
};
log({
  hypothesisId: 'H',
  location: 'verify-finding1.mjs:jwtChecks',
  message: 'JWT auth patterns in built config',
  data: jwtChecks,
  runId: 'post-fix',
});

// Production URL still in template? (recon risk, not credential)
const hardcodedAzureInTemplate =
  /med-pacs-dev-dicomcloudwebapi/.test(defaultJs) || /med-pacs-dev-risapi/.test(defaultJs);
log({
  hypothesisId: 'I',
  location: 'verify-finding1.mjs:urls',
  message: 'hardcoded dev Azure URLs in default.js template',
  data: { hardcodedAzureInTemplate, pass: !hardcodedAzureInTemplate },
  runId: 'post-fix',
});

// Try production app-config.js (runtime evidence)
async function checkProduction() {
  try {
    const res = await fetch('https://lens.med-pacs.com/app-config.js', {
      signal: AbortSignal.timeout(15000),
    });
    const body = await res.text();
    const prodHits = [];
    for (const p of SECRET_PATTERNS) {
      if (p.re.test(body)) prodHits.push(p.name);
    }
    log({
      hypothesisId: 'J',
      location: 'verify-finding1.mjs:production',
      message: 'production lens.med-pacs.com app-config.js scan',
      data: {
        status: res.status,
        bodyLength: body.length,
        prodHits,
        demoTokenPresent: /DEMO_TOKEN/.test(body),
        pass: prodHits.length === 0,
        actionRequired: prodHits.length > 0 ? 'deploy_this_branch_and_rotate_backend_token' : null,
      },
      runId: 'post-fix',
    });
  } catch (err) {
    log({
      hypothesisId: 'J',
      location: 'verify-finding1.mjs:production',
      message: 'production fetch failed',
      data: { error: String(err?.message || err) },
      runId: 'post-fix',
    });
  }
}

await checkProduction();
console.log(`[verify-finding1] Wrote logs to ${logPath}`);
