// Phase 2 integration tests — run in CI against a real Postgres with
// pgvector (DATABASE_URL). Skipped when DATABASE_URL is unset.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../app.js';
import { migrate } from '../db/migrate.js';
import { generateToken } from '../lib/tokens.js';

const hasDb = Boolean(process.env.DATABASE_URL);
const skip = !hasDb ? 'DATABASE_URL not set' : false;

test(
  'auth: full register -> me -> profile -> login -> logout flow',
  { skip },
  async (t) => {
    await migrate(process.env.DATABASE_URL, { logger: { log: () => {} } });
    const app = await buildApp({ databaseUrl: process.env.DATABASE_URL, logLevel: 'silent' });
    t.after(() => app.close());

    const email = `it-${Date.now()}@example.com`;

    // register
    const reg = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { name: 'Integration Tester', email, password: 'password-123' },
    });
    assert.equal(reg.statusCode, 201, reg.body);
    assert.ok(reg.json().userId);
    const sessionCookie = reg.cookies.find((c) => c.name === 'manakai_session');
    assert.ok(sessionCookie, 'session cookie set on register');
    const csrfCookie = reg.cookies.find((c) => c.name === 'manakai_csrf');
    assert.ok(csrfCookie, 'csrf cookie set on register');

    const cookies = () => ({ manakai_session: sessionCookie.value, manakai_csrf: csrfCookie.value });

    // duplicate email -> 409
    const dup = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { name: 'X', email, password: 'password-123' },
    });
    assert.equal(dup.statusCode, 409);
    assert.equal(dup.json().error.code, 'EMAIL_TAKEN');

    // me (with session)
    const me = await app.inject({ method: 'GET', url: '/api/me', cookies: cookies() });
    assert.equal(me.statusCode, 200);
    assert.equal(me.json().email, email);
    assert.equal(me.json().profileComplete, false);

    // me without session -> 401
    const anon = await app.inject({ method: 'GET', url: '/api/me' });
    assert.equal(anon.statusCode, 401);
    assert.equal(anon.json().error.code, 'UNAUTHENTICATED');

    // profile update via API (CSRF enforced)
    const badCsrf = await app.inject({
      method: 'PUT',
      url: '/api/profile',
      headers: { 'x-csrf-token': 'nope' },
      cookies: cookies(),
      payload: { businessName: 'Test Works', businessType: 'msme' },
    });
    assert.equal(badCsrf.statusCode, 403);

    const prof = await app.inject({
      method: 'PUT',
      url: '/api/profile',
      headers: { 'x-csrf-token': csrfCookie.value },
      cookies: cookies(),
      payload: { businessName: 'Test Works', businessType: 'msme', industry: 'Toys' },
    });
    assert.equal(prof.statusCode, 200, prof.body);
    assert.equal(prof.json().isComplete, true);

    const profGet = await app.inject({ method: 'GET', url: '/api/profile', cookies: cookies() });
    assert.equal(profGet.json().businessName, 'Test Works');

    // invalid businessType -> 400
    const badType = await app.inject({
      method: 'PUT',
      url: '/api/profile',
      headers: { 'x-csrf-token': csrfCookie.value },
      cookies: cookies(),
      payload: { businessType: 'megacorp' },
    });
    assert.equal(badType.statusCode, 400);

    // login with wrong password -> 401
    const bad = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password: 'wrong-password' },
    });
    assert.equal(bad.statusCode, 401);
    assert.equal(bad.json().error.code, 'INVALID_CREDENTIALS');

    // login with correct password -> session rotation
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password: 'password-123' },
    });
    assert.equal(login.statusCode, 200, login.body);
    assert.equal(login.json().profileComplete, true);
    const newSession = login.cookies.find((c) => c.name === 'manakai_session');
    assert.notEqual(newSession.value, sessionCookie.value, 'token rotated on login');

    // old session token is dead after rotation
    const oldMe = await app.inject({ method: 'GET', url: '/api/me', cookies: { manakai_session: sessionCookie.value } });
    assert.equal(oldMe.statusCode, 401);

    // logout -> 204, session gone
    const csrf2 = login.cookies.find((c) => c.name === 'manakai_csrf');
    const out = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { 'x-csrf-token': csrf2?.value ?? csrfCookie.value },
      cookies: { manakai_session: newSession.value, manakai_csrf: csrf2?.value ?? csrfCookie.value },
    });
    assert.equal(out.statusCode, 204);
    const afterLogout = await app.inject({ method: 'GET', url: '/api/me', cookies: { manakai_session: newSession.value } });
    assert.equal(afterLogout.statusCode, 401);

    // form fallback: login re-renders with an error on bad credentials
    const formBad = await app.inject({
      method: 'POST',
      url: '/login',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({ email, password: 'wrong-password' }).toString(),
    });
    assert.equal(formBad.statusCode, 401);
    assert.match(formBad.body, /incorrect/);

    // form fallback: successful login redirects (303) to /dashboard (profile complete)
    const formOk = await app.inject({
      method: 'POST',
      url: '/login',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({ email, password: 'password-123' }).toString(),
    });
    assert.equal(formOk.statusCode, 303);
    assert.equal(formOk.headers.location, '/dashboard');
  }
);

test(
  'auth: rate limiting kicks in after 10 failed logins',
  { skip },
  async (t) => {
    const app = await buildApp({ databaseUrl: process.env.DATABASE_URL, logLevel: 'silent' });
    t.after(() => app.close());

    const email = `rl-${Date.now()}@example.com`;
    await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { name: 'RL', email, password: 'password-123' },
    });

    for (let i = 0; i < 10; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email, password: 'wrong-password' },
      });
      assert.equal(res.statusCode, 401, `attempt ${i}`);
    }
    const blocked = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password: 'password-123' }, // even the CORRECT password is blocked
    });
    assert.equal(blocked.statusCode, 429);
    assert.equal(blocked.json().error.code, 'RATE_LIMITED');
  }
);

test(
  'pages: authenticated app pages render and first-login redirects to /profile',
  { skip },
  async (t) => {
    const app = await buildApp({ databaseUrl: process.env.DATABASE_URL, logLevel: 'silent' });
    t.after(() => app.close());

    const email = `pg-${Date.now()}@example.com`;
    const reg = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { name: 'Page User', email, password: 'password-123' },
    });
    assert.equal(reg.statusCode, 201);
    const session = reg.cookies.find((c) => c.name === 'manakai_session').value;

    // profile incomplete -> dashboard redirects to /profile
    const dash = await app.inject({ method: 'GET', url: '/dashboard', cookies: { manakai_session: session } });
    assert.equal(dash.statusCode, 302);
    assert.equal(dash.headers.location, '/profile');

    // profile page itself renders with the session
    const prof = await app.inject({ method: 'GET', url: '/profile', cookies: { manakai_session: session } });
    assert.equal(prof.statusCode, 200);
    assert.match(prof.body, /Tell us about your business/);

    // complete the profile via the form fallback
    const csrf = generateToken();
    const save = await app.inject({
      method: 'POST',
      url: '/profile',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      cookies: { manakai_session: session, manakai_csrf: csrf },
      payload: new URLSearchParams({ businessName: 'Page Works', businessType: 'msme' }).toString(),
    });
    assert.equal(save.statusCode, 303);
    assert.equal(save.headers.location, '/profile?saved=1');

    // now the dashboard renders with a greeting
    const dash2 = await app.inject({ method: 'GET', url: '/dashboard', cookies: { manakai_session: session } });
    assert.equal(dash2.statusCode, 200);
    assert.match(dash2.body, /Page User/);
    assert.match(dash2.body, /Good (morning|afternoon|evening)|Working late/);
  }
);
