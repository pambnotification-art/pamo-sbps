'use strict';
// End-to-end smoke test. Starts the server on a temp database and walks the full workflow.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pamb-test-'));
process.env.DATA_DIR = tmp;
process.env.ADMIN_EMAIL = 'admin@test.local';
process.env.ADMIN_PASSWORD = 'AdminPass123';

// Email is mocked: nothing is ever sent to a real mail server.
process.env.SMTP_HOST = 'smtp.invalid';
process.env.SMTP_FROM = 'PAMO <no-reply@example.invalid>';
const sent = [];
require('nodemailer').createTransport = () => ({ sendMail: async (m) => { sent.push(m); } });
const flush = () => new Promise((r) => setTimeout(r, 60));

const { server, ensureAdmin } = require('../server.js');

let base;
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

class Client {
  constructor() { this.cookie = ''; this.csrf = ''; }
  async req(method, url, { body, raw, headers = {} } = {}) {
    const h = { ...headers };
    if (this.cookie) h.Cookie = this.cookie;
    if (method !== 'GET' && this.csrf) h['X-CSRF-Token'] = this.csrf;
    let payload;
    if (raw !== undefined) payload = raw;
    else if (body !== undefined) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    else if (method !== 'GET') { h['Content-Type'] = 'application/json'; payload = '{}'; }
    const res = await fetch(base + url, { method, headers: h, body: payload });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : await res.text();
    return { status: res.status, data, res };
  }
  async login(email, password) {
    const r = await this.req('POST', '/api/login', { body: { email, password } });
    if (r.status === 200) this.csrf = r.data.csrf;
    return r;
  }
}

let passed = 0;
const ok = (name) => { passed += 1; console.log(`  ok  ${name}`); };

(async () => {
  await ensureAdmin();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;

  // --- static + config
  const home = await new Client().req('GET', '/');
  assert.equal(home.status, 200); assert.match(home.data, /PAMB Clearance/); ok('serves the app shell');
  assert.equal((await new Client().req('GET', '/..%2fserver.js')).status, 404); ok('blocks path traversal');
  const cfg = (await new Client().req('GET', '/api/config')).data;
  assert.ok(cfg.requirements.length >= 14); assert.equal(cfg.special_uses.length, 9); ok('config exposes requirements and special uses');

  assert.equal((await new Client().req('GET', '/api/healthz')).data.ok, true); ok('health check responds');

  // --- registration + login
  const user = new Client();
  let r = await user.req('POST', '/api/register', { body: { name: 'Juan Dela Cruz', email: 'juan@example.com', password: 'weak' } });
  assert.equal(r.status, 400); ok('rejects weak passwords');
  r = await user.req('POST', '/api/register', { body: { name: 'Juan Dela Cruz', email: 'juan@example.com', phone: '09171234567', organization: 'Juan Resort Inc.', password: 'Sarangani2026' } });
  assert.equal(r.status, 201); user.csrf = r.data.csrf; ok('registers an applicant');
  r = await new Client().req('POST', '/api/register', { body: { name: 'Dup', email: 'JUAN@example.com', password: 'Sarangani2026' } });
  assert.equal(r.status, 409); ok('rejects duplicate emails');
  const fresh = new Client();
  assert.equal((await fresh.login('juan@example.com', 'wrongpass1')).status, 401);
  assert.equal((await fresh.login('juan@example.com', 'Sarangani2026')).status, 200); ok('login works and bad passwords fail');

  // --- unauthenticated + csrf
  assert.equal((await new Client().req('GET', '/api/applications')).status, 401); ok('requires login for applications');
  const noCsrf = new Client(); noCsrf.cookie = fresh.cookie;
  assert.equal((await noCsrf.req('POST', '/api/applications')).status, 403); ok('requires a CSRF token on writes');

  // --- create + save + validate
  r = await user.req('POST', '/api/applications', { body: { status_type: 'new' } });
  assert.equal(r.status, 201); const id = r.data.id;
  r = await user.req('POST', `/api/applications/${id}/submit`);
  assert.equal(r.status, 422); assert.ok(r.data.problems.length > 10); ok('blocks incomplete submissions with a list of problems');

  r = await user.req('PUT', `/api/applications/${id}`, { body: {
    status_type: 'new', project_title: 'Mangrove boardwalk and visitor center', site_location: 'Brgy. Poblacion, Alabel', area_ha: 1.5,
    applicant_name: 'Juan Dela Cruz', address: 'Alabel, Sarangani', tel: '09171234567', email: 'juan@example.com',
    applicant_type: 'other_party', special_uses: ['ecotourism', 'camp_sites', 'bogus'], other_use: '',
    description: 'A raised boardwalk and small visitor center for guided mangrove tours.' } });
  assert.equal(r.status, 200); assert.deepEqual(r.data.application.special_uses, ['ecotourism', 'camp_sites']); ok('saves the Annex A form and filters unknown special uses');

  // --- uploads
  const up = (key, name, buf) => user.req('POST', `/api/applications/${id}/files?req=${key}`, { raw: buf, headers: { 'X-Filename': encodeURIComponent(name), 'Content-Type': 'application/octet-stream' } });
  assert.equal((await up('letter_of_intent', 'x.exe', PDF)).status, 415); ok('rejects disallowed file types');
  assert.equal((await up('letter_of_intent', 'fake.pdf', Buffer.from('not really a pdf at all'))).status, 415); ok('rejects files whose content does not match the extension');
  assert.equal((await up('nope', 'a.pdf', PDF)).status, 400); ok('rejects unknown requirements');
  assert.equal((await up('ecc', 'ecc.pdf', PDF)).status, 409); ok('locks the ECC until PAMB clearance');
  for (const def of cfg.requirements.filter((x) => x.phase === 'application')) {
    const rr = await up(def.key, `${def.key}.pdf`, PDF);
    assert.equal(rr.status, 201, `upload ${def.key}`);
  }
  ok('uploads every requirement');

  // --- isolation between applicants
  const other = new Client();
  r = await other.req('POST', '/api/register', { body: { name: 'Maria Santos', email: 'maria@example.com', password: 'Sarangani2026' } });
  other.csrf = r.data.csrf;
  assert.equal((await other.req('GET', `/api/applications/${id}`)).status, 404);
  const fileId = (await user.req('GET', `/api/applications/${id}`)).data.files[0].id;
  assert.equal((await other.req('GET', `/api/files/${fileId}`)).status, 404);
  assert.equal((await other.req('PUT', `/api/applications/${id}`, { body: { project_title: 'hijack' } })).status, 404);
  ok('applicants cannot see or change each other’s applications or files');
  assert.equal((await other.req('GET', '/api/admin/stats')).status, 403); ok('applicants cannot use admin endpoints');

  // --- submit
  r = await user.req('POST', `/api/applications/${id}/submit`);
  assert.equal(r.status, 200); assert.equal(r.data.application.status, 'submitted'); assert.match(r.data.application.app_no, /^SBPS-\d{4}-0001$/); ok('submits and assigns an application number');
  assert.equal((await user.req('PUT', `/api/applications/${id}`, { body: { project_title: 'changed' } })).status, 409); ok('locks the application after submission');

  // --- admin
  const admin = new Client();
  assert.equal((await admin.login('admin@test.local', 'AdminPass123')).status, 200);
  assert.equal(admin.csrf.length > 10, true);
  let stats = (await admin.req('GET', '/api/admin/stats')).data;
  assert.equal(stats.by_status.submitted, 1); assert.equal(stats.attention.length, 1); assert.equal(stats.by_use.ecotourism, 1); ok('admin dashboard stats reflect the submission');
  const list = (await admin.req('GET', '/api/admin/applications?status=submitted&q=mangrove')).data.applications;
  assert.equal(list.length, 1); ok('admin can search and filter applications');
  assert.equal((await admin.req('GET', '/api/admin/applications?q=%25')).data.applications.length, 0); ok('search treats % literally');

  r = await admin.req('POST', `/api/admin/applications/${id}/status`, { body: { status: 'pamb_cleared' } });
  assert.equal(r.status, 409); ok('enforces the status workflow');
  assert.equal((await admin.req('POST', `/api/admin/applications/${id}/status`, { body: { status: 'under_review' } })).status, 200);
  r = await admin.req('POST', `/api/admin/applications/${id}/status`, { body: { status: 'returned', remark: '' } });
  assert.equal(r.status, 400); ok('requires a remark when returning an application');
  assert.equal((await admin.req('POST', `/api/admin/applications/${id}/requirements/zoning`, { body: { status: 'revision', remark: 'Zoning clearance is expired.' } })).status, 200);
  assert.equal((await admin.req('POST', `/api/admin/applications/${id}/requirements/land_title`, { body: { status: 'accepted' } })).status, 200);
  assert.equal((await admin.req('POST', `/api/admin/applications/${id}/status`, { body: { status: 'returned', remark: 'Please upload a current zoning clearance.' } })).status, 200); ok('admin reviews requirements and returns for revision');

  r = await user.req('GET', `/api/applications/${id}`);
  assert.equal(r.data.application.status, 'returned'); assert.equal(r.data.editable, true); assert.equal(r.data.reviews.zoning.status, 'revision'); ok('applicant sees remarks and can edit again');
  await flush();
  assert.equal(sent.length, 1); assert.equal(sent[0].to, 'juan@example.com');
  assert.match(sent[0].subject, /Returned for revision/); assert.match(sent[0].text, /current zoning clearance/); ok('emails the applicant when an application is returned for revision');
  assert.equal((await up('zoning', 'zoning-new.pdf', PDF)).status, 201);
  r = await user.req('POST', `/api/applications/${id}/submit`);
  assert.equal(r.status, 200); assert.equal(r.data.application.status, 'submitted'); assert.equal(r.data.application.app_no.endsWith('0001'), true); ok('resubmission keeps the application number');

  assert.equal((await admin.req('POST', `/api/admin/applications/${id}/status`, { body: { status: 'under_review' } })).status, 200);
  assert.equal((await admin.req('POST', `/api/admin/applications/${id}/status`, { body: { status: 'pamb_cleared', remark: 'Cleared by the PAMB.' } })).status, 200); ok('admin grants PAMB clearance');
  await flush();
  assert.equal(sent.length, 2); assert.match(sent[1].subject, /— Cleared —/); assert.match(sent[1].text, /upload your Environmental Compliance Certificate/); ok('emails the applicant once when PAMB clearance is granted');

  r = await admin.req('POST', `/api/admin/applications/${id}/status`, { body: { status: 'rejected', remark: 'Trying to reject after clearance.' } });
  assert.equal(r.status, 409);
  assert.deepEqual((await admin.req('GET', `/api/applications/${id}`)).data.next_statuses, []); ok('decision is locked once PAMB clearance is granted');

  // --- ECC and SAPA
  assert.equal((await user.req('POST', `/api/applications/${id}/ecc-submit`)).status, 422); ok('requires an ECC file before submitting it');
  assert.equal((await up('ecc', 'ecc.pdf', PDF)).status, 201);
  assert.equal((await user.req('POST', `/api/applications/${id}/ecc-submit`)).status, 200);
  await flush(); assert.equal(sent.length, 2); ok('sends no email when the applicant submits the ECC');
  r = await admin.req('POST', `/api/admin/applications/${id}/status`, { body: { status: 'pamb_cleared' } });
  assert.equal(r.status, 400);
  assert.equal((await admin.req('POST', `/api/admin/applications/${id}/status`, { body: { status: 'pamb_cleared', remark: 'The ECC is expired, please upload a current one.' } })).status, 200);
  await flush();
  assert.equal(sent.length, 3); assert.match(sent[2].subject, /ECC needs revision/); assert.doesNotMatch(sent[2].subject, /Cleared/);
  assert.doesNotMatch(sent[2].text, /recorded your application as PAMB cleared/); assert.match(sent[2].text, /expired/); ok('asking for a new ECC sends a revision email, not a second clearance email');
  assert.equal((await up('ecc', 'ecc2.pdf', PDF)).status, 201);
  assert.equal((await user.req('POST', `/api/applications/${id}/ecc-submit`)).status, 200);
  r = await admin.req('POST', `/api/admin/applications/${id}/status`, { body: { status: 'sapa_approved' } });
  assert.equal(r.status, 400); ok('requires an expiry date to approve a SAPA');
  r = await admin.req('POST', `/api/admin/applications/${id}/status`, { body: { status: 'sapa_approved', date_expired: '2031-12-31' } });
  assert.equal(r.status, 200); assert.equal(r.data.application.date_expired, '2031-12-31'); ok('admin approves the SAPA');
  await flush(); assert.equal(sent.length, 3); ok('no decision email is sent for SAPA approval');

  // --- csv, users, files
  const csv = await admin.req('GET', '/api/admin/export.csv');
  assert.equal(csv.status, 200); assert.match(csv.data, /SBPS-\d{4}-0001/); assert.match(csv.data, /SAPA approved/); ok('exports applications as CSV');
  const dl = await admin.req('GET', `/api/files/${fileId}`);
  assert.equal(dl.status, 200); assert.match(dl.res.headers.get('content-disposition'), /attachment/); ok('admin can download uploaded files');
  const users = (await admin.req('GET', '/api/admin/users')).data.users;
  assert.equal(users.length, 3);
  const maria = users.find((u) => u.email === 'maria@example.com');
  assert.equal((await admin.req('PATCH', `/api/admin/users/${maria.id}`, { body: { active: false } })).status, 200);
  assert.equal((await other.req('GET', '/api/applications')).status, 401); ok('deactivating a user ends their session');
  assert.equal((await new Client().login('maria@example.com', 'Sarangani2026')).status, 401);

  // --- rate limit
  const rl = new Client(); let last;
  for (let i = 0; i < 10; i++) last = await rl.login('nobody@example.com', 'whatever123');
  assert.equal(last.status, 429); ok('rate-limits repeated failed logins');

  // --- admin forced password change
  assert.equal((await admin.req('POST', '/api/password', { body: { current: 'AdminPass123', next: 'NewAdminPass456' } })).status, 200);
  assert.equal((await new Client().login('admin@test.local', 'NewAdminPass456')).status, 200); ok('password change works');

  console.log(`\n${passed} checks passed`);
  server.close(); fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(0);
})().catch((e) => {
  console.error('\nFAILED:', e && e.stack || e);
  try { server.close(); } catch { /* ignore */ }
  process.exit(1);
});
