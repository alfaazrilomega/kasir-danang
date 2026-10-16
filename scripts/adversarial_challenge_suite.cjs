const crypto = require('crypto');

const BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';
const PROXY_URL = process.env.PROXY_BASE_URL || 'http://localhost:5173';

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
  const res = await fetch(url, options);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (e) {}
  return {
    status: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    text,
    json
  };
}

function base64Url(str) {
  return Buffer.from(str).toString('base64url');
}

function createForgedToken(payload, secret = 'dev-only-change-me') {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64Url(JSON.stringify(header));
  const encodedPayload = base64Url(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', secret).update(`${encodedHeader}.${encodedPayload}`).digest('base64url');
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

async function runAdversarialSuite() {
  console.log('================================================================');
  console.log('   EMPIRICAL CHALLENGER: ADVERSARIAL & STRESS TEST SUITE        ');
  console.log('================================================================\n');

  // ==========================================================================
  // CATEGORY 1: Malformed Payloads & Missing Fields & Type Fuzzing
  // ==========================================================================
  console.log('--- CATEGORY 1: Malformed Payloads & Missing Fields ---');

  // 1.1 Empty Body
  {
    const res = await request(`${BASE_URL}/api/auth/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    record('Empty payload in /api/auth/signin', 'Payload Validation', res.status === 400, 'HTTP 400', `HTTP ${res.status}`);
  }

  // 1.2 Missing password
  {
    const res = await request(`${BASE_URL}/api/auth/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@example.com' })
    });
    record('Missing password in /api/auth/signin', 'Payload Validation', res.status === 400, 'HTTP 400', `HTTP ${res.status}`);
  }

  // 1.3 Missing email
  {
    const res = await request(`${BASE_URL}/api/auth/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'somepassword' })
    });
    record('Missing email in /api/auth/signin', 'Payload Validation', res.status === 400, 'HTTP 400', `HTTP ${res.status}`);
  }

  // 1.4 Whitespace only credentials
  {
    const res = await request(`${BASE_URL}/api/auth/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: '   ', password: '   ' })
    });
    record('Whitespace only credentials', 'Payload Validation', res.status === 400 || res.status === 401, 'HTTP 400 or 401', `HTTP ${res.status}`);
  }

  // 1.5 Non-string types (Type Confusion / Fuzzing)
  {
    const res = await request(`${BASE_URL}/api/auth/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 12345, password: { nested: true } })
    });
    record('Type confusion (numbers/objects as email/password)', 'Payload Validation', res.status === 400 || res.status === 401, 'HTTP 400/401 (Never 500)', `HTTP ${res.status}`);
  }

  // 1.6 Array payload instead of object
  {
    const res = await request(`${BASE_URL}/api/auth/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ email: 'admin@example.com', password: 'change-me-strong-password' }])
    });
    record('Array payload in /api/auth/signin', 'Payload Validation', res.status === 400 || res.status === 401, 'HTTP 400/401', `HTTP ${res.status}`);
  }

  // 1.7 Malformed JSON syntax (Raw corrupted bytes)
  {
    const res = await request(`${BASE_URL}/api/auth/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"email": "admin@example.com", "password": '
    });
    record('Malformed raw JSON syntax', 'Payload Validation', res.status === 400, 'HTTP 400', `HTTP ${res.status}`);
  }

  // 1.8 Extremely large oversized payload (50KB)
  {
    const largeStr = 'A'.repeat(50000);
    const res = await request(`${BASE_URL}/api/auth/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `${largeStr}@example.com`, password: largeStr })
    });
    record('Oversized 50KB payload handling', 'Payload Validation', res.status === 400 || res.status === 401, 'HTTP 400/401 (Never 500)', `HTTP ${res.status}`);
  }

  // ==========================================================================
  // CATEGORY 2: SQL Injection & Adversarial Payloads
  // ==========================================================================
  console.log('\n--- CATEGORY 2: SQL Injection & Adversarial Payloads ---');

  const sqliPayloads = [
    { name: "Classic OR '1'='1' in email", email: "' OR '1'='1", pass: "password" },
    { name: "Comment injection admin' --", email: "admin' --", pass: "password" },
    { name: "Stacked query DROP TABLE", email: "admin@example.com'; DROP TABLE app_users; --", pass: "password" },
    { name: "UNION SELECT payload", email: "' UNION SELECT '1', '2', '3' --", pass: "password" },
    { name: "PostgreSQL pg_sleep injection", email: "admin@example.com' AND (SELECT pg_sleep(5))--", pass: "password" },
    { name: "Classic OR in password", email: "admin@example.com", pass: "' OR '1'='1" },
    { name: "Null byte injection in email", email: "admin@example.com\0admin", pass: "password" }
  ];

  for (const sqli of sqliPayloads) {
    const res = await request(`${BASE_URL}/api/auth/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: sqli.email, password: sqli.pass })
    });
    record(`SQLi: ${sqli.name}`, 'Adversarial Injection', res.status === 401 || res.status === 400, 'HTTP 401 or 400 (Never 500)', `HTTP ${res.status}`);
  }

  // ==========================================================================
  // CATEGORY 3: Invalid HTTP Methods
  // ==========================================================================
  console.log('\n--- CATEGORY 3: Invalid HTTP Methods ---');

  const methodTests = [
    { method: 'GET', url: `${BASE_URL}/api/auth/signin`, name: 'GET on /api/auth/signin' },
    { method: 'DELETE', url: `${BASE_URL}/api/auth/signin`, name: 'DELETE on /api/auth/signin' },
    { method: 'POST', url: `${BASE_URL}/api/health`, name: 'POST on /api/health' },
    { method: 'PUT', url: `${BASE_URL}/api/auth/session`, name: 'PUT on /api/auth/session' },
    { method: 'PATCH', url: `${BASE_URL}/api/health`, name: 'PATCH on /api/health' }
  ];

  for (const mt of methodTests) {
    const res = await request(mt.url, { method: mt.method });
    record(mt.name, 'HTTP Method Safety', res.status === 404 || res.status === 405, 'HTTP 404/405 (Never 500)', `HTTP ${res.status}`);
  }

  // ==========================================================================
  // CATEGORY 4: Bearer Token Corruption & Protected Endpoint Hardening
  // ==========================================================================
  console.log('\n--- CATEGORY 4: Bearer Token Adversarial & Tampering Tests ---');

  const protectedEndpoints = [
    '/api/auth/session',
    '/api/auth/user',
    '/api/admin/users',
    '/api/admin/system',
    '/api/admin/audit-logs'
  ];

  // 4.1 Missing Authorization Header
  for (const ep of protectedEndpoints) {
    const res = await request(`${BASE_URL}${ep}`);
    record(`No auth header on ${ep}`, 'Token Security', res.status === 401, 'HTTP 401', `HTTP ${res.status}`);
  }

  // 4.2 Empty Bearer Token
  for (const ep of protectedEndpoints) {
    const res = await request(`${BASE_URL}${ep}`, {
      headers: { Authorization: 'Bearer ' }
    });
    record(`Empty Bearer on ${ep}`, 'Token Security', res.status === 401, 'HTTP 401', `HTTP ${res.status}`);
  }

  // 4.3 Non-Bearer Scheme (Basic Auth)
  for (const ep of protectedEndpoints) {
    const res = await request(`${BASE_URL}${ep}`, {
      headers: { Authorization: 'Basic YWRtaW46cGFzc3dvcmQ=' }
    });
    record(`Non-Bearer scheme on ${ep}`, 'Token Security', res.status === 401, 'HTTP 401', `HTTP ${res.status}`);
  }

  // 4.4 Completely Corrupted / Garbage Token
  for (const ep of protectedEndpoints) {
    const res = await request(`${BASE_URL}${ep}`, {
      headers: { Authorization: 'Bearer totally_garbage_not_a_jwt_token_12345' }
    });
    record(`Garbage token on ${ep}`, 'Token Security', res.status === 401, 'HTTP 401', `HTTP ${res.status}`);
  }

  // 4.5 Malformed 3-part Token with Non-Base64 Characters
  for (const ep of protectedEndpoints) {
    const res = await request(`${BASE_URL}${ep}`, {
      headers: { Authorization: 'Bearer header.payload!invalid!.sig#@$' }
    });
    record(`Malformed 3-part non-base64 on ${ep}`, 'Token Security', res.status === 401, 'HTTP 401', `HTTP ${res.status}`);
  }

  // 4.6 Tampered Signature (Valid header + valid payload + attacker signature)
  {
    const forgedToken = createForgedToken(
      { sub: 'usr-admin-001', email: 'admin@example.com', exp: Math.floor(Date.now() / 1000) + 3600 },
      'wrong-attacker-secret-key-123456789'
    );
    for (const ep of protectedEndpoints) {
      const res = await request(`${BASE_URL}${ep}`, {
        headers: { Authorization: `Bearer ${forgedToken}` }
      });
      record(`Forged secret token on ${ep}`, 'Token Security', res.status === 401, 'HTTP 401', `HTTP ${res.status}`);
    }
  }

  // 4.7 Expired Token (Past timestamp exp)
  {
    const expiredToken = createForgedToken(
      { sub: 'usr-admin-001', email: 'admin@example.com', exp: Math.floor(Date.now() / 1000) - 3600 },
      'dev-only-change-me'
    );
    for (const ep of protectedEndpoints) {
      const res = await request(`${BASE_URL}${ep}`, {
        headers: { Authorization: `Bearer ${expiredToken}` }
      });
      record(`Expired token on ${ep}`, 'Token Security', res.status === 401, 'HTTP 401', `HTTP ${res.status}`);
    }
  }

  // 4.8 Token with zero/missing expiration
  {
    const zeroExpToken = createForgedToken(
      { sub: 'usr-admin-001', email: 'admin@example.com', exp: 0 },
      'dev-only-change-me'
    );
    const res = await request(`${BASE_URL}/api/auth/session`, {
      headers: { Authorization: `Bearer ${zeroExpToken}` }
    });
    record('Token with exp=0', 'Token Security', res.status === 401, 'HTTP 401', `HTTP ${res.status}`);
  }

  // ==========================================================================
  // CATEGORY 5: 4-Role Authentication & RBAC Authorization Enforcement
  // ==========================================================================
  console.log('\n--- CATEGORY 5: 4-Role Session & RBAC Enforcement ---');

  const accounts = [
    { role: 'admin', email: 'admin@example.com', pass: 'change-me-strong-password', expectedAdminAccess: true },
    { role: 'warehouse', email: 'gudang@example.com', pass: 'gudang12345', expectedAdminAccess: false },
    { role: 'cashier', email: 'kasir@example.com', pass: 'kasir12345', expectedAdminAccess: false },
    { role: 'customer', email: 'customer@example.com', pass: 'customer12345', expectedAdminAccess: false }
  ];

  const sessions = {};

  for (const acc of accounts) {
    const loginRes = await request(`${BASE_URL}/api/auth/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: acc.email, password: acc.pass })
    });

    const hasToken = !!loginRes.json?.session?.access_token;
    const token = loginRes.json?.session?.access_token;
    sessions[acc.role] = token;

    record(`Login for role [${acc.role}] (${acc.email})`, 'RBAC & Auth', loginRes.status === 200 && hasToken, 'HTTP 200 with token', `HTTP ${loginRes.status}`);

    if (token) {
      // Test /api/auth/session
      const sessionRes = await request(`${BASE_URL}/api/auth/session`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      record(`Get session for role [${acc.role}]`, 'RBAC & Auth', sessionRes.status === 200, 'HTTP 200', `HTTP ${sessionRes.status}`);

      // Test /api/auth/user
      const userRes = await request(`${BASE_URL}/api/auth/user`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      record(`Get user profile for role [${acc.role}]`, 'RBAC & Auth', userRes.status === 200 && userRes.json?.user?.email === acc.email, 'HTTP 200 with matching email', `HTTP ${userRes.status}`);

      // Test /api/admin/users
      const adminUsersRes = await request(`${BASE_URL}/api/admin/users`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const expectedStatus = acc.expectedAdminAccess ? 200 : 403;
      record(`RBAC /api/admin/users for [${acc.role}]`, 'RBAC & Auth', adminUsersRes.status === expectedStatus, `HTTP ${expectedStatus}`, `HTTP ${adminUsersRes.status}`);

      // Test /api/admin/system
      const adminSysRes = await request(`${BASE_URL}/api/admin/system`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      record(`RBAC /api/admin/system for [${acc.role}]`, 'RBAC & Auth', adminSysRes.status === expectedStatus, `HTTP ${expectedStatus}`, `HTTP ${adminSysRes.status}`);

      // Test /api/admin/audit-logs
      const adminAuditRes = await request(`${BASE_URL}/api/admin/audit-logs`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      record(`RBAC /api/admin/audit-logs for [${acc.role}]`, 'RBAC & Auth', adminAuditRes.status === expectedStatus, `HTTP ${expectedStatus}`, `HTTP ${adminAuditRes.status}`);
    }
  }

  // ==========================================================================
  // CATEGORY 6: Table-Level Query RBAC Access Controls
  // ==========================================================================
  console.log('\n--- CATEGORY 6: Table-Level RBAC Query Permissions ---');

  // Customer attempting POS shift table insert -> should be 403 Forbidden
  if (sessions.customer) {
    const custShiftRes = await request(`${BASE_URL}/api/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessions.customer}`
      },
      body: JSON.stringify({
        table: 'shifts',
        action: 'insert',
        values: { cashier_id: 'usr-customer-001', opening_cash: 100000 }
      })
    });
    record('Customer inserting shift table (POS restriction)', 'Table RBAC', custShiftRes.status === 403, 'HTTP 403 Forbidden', `HTTP ${custShiftRes.status}`);
  }

  // Warehouse attempting customer management -> should be 403 Forbidden
  if (sessions.warehouse) {
    const whCustRes = await request(`${BASE_URL}/api/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessions.warehouse}`
      },
      body: JSON.stringify({
        table: 'customers',
        action: 'insert',
        values: { name: 'Unauthorized Customer' }
      })
    });
    record('Warehouse inserting customer table (POS restriction)', 'Table RBAC', whCustRes.status === 403, 'HTTP 403 Forbidden', `HTTP ${whCustRes.status}`);
  }

  // Cashier querying products -> should be 200 OK (read allowed)
  if (sessions.cashier) {
    const cashierProdRes = await request(`${BASE_URL}/api/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessions.cashier}`
      },
      body: JSON.stringify({
        table: 'products',
        action: 'select'
      })
    });
    record('Cashier reading products table', 'Table RBAC', cashierProdRes.status === 200, 'HTTP 200 OK', `HTTP ${cashierProdRes.status}`);
  }

  // Admin querying stores -> should be 200 OK
  if (sessions.admin) {
    const adminStoreRes = await request(`${BASE_URL}/api/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessions.admin}`
      },
      body: JSON.stringify({
        table: 'stores',
        action: 'select'
      })
    });
    record('Admin querying stores table', 'Table RBAC', adminStoreRes.status === 200, 'HTTP 200 OK', `HTTP ${adminStoreRes.status}`);
  }

  // ==========================================================================
  // CATEGORY 7: High Concurrency & Burst Stress Test
  // ==========================================================================
  console.log('\n--- CATEGORY 7: High Concurrency & Burst Stress Test ---');

  // 7.1 100 Parallel Requests to /api/health (Split between Backend port 3000 & Proxy port 5173)
  {
    const start = Date.now();
    const healthTasks = Array.from({ length: 100 }, (_, i) => {
      const url = i % 2 === 0 ? `${BASE_URL}/api/health` : `${PROXY_URL}/api/health`;
      return request(url);
    });
    const healthResults = await Promise.all(healthTasks);
    const duration = Date.now() - start;
    const all200 = healthResults.every(r => r.status === 200 && r.json?.ok === true);
    record(`100 parallel /api/health requests across 3000 and 5173 in ${duration}ms`, 'Concurrency Stress', all200, '100/100 HTTP 200', `${healthResults.filter(r => r.status === 200).length}/100 HTTP 200`);
  }

  // 7.2 50 Parallel Signin Requests with Mixed Roles & Invalid Inputs
  {
    const signinPayloads = [
      { email: 'admin@example.com', password: 'change-me-strong-password', expect: 200 },
      { email: 'gudang@example.com', password: 'gudang12345', expect: 200 },
      { email: 'kasir@example.com', password: 'kasir12345', expect: 200 },
      { email: 'customer@example.com', password: 'customer12345', expect: 200 },
      { email: 'admin@example.com', password: 'wrongpassword', expect: 401 },
      { email: 'unknown@example.com', password: 'unknownpassword', expect: 401 },
      { email: '', password: '', expect: 400 }
    ];

    const start = Date.now();
    const signinTasks = Array.from({ length: 50 }, (_, i) => {
      const p = signinPayloads[i % signinPayloads.length];
      return request(`${BASE_URL}/api/auth/signin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: p.email, password: p.password })
      }).then(r => ({ expected: p.expect, actual: r.status, ok: r.status === p.expect }));
    });

    const signinResults = await Promise.all(signinTasks);
    const duration = Date.now() - start;
    const matchedCount = signinResults.filter(r => r.ok).length;
    const has500 = signinResults.some(r => r.actual === 500);

    record(`50 parallel mixed signin requests in ${duration}ms (0 500s)`, 'Concurrency Stress', matchedCount === 50 && !has500, '50/50 matched with 0 500 errors', `${matchedCount}/50 matched, 500s: ${has500}`);
  }

  // 7.3 Rapid Sequential Requests (50 rapid queries in tight loop)
  {
    let seqErrors = 0;
    const start = Date.now();
    for (let i = 0; i < 50; i++) {
      const res = await request(`${BASE_URL}/api/health`);
      if (res.status !== 200 || !res.json?.ok) seqErrors++;
    }
    const duration = Date.now() - start;
    record(`50 rapid sequential /api/health requests in ${duration}ms`, 'Concurrency Stress', seqErrors === 0, '50/50 HTTP 200', `${50 - seqErrors}/50 HTTP 200`);
  }

  // ==========================================================================
  // SUMMARY
  // ==========================================================================
  console.log('\n================================================================');
  console.log(`STRESS TEST SUMMARY: ${results.passed}/${results.total} Passed (${results.failed} Failed)`);
  console.log('================================================================\n');

  if (results.failed > 0) {
    console.error('VERDICT: REJECT - Discovered failures in empirical adversarial testing.');
    process.exit(1);
  } else {
    console.log('VERDICT: APPROVE - All adversarial, RBAC, corruption, and concurrency challenges PASSED.');
    process.exit(0);
  }
}

runAdversarialSuite().catch(err => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
