const { execSync } = require('child_process');

const BACKEND_URL = 'http://localhost:3000';
const PROXY_URL = 'http://localhost:5173';

const results = {
  total: 0,
  passed: 0,
  failed: 0,
  details: []
};

function record(name, category, passed, expected, actual, extra = '') {
  results.total++;
  if (passed) {
    results.passed++;
    console.log(`[PASS] [${category}] ${name}`);
  } else {
    results.failed++;
    console.error(`[FAIL] [${category}] ${name} | Expected: ${expected} | Actual: ${actual} ${extra}`);
  }
  results.details.push({ name, category, passed, expected, actual, extra });
}

async function request(url, options = {}) {
  const start = Date.now();
  try {
    const res = await fetch(url, options);
    const duration = Date.now() - start;
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch (e) {}
    return {
      ok: true,
      status: res.status,
      headers: Object.fromEntries(res.headers.entries()),
      text,
      json,
      duration
    };
  } catch (err) {
    const duration = Date.now() - start;
    return {
      ok: false,
      status: 0,
      error: err.message,
      duration
    };
  }
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('========================================================================');
  console.log('  CHALLENGER 2: EMPIRICAL PROXY ROUTING, STRESS & PM2 RECOVERY SUITE   ');
  console.log('========================================================================\n');

  // -------------------------------------------------------------------------
  // 1. FRONTEND PROXY ROUTING & CLIENT ROOT VERIFICATION
  // -------------------------------------------------------------------------
  console.log('--- 1. Frontend Proxy Routing & Client HTML Verification ---');

  // 1.1 Frontend Root /
  {
    const rootRes = await request(`${PROXY_URL}/`);
    const isHtml = rootRes.status === 200 && rootRes.text.includes('<div id="root">') && rootRes.text.includes('/src/main.tsx');
    record('Frontend Root (5173 /) HTML rendering', 'Proxy Routing', isHtml, 'HTTP 200 with #root and main.tsx', `HTTP ${rootRes.status}, contains #root: ${rootRes.text.includes('<div id="root">')}`);
  }

  // 1.2 Frontend Health Proxy /api/health
  {
    const pHealth = await request(`${PROXY_URL}/api/health`);
    record('Frontend Proxy /api/health', 'Proxy Routing', pHealth.status === 200 && pHealth.json?.ok === true, 'HTTP 200 with { ok: true }', `HTTP ${pHealth.status}, body: ${JSON.stringify(pHealth.json)}`);
  }

  // 1.3 Backend Direct /api/health
  {
    const bHealth = await request(`${BACKEND_URL}/api/health`);
    record('Direct Backend /api/health', 'Backend Health', bHealth.status === 200 && bHealth.json?.ok === true, 'HTTP 200 with { ok: true }', `HTTP ${bHealth.status}, body: ${JSON.stringify(bHealth.json)}`);
  }

  // 1.4 Frontend Auth Signin Proxy
  let adminToken = '';
  {
    const authRes = await request(`${PROXY_URL}/api/auth/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@example.com', password: 'change-me-strong-password' })
    });
    adminToken = authRes.json?.session?.access_token || '';
    record('Frontend Proxy /api/auth/signin', 'Proxy Routing', authRes.status === 200 && !!adminToken, 'HTTP 200 with valid JWT', `HTTP ${authRes.status}, tokenPresent: ${!!adminToken}`);
  }

  // 1.5 Frontend Authenticated Session Proxy
  {
    const sessRes = await request(`${PROXY_URL}/api/auth/session`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    record('Frontend Proxy /api/auth/session (Bearer auth)', 'Proxy Routing', sessRes.status === 200 && sessRes.json?.session?.user?.email === 'admin@example.com', 'HTTP 200 with user email admin@example.com', `HTTP ${sessRes.status}, email: ${sessRes.json?.session?.user?.email}`);
  }

  // 1.6 Frontend Admin System Proxy
  {
    const sysRes = await request(`${PROXY_URL}/api/admin/system`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    record('Frontend Proxy /api/admin/system', 'Proxy Routing', sysRes.status === 200 && typeof sysRes.json?.data?.users?.total === 'number', 'HTTP 200 with system stats payload', `HTTP ${sysRes.status}`);
  }

  // -------------------------------------------------------------------------
  // 2. MALFORMED BODY & ERROR HANDLING VIA PROXY (PORT 5173)
  // -------------------------------------------------------------------------
  console.log('\n--- 2. Malformed Body & Fuzzing via Proxy (5173) ---');

  const proxyMalformedPayloads = [
    { name: 'Truncated JSON', body: '{"email":"admin@example.com","password":' },
    { name: 'Trailing comma JSON', body: '{"email":"admin@example.com","password":"pwd",}' },
    { name: 'Unquoted key JSON', body: '{email:"admin@example.com",password:"pwd"}' },
    { name: 'Single quote JSON', body: "{'email':'admin@example.com','password':'pwd'}" },
    { name: 'Garbage ASCII string', body: 'THIS_IS_NOT_JSON_AT_ALL' },
    { name: 'Binary null characters', body: '{"email":"admin\0@example.com"}' },
    { name: 'Deeply nested object', body: JSON.stringify({ a: { b: { c: { d: { e: { f: { g: 1 } } } } } } }) },
    { name: 'Empty string body', body: '' }
  ];

  for (const tc of proxyMalformedPayloads) {
    const res = await request(`${PROXY_URL}/api/auth/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: tc.body
    });
    const valid4xx = (res.status === 400 || res.status === 401);
    record(`Proxy Malformed Body [${tc.name}]`, 'Proxy Error Handling', valid4xx, 'HTTP 400/401 (Never 500)', `HTTP ${res.status}, body: ${res.text.slice(0, 80)}`);
  }

  // -------------------------------------------------------------------------
  // 3. HIGH-CONCURRENCY PROXY BURST (150 parallel requests)
  // -------------------------------------------------------------------------
  console.log('\n--- 3. High-Concurrency Stress Burst via Proxy (150 requests) ---');

  {
    const burstCount = 150;
    const start = Date.now();
    const burstPromises = Array.from({ length: burstCount }, (_, i) => {
      if (i % 3 === 0) {
        return request(`${PROXY_URL}/api/health`);
      } else if (i % 3 === 1) {
        return request(`${PROXY_URL}/api/auth/session`, {
          headers: { Authorization: `Bearer ${adminToken}` }
        });
      } else {
        return request(`${PROXY_URL}/`);
      }
    });

    const burstResults = await Promise.all(burstPromises);
    const duration = Date.now() - start;
    const successCount = burstResults.filter(r => r.status === 200).length;
    const has500 = burstResults.some(r => r.status >= 500);
    const avgDuration = Math.round(burstResults.reduce((acc, r) => acc + r.duration, 0) / burstCount);

    record(`150 parallel requests through proxy in ${duration}ms (avg ${avgDuration}ms)`, 'Concurrency', successCount === burstCount && !has500, '150/150 HTTP 200, 0 500s', `${successCount}/150 HTTP 200, has500: ${has500}`);
  }

  // -------------------------------------------------------------------------
  // 4. PM2 RECOVERY & PROCESS RESILIENCE TEST
  // -------------------------------------------------------------------------
  console.log('\n--- 4. PM2 Process Recovery & Resilience ---');

  // Test 4.1: API restart recovery
  {
    console.log('Triggering PM2 restart on kasir-api...');
    const restartStart = Date.now();
    execSync('npx pm2 restart kasir-api', { stdio: 'pipe' });

    // Poll until API responds 200 again
    let recovered = false;
    let attempts = 0;
    while (!recovered && attempts < 30) {
      await sleep(200);
      attempts++;
      const check = await request(`${BACKEND_URL}/api/health`);
      if (check.status === 200 && check.json?.ok) {
        recovered = true;
      }
    }
    const recoveryTime = Date.now() - restartStart;
    record(`PM2 kasir-api restart & health recovery (${recoveryTime}ms)`, 'PM2 Resilience', recovered && recoveryTime < 8000, 'Recovered within 8000ms', `Recovered: ${recovered} in ${recoveryTime}ms`);
  }

  // Test 4.2: Frontend restart recovery
  {
    console.log('Triggering PM2 restart on kasir-frontend...');
    const restartStart = Date.now();
    execSync('npx pm2 restart kasir-frontend', { stdio: 'pipe' });

    let recovered = false;
    let attempts = 0;
    while (!recovered && attempts < 30) {
      await sleep(300);
      attempts++;
      const check = await request(`${PROXY_URL}/`);
      if (check.status === 200 && check.text.includes('<div id="root">')) {
        recovered = true;
      }
    }
    const recoveryTime = Date.now() - restartStart;
    record(`PM2 kasir-frontend restart & root recovery (${recoveryTime}ms)`, 'PM2 Resilience', recovered && recoveryTime < 10000, 'Recovered within 10000ms', `Recovered: ${recovered} in ${recoveryTime}ms`);
  }

  // Test 4.3: Post-recovery proxy functionality
  {
    const postHealth = await request(`${PROXY_URL}/api/health`);
    record('Post-restart proxy routing to /api/health', 'PM2 Resilience', postHealth.status === 200 && postHealth.json?.ok === true, 'HTTP 200 { ok: true }', `HTTP ${postHealth.status}`);
  }

  // -------------------------------------------------------------------------
  // SUMMARY & VERDICT
  // -------------------------------------------------------------------------
  console.log('\n========================================================================');
  console.log(`CHALLENGER 2 SUMMARY: ${results.passed}/${results.total} Passed (${results.failed} Failed)`);
  console.log('========================================================================\n');

  if (results.failed > 0) {
    console.error('FINAL VERDICT: REJECT - Detected failures during challenger stress testing.');
    process.exit(1);
  } else {
    console.log('FINAL VERDICT: APPROVE - All proxy routing, malformed handling, concurrency, and PM2 recovery checks PASSED.');
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
