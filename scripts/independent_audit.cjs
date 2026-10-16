const http = require('http');

async function testHttp(options, postData = null) {
  return new Promise((resolve) => {
    const req = http.request(options, (res) => {
      let raw = '';
      res.on('data', (c) => raw += c);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(raw); } catch (e) {}
        resolve({ status: res.statusCode, headers: res.headers, json, raw });
      });
    });
    req.on('error', (err) => {
      resolve({ status: 0, error: err.message, raw: '', json: null });
    });
    if (postData) {
      if (typeof postData === 'string') req.write(postData);
      else req.write(JSON.stringify(postData));
    }
    req.end();
  });
}

async function audit() {
  console.log('=== VICTORY AUDITOR: INDEPENDENT ACCEPTANCE VERIFICATION ===\n');

  const checks = [];
  const record = (num, name, pass, detail) => {
    checks.push({ num, name, pass, detail });
    console.log(`[${pass ? 'PASS' : 'FAIL'}] ${num}. ${name}: ${detail}`);
  };

  // 1. Health check HTTP 200 with { ok: true }
  const hRes = await testHttp({ hostname: 'localhost', port: 3000, path: '/api/health', method: 'GET' });
  record('AC-1', 'Backend Health Endpoint (:3000 /api/health)',
    hRes.status === 200 && hRes.json?.ok === true,
    `Status: ${hRes.status}, Body: ${JSON.stringify(hRes.json)}`
  );

  const hProxy = await testHttp({ hostname: 'localhost', port: 5173, path: '/api/health', method: 'GET' });
  record('AC-1b', 'Proxy Health Endpoint (:5173 /api/health)',
    hProxy.status === 200 && hProxy.json?.ok === true,
    `Status: ${hProxy.status}, Body: ${JSON.stringify(hProxy.json)}`
  );

  // 2. Auth for all roles (admin, warehouse, cashier, customer)
  const roles = [
    { role: 'admin', email: 'admin@example.com', password: 'change-me-strong-password', id: 'usr-admin-001' },
    { role: 'warehouse', email: 'gudang@example.com', password: 'gudang12345', id: 'usr-warehouse-001' },
    { role: 'cashier', email: 'kasir@example.com', password: 'kasir12345', id: 'usr-cashier-001' },
    { role: 'customer', email: 'customer@example.com', password: 'customer12345', id: 'usr-customer-001' },
  ];

  const tokens = {};
  for (const r of roles) {
    const signin = await testHttp({
      hostname: 'localhost',
      port: 3000,
      path: '/api/auth/signin',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { email: r.email, password: r.password });

    const token = signin.json?.session?.access_token;
    tokens[r.role] = token;
    const signinOk = signin.status === 200 && token && signin.json?.user?.role === r.role;
    record('AC-2a', `Signin Role [${r.role}]`,
      signinOk,
      `Status: ${signin.status}, Role: ${signin.json?.user?.role}, Token: ${token ? 'PRESENT' : 'MISSING'}`
    );

    if (token) {
      const session = await testHttp({
        hostname: 'localhost',
        port: 3000,
        path: '/api/auth/session',
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const sessionOk = session.status === 200 && session.json?.session?.access_token === token;
      record('AC-2b', `Session Role [${r.role}]`,
        sessionOk,
        `Status: ${session.status}, Sub: ${session.json?.session?.user?.id || r.id}`
      );
    }
  }

  // 3. Negative & Malformed Payloads (Must return 4xx, zero 500s)
  const negInvalidPass = await testHttp({
    hostname: 'localhost',
    port: 3000,
    path: '/api/auth/signin',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { email: 'admin@example.com', password: 'badpassword999' });
  record('AC-3a', 'Negative: Invalid Password',
    negInvalidPass.status === 401,
    `Status: ${negInvalidPass.status} (expected 401), Body: ${JSON.stringify(negInvalidPass.json)}`
  );

  const negUnknownUser = await testHttp({
    hostname: 'localhost',
    port: 3000,
    path: '/api/auth/signin',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { email: 'nobody@nowhere.com', password: 'badpassword999' });
  record('AC-3b', 'Negative: Non-existent User',
    negUnknownUser.status === 401,
    `Status: ${negUnknownUser.status} (expected 401), Body: ${JSON.stringify(negUnknownUser.json)}`
  );

  const negMalformedJson = await testHttp({
    hostname: 'localhost',
    port: 3000,
    path: '/api/auth/signin',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, '{"email": ');
  record('AC-3c', 'Negative: Malformed Raw JSON',
    negMalformedJson.status === 400,
    `Status: ${negMalformedJson.status} (expected 400), Body: ${JSON.stringify(negMalformedJson.json)}`
  );

  const negEmptyPayload = await testHttp({
    hostname: 'localhost',
    port: 3000,
    path: '/api/auth/signin',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {});
  record('AC-3d', 'Negative: Missing Credentials',
    negEmptyPayload.status === 400,
    `Status: ${negEmptyPayload.status} (expected 400), Body: ${JSON.stringify(negEmptyPayload.json)}`
  );

  const negUnauthSession = await testHttp({
    hostname: 'localhost',
    port: 3000,
    path: '/api/auth/session',
    method: 'GET'
  });
  record('AC-3e', 'Negative: Missing Auth Token',
    negUnauthSession.status === 401,
    `Status: ${negUnauthSession.status} (expected 401), Body: ${JSON.stringify(negUnauthSession.json)}`
  );

  const negBadToken = await testHttp({
    hostname: 'localhost',
    port: 3000,
    path: '/api/auth/session',
    method: 'GET',
    headers: { 'Authorization': 'Bearer garbage.jwt.token' }
  });
  record('AC-3f', 'Negative: Malformed Bearer Token',
    negBadToken.status === 401,
    `Status: ${negBadToken.status} (expected 401), Body: ${JSON.stringify(negBadToken.json)}`
  );

  const total = checks.length;
  const passed = checks.filter(c => c.pass).length;
  console.log(`\n=== AUDIT RESULTS: ${passed}/${total} Acceptance Checks Passed ===`);
}

audit();
