const http = require('http');

async function testEndpoint(url, options = {}) {
  const start = Date.now();
  const res = await fetch(url, options);
  const duration = Date.now() - start;
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (e) {}
  return {
    status: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    text,
    json,
    duration
  };
}

async function run() {
  console.log('=== EMPIRICAL CHALLENGER SUITE ===\n');

  // Test 1: Direct & Proxy Health
  console.log('--- TEST 1: Health & Proxy Routing ---');
  const dHealth = await testEndpoint('http://localhost:3000/api/health');
  console.log('1.1 Direct Backend (3000 /api/health):', dHealth.status, JSON.stringify(dHealth.json));

  const pHealth = await testEndpoint('http://localhost:5173/api/health');
  console.log('1.2 Proxy Health (5173 /api/health):', pHealth.status, JSON.stringify(pHealth.json));

  const pRoot = await testEndpoint('http://localhost:5173/');
  console.log('1.3 Frontend Root (5173 /):', pRoot.status, 'HTML length:', pRoot.text.length, 'Contains Root Div:', pRoot.text.includes('id="root"'));

  // Test 2: Role Authentication & Session Resolution over Proxy
  console.log('\n--- TEST 2: Multi-Role Auth & Session over Proxy (5173) ---');
  const demoRoles = [
    { email: 'admin@example.com', pass: 'change-me-strong-password', role: 'admin' },
    { email: 'gudang@example.com', pass: 'gudang12345', role: 'warehouse' },
    { email: 'kasir@example.com', pass: 'kasir12345', role: 'cashier' },
    { email: 'customer@example.com', pass: 'customer12345', role: 'customer' },
  ];

  const authTokens = {};
  for (const acc of demoRoles) {
    const signin = await testEndpoint('http://localhost:5173/api/auth/signin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: acc.email, password: acc.pass })
    });
    const token = signin.json?.session?.access_token;
    console.log(`2.1 Signin ${acc.role}: HTTP ${signin.status} | Token: ${token ? 'VALID' : 'NONE'}`);
    authTokens[acc.role] = token;

    const session = await testEndpoint('http://localhost:5173/api/auth/session', {
      headers: { Authorization: `Bearer ${token}` }
    });
    const sessionEmail = session.json?.session?.user?.email;
    console.log(`2.2 Session ${acc.role}: HTTP ${session.status} | User: ${sessionEmail}`);

    const user = await testEndpoint('http://localhost:5173/api/auth/user', {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log(`2.3 User ${acc.role}: HTTP ${user.status} | ID: ${user.json?.user?.id}`);
  }

  // Test 3: Negative & Security Validation
  console.log('\n--- TEST 3: Security & Negative Scenarios ---');
  const neg1 = await testEndpoint('http://localhost:5173/api/auth/signin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'wrong-password' })
  });
  console.log('3.1 Invalid password signin:', neg1.status, JSON.stringify(neg1.json));

  const neg2 = await testEndpoint('http://localhost:5173/api/auth/signin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'unregistered@example.com', password: 'somepassword' })
  });
  console.log('3.2 Unregistered user signin:', neg2.status, JSON.stringify(neg2.json));

  const neg3 = await testEndpoint('http://localhost:5173/api/auth/session', {
    headers: { Authorization: 'Bearer invalid.jwt.token' }
  });
  console.log('3.3 Invalid JWT session request:', neg3.status, JSON.stringify(neg3.json));

  const neg4 = await testEndpoint('http://localhost:5173/api/admin/users', {
    headers: { Authorization: `Bearer ${authTokens.cashier}` }
  });
  console.log('3.4 Forbidden role access (Cashier -> /api/admin/users):', neg4.status, JSON.stringify(neg4.json));

  // Test 4: Concurrency & Stress Load
  console.log('\n--- TEST 4: Concurrency Stress Load (100 parallel requests) ---');
  const burstSize = 100;
  const startBurst = Date.now();
  const tasks = Array.from({ length: burstSize }, (_, i) => {
    if (i % 2 === 0) {
      return testEndpoint('http://localhost:5173/api/health');
    } else {
      return testEndpoint('http://localhost:5173/api/auth/session', {
        headers: { Authorization: `Bearer ${authTokens.admin}` }
      });
    }
  });
  const results = await Promise.all(tasks);
  const elapsed = Date.now() - startBurst;
  const passedCount = results.filter(r => r.status === 200).length;
  const avgDuration = Math.round(results.reduce((acc, r) => acc + r.duration, 0) / burstSize);

  console.log(`4.1 Concurrency Result: ${passedCount}/${burstSize} HTTP 200 OK | Total Time: ${elapsed}ms | Avg Latency: ${avgDuration}ms`);

  console.log('\n=== SUITE EXECUTION FINISHED ===');
}

run().catch(err => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
