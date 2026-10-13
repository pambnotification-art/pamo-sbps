'use strict';
require('dotenv').config();
/**
 * Sarangani Bay Protected Seascape (SBPS)
 * PAMB Clearance / SAPA application system
 *
 * Zero npm dependencies: Node.js >= 22.13 (built-in http, crypto and node:sqlite).
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { DatabaseSync } = require('node:sqlite');

const scrypt = promisify(crypto.scrypt);

// SMTP is optional: configure SMTP_* variables to enable decision emails.
// No email is sent if configuration is absent.
let mailTransport;
function getMailTransport() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_FROM) return null;
  if (!mailTransport) {
    const nodemailer = require('nodemailer');
    mailTransport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: ['1', 'true'].includes(String(process.env.SMTP_SECURE).toLowerCase()),
      auth: process.env.SMTP_USER && process.env.SMTP_PASS
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
      requireTLS: !['1', 'true'].includes(String(process.env.SMTP_SECURE).toLowerCase()),
    });
  }
  return mailTransport;
}

function escapeEmailHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

// Which email (if any) a status change should send. `from` is the previous status.
function emailKind(from, to) {
  if (to === 'pamb_cleared') return from === 'ecc_submitted' ? 'ecc_revision' : 'cleared';
  if (to === 'rejected') return 'rejected';
  if (to === 'returned') return 'returned';
  return null;
}

async function sendDecisionEmail(app, status, remark, from) {
  const kind = emailKind(from, status);
  if (!kind) return;
  const transport = getMailTransport();
  if (!transport) return;
  // Notifications go to the registered account email, not an editable application field.
  const owner = db.prepare('SELECT name, email FROM users WHERE id = ?').get(app.user_id);
  if (!owner || !isEmail(owner.email)) return;

  const COPY = {
    cleared: { word: 'Cleared', decision: 'PAMB CLEARED', heading: 'PAMB Clearance Confirmed', color: '#0c665d' },
    rejected: { word: 'Rejected', decision: 'REJECTED', heading: 'PAMB Clearance Application Rejected', color: '#9d3434' },
    returned: { word: 'Returned for revision', decision: 'RETURNED FOR REVISION', heading: 'Application Returned for Revision', color: '#9a6a00' },
    ecc_revision: { word: 'ECC needs revision', decision: 'ECC NEEDS REVISION', heading: 'ECC Needs Revision', color: '#9a6a00' }
  }[kind];
  const decision = COPY.decision;
  const appNo = app.app_no || 'Not assigned';
  const project = app.project_title || 'Untitled application';
  const subject = `SBPS PAMB Clearance — ${COPY.word} — ${appNo}`;
  const notice = {
    cleared: 'The Protected Area Management Office (PAMO) has recorded your application as PAMB cleared.',
    rejected: 'The Protected Area Management Office (PAMO) has recorded your PAMB clearance application as rejected.',
    returned: 'The Protected Area Management Office (PAMO) has returned your PAMB clearance application to you for revision.',
    ecc_revision: 'The Protected Area Management Office (PAMO) has reviewed the ECC you uploaded and needs you to submit a corrected one. Your PAMB clearance stands.'
  }[kind];
  const next = {
    cleared: 'Please sign in to your SBPS PAMB Clearance account to review the decision and upload your Environmental Compliance Certificate (ECC) for the next processing stage. PAMB clearance is not itself SAPA approval.',
    rejected: 'Please sign in to your SBPS PAMB Clearance account to review the decision. For clarification, contact PAMO using the contact information below.',
    returned: 'Please sign in to your SBPS PAMB Clearance account, read the remarks, correct the items flagged, and submit your application again.',
    ecc_revision: 'Please sign in to your SBPS PAMB Clearance account, read the remarks, and upload a corrected ECC.'
  }[kind];
  const remarkText = remark ? `PAMO remarks: ${remark}` : '';
  const footer = 'Protected Area Management Office (PAMO) — Sarangani Bay Protected Seascape\nBrgy. Poblacion, Alabel, Sarangani Province\nContact: 0909-618-9917 / 0995-305-0306\nOfficial inquiries: sbpspasu@gmail.com';
  const text = [
    'REPUBLIC OF THE PHILIPPINES',
    'DEPARTMENT OF ENVIRONMENT AND NATURAL RESOURCES',
    'PROTECTED AREA MANAGEMENT OFFICE',
    'SARANGANI BAY PROTECTED SEASCAPE', '',
    `Subject: ${subject}`, '', `Dear ${owner.name},`, '', notice, '',
    `Application number: ${appNo}`, `Project: ${project}`, `Decision: ${decision}`,
    ...(remark ? ['', remarkText] : []), '', next, '', footer, '',
    'This is an automated system notification, not a signed PAMB resolution or clearance certificate. Please do not reply to this email.'
  ].join('\n');
  const safe = escapeEmailHtml;
  const remarksHtml = remark ? `<div style="margin:18px 0;padding:14px 16px;background:#f5f7f8;border-left:4px solid #0c665d"><strong>PAMO remarks</strong><p style="margin:8px 0 0;white-space:pre-wrap">${safe(remark)}</p></div>` : '';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px 12px;background:#f1f5f4;font-family:Arial,Helvetica,sans-serif;color:#22312f">
<table role="presentation" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;margin:auto;background:white;border-collapse:collapse;border:1px solid #d9e4e0">
<tr><td style="background:#104d47;color:white;padding:24px;text-align:center"><div style="font-size:11px;letter-spacing:1.2px">REPUBLIC OF THE PHILIPPINES</div><div style="font-size:13px;margin-top:7px;font-weight:bold">DEPARTMENT OF ENVIRONMENT AND NATURAL RESOURCES</div><div style="font-size:15px;margin-top:9px;font-weight:bold">PROTECTED AREA MANAGEMENT OFFICE</div><div style="font-size:13px;margin-top:5px">SARANGANI BAY PROTECTED SEASCAPE</div></td></tr>
<tr><td style="padding:28px 26px"><div style="font-size:12px;color:#536964;letter-spacing:1px;font-weight:bold">PAMB CLEARANCE APPLICATION UPDATE</div><h1 style="font-size:23px;line-height:1.25;margin:12px 0;color:#123d39">${COPY.heading}</h1><p>Dear ${safe(owner.name)},</p><p style="line-height:1.65">${safe(notice)}</p>
<table role="presentation" cellpadding="10" cellspacing="0" style="width:100%;background:#f5f9f8;border-collapse:collapse;font-size:14px"><tr><td style="width:40%;border-bottom:1px solid #dce8e4">Application number</td><td style="border-bottom:1px solid #dce8e4"><strong>${safe(appNo)}</strong></td></tr><tr><td style="border-bottom:1px solid #dce8e4">Project</td><td style="border-bottom:1px solid #dce8e4">${safe(project)}</td></tr><tr><td>Decision</td><td><strong style="color:${COPY.color}">${decision}</strong></td></tr></table>
${remarksHtml}<p style="line-height:1.65;margin-top:20px">${safe(next)}</p></td></tr>
<tr><td style="background:#eef4f2;padding:20px 26px;font-size:12px;line-height:1.7;color:#415953"><strong>Protected Area Management Office (PAMO)</strong><br>Sarangani Bay Protected Seascape<br>PENRO Alabel, Brgy. Poblacion, Alabel, Sarangani Province<br>Contact: 0909-618-9917 / 0995-305-0306<br>Official inquiries: <a href="mailto:sbpspasu@gmail.com" style="color:#0c665d">sbpspasu@gmail.com</a></td></tr>
<tr><td style="padding:14px 26px;font-size:11px;line-height:1.5;color:#63716e">Automated system notification only. This message is not a signed PAMB resolution or clearance certificate. Please do not reply to this email.</td></tr>
</table></body></html>`;
  await transport.sendMail({ from: process.env.SMTP_FROM, to: owner.email, subject, text, html });
}

// ---------------------------------------------------------------- config
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const COOKIE_SECURE = process.env.COOKIE_SECURE === '1';
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const SESSION_MS = 12 * 60 * 60 * 1000;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_FILES_PER_APP = 60;

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------------------------------------------------------------- reference data
const APPLICANT_TYPES = [
  ['ip', 'Indigenous People'],
  ['tenured_migrant', 'Tenured Migrant'],
  ['lgu', 'Local Government Unit'],
  ['gov_agency', 'Other Government Agency'],
  ['other_party', 'Other Interested Party'],
];

const SPECIAL_USES = [
  ['ecotourism', 'Ecotourism'],
  ['camp_sites', 'Camp sites'],
  ['communication', 'Communication'],
  ['transmission_lines', 'Transmission lines'],
  ['irrigation_agri', 'Irrigation canals / Agriculture'],
  ['right_of_way', 'Right-of-way'],
  ['aquaculture', 'Aquaculture'],
  ['monitoring_stations', 'Monitoring stations'],
  ['other', 'Other special use'],
];

const STATUSES = {
  draft: 'Draft',
  submitted: 'Submitted',
  under_review: 'Under review',
  returned: 'Returned for revision',
  pamb_cleared: 'PAMB cleared',
  ecc_submitted: 'ECC submitted',
  sapa_approved: 'SAPA approved',
  rejected: 'Rejected',
};

// What an admin may move an application to, from each status.
const ADMIN_TRANSITIONS = {
  submitted: ['under_review', 'returned', 'rejected'],
  under_review: ['returned', 'pamb_cleared', 'rejected'],
  returned: ['rejected'],
  pamb_cleared: [], // locked: waiting for the applicant to upload the ECC
  ecc_submitted: ['sapa_approved', 'pamb_cleared', 'rejected'],
  sapa_approved: [],
  rejected: [],
  draft: [],
};

// Requirements checklist (from "Requirements for PAMB Clearance/SAPA Application").
// "Annex 01 - Application Form" is the online form itself, so it has no upload.
const REQUIREMENTS = [
  { key: 'letter_of_intent', phase: 'application', group: 'Basic documents', label: 'Letter of intent' },
  {
    key: 'sketch_plan', phase: 'application', group: 'Basic documents',
    label: 'Sketch plan with technical description',
    hint: 'Signed by a Geodetic Engineer. It must show the titled area and the SAPA area.',
  },
  {
    key: 'legal_entity', phase: 'application', group: 'Basic documents',
    label: 'Birth certificate or Articles of Incorporation',
    hint: 'Birth certificate for a sole proprietorship. Articles of Incorporation and By-Laws for an Inc. or Corp.',
  },
  { key: 'land_title', phase: 'application', group: 'Basic documents', label: 'Copy of land title' },
  {
    key: 'sdp', phase: 'application', group: 'Site development plan',
    label: 'Site development plan (2D or 3D illustration)',
    hint: 'Drawn to scale. Show the distance from the property line to high tide and the dimensions of each facility.',
  },
  { key: 'wastewater', phase: 'application', group: 'Site development plan', label: 'Wastewater flow diagram' },
  { key: 'septic', phase: 'application', group: 'Site development plan', label: 'Septic tank design' },
  {
    key: 'financial', phase: 'application', group: 'Capability and registration',
    label: 'Proof of financial capability',
    hint: 'To manage and develop the SAPA area, based on paid-up capital: ITR, bank statement, or proof of other owned properties.',
  },
  { key: 'registration', phase: 'application', group: 'Capability and registration', label: 'Copy of SEC / DTI registration' },
  {
    key: 'brgy_res', phase: 'application', group: 'Local endorsements',
    label: 'Barangay resolution', hint: 'Interposing no objection.',
  },
  {
    key: 'sb_res', phase: 'application', group: 'Local endorsements',
    label: 'Sangguniang Bayan / Panlungsod resolution', hint: 'Interposing no objection.',
  },
  {
    key: 'zoning', phase: 'application', group: 'Local endorsements',
    label: 'Zoning clearance', hint: 'From the Municipal or City Planning and Development Office.',
  },
  {
    key: 'cdmp', phase: 'application', group: 'Plans',
    label: 'Comprehensive Development and Management Plan',
    hint: 'Include the application form, a timetable and description of activities from preparation to implementation, environmental impact management, and an enumeration of improvements with costing.',
  },
  { key: 'rehab', phase: 'application', group: 'Plans', label: 'Rehabilitation plan' },
  {
    key: 'ecc', phase: 'post', group: 'After PAMB clearance',
    label: 'Environmental Compliance Certificate (ECC)',
    hint: 'Process this after your PAMB clearance is approved. A copy goes to the PAMO office for the approval of your SAPA.',
  },
];
const REQ_BY_KEY = Object.fromEntries(REQUIREMENTS.map((r) => [r.key, r]));
const APP_REQS = REQUIREMENTS.filter((r) => r.phase === 'application');

// ---------------------------------------------------------------- database
const db = new DatabaseSync(path.join(DATA_DIR, 'pamb.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  organization TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'applicant' CHECK (role IN ('applicant','admin')),
  active INTEGER NOT NULL DEFAULT 1,
  must_change INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_no TEXT UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'draft',
  status_type TEXT NOT NULL DEFAULT 'new',
  project_title TEXT,
  site_location TEXT,
  area_ha REAL,
  applicant_name TEXT,
  address TEXT,
  tel TEXT,
  email TEXT,
  applicant_type TEXT,
  special_uses TEXT NOT NULL DEFAULT '[]',
  other_use TEXT,
  description TEXT,
  date_filed TEXT,
  date_expired TEXT,
  submitted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  req_key TEXT NOT NULL,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  size INTEGER NOT NULL,
  uploaded_by INTEGER NOT NULL REFERENCES users(id),
  uploaded_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS req_reviews (
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  req_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','revision')),
  remark TEXT,
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TEXT,
  PRIMARY KEY (application_id, req_key)
);
CREATE TABLE IF NOT EXISTS history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  actor_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  remark TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_apps_user ON applications(user_id);
CREATE INDEX IF NOT EXISTS idx_apps_status ON applications(status);
CREATE INDEX IF NOT EXISTS idx_files_app ON files(application_id);
CREATE INDEX IF NOT EXISTS idx_hist_app ON history(application_id);
`);

// ---------------------------------------------------------------- helpers
class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const nowIso = () => new Date().toISOString();
const manilaDate = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const cleanStr = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max) : '');
const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) && s.length <= 120;
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, 64);
  return `s1$${salt.toString('hex')}$${key.toString('hex')}`;
}
async function verifyPassword(pw, stored) {
  const [v, saltHex, keyHex] = String(stored).split('$');
  if (v !== 's1' || !saltHex || !keyHex) return false;
  const key = await scrypt(pw, Buffer.from(saltHex, 'hex'), 64);
  const expected = Buffer.from(keyHex, 'hex');
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}
function checkPasswordStrength(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'Use a password with at least 8 characters.';
  if (pw.length > 200) return 'Password is too long.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Use at least one letter and one number in your password.';
  return null;
}

// -- rate limiting (in memory)
const buckets = new Map();
function rateLimit(key, max, windowMs) {
  const t = Date.now();
  let b = buckets.get(key);
  if (!b || b.reset < t) b = { count: 0, reset: t + windowMs };
  b.count += 1;
  buckets.set(key, b);
  if (b.count > max) {
    const mins = Math.max(1, Math.ceil((b.reset - t) / 60000));
    throw new HttpError(429, `Too many attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`);
  }
}
setInterval(() => {
  const t = Date.now();
  for (const [k, b] of buckets) if (b.reset < t) buckets.delete(k);
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(t);
}, 10 * 60 * 1000).unref();

function clientIp(req) {
  if (TRUST_PROXY && req.headers['x-forwarded-for']) return String(req.headers['x-forwarded-for']).split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

// -- sessions
function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) {
      try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore */ }
    }
  });
  return out;
}
function setSessionCookie(res, token, maxAgeSec) {
  const parts = [`sid=${token}`, 'HttpOnly', 'SameSite=Lax', 'Path=/', `Max-Age=${maxAgeSec}`];
  if (COOKIE_SECURE) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}
function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const csrf = crypto.randomBytes(24).toString('base64url');
  db.prepare('INSERT INTO sessions (token_hash, user_id, csrf, expires_at, created_at) VALUES (?,?,?,?,?)')
    .run(sha(token), userId, csrf, Date.now() + SESSION_MS, Date.now());
  return { token, csrf };
}
function loadSession(req) {
  const token = parseCookies(req.headers.cookie).sid;
  if (!token) return null;
  const s = db.prepare(`SELECT s.token_hash, s.csrf, s.expires_at, u.id AS user_id, u.name, u.email, u.phone,
      u.organization, u.role, u.active, u.must_change
    FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`).get(sha(token));
  if (!s || s.expires_at < Date.now() || !s.active) return null;
  if (s.expires_at - Date.now() < SESSION_MS / 2) {
    db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(Date.now() + SESSION_MS, s.token_hash);
  }
  return s;
}
const publicUser = (s) => ({
  id: s.user_id, name: s.name, email: s.email, phone: s.phone, organization: s.organization,
  role: s.role, must_change: !!s.must_change,
});

// -- request / response
function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
  });
  res.end(data);
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > limit) { reject(new HttpError(413, 'That file is too large. The limit is 10 MB.')); req.resume(); return; }
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'That file is too large. The limit is 10 MB.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJson(req) {
  const type = String(req.headers['content-type'] || '');
  if (!type.startsWith('application/json')) throw new HttpError(415, 'Send JSON with Content-Type: application/json.');
  const buf = await readBody(req, 256 * 1024);
  if (!buf.length) return {};
  try {
    const v = JSON.parse(buf.toString('utf8'));
    if (v === null || typeof v !== 'object') throw new Error('x');
    return v;
  } catch {
    throw new HttpError(400, 'The request body is not valid JSON.');
  }
}

// -- routing
const routes = [];
function route(method, pattern, opts, handler) {
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$');
  routes.push({ method, re, opts, handler });
}

// ---------------------------------------------------------------- application logic
function parseApp(row) {
  if (!row) return row;
  let uses = [];
  try { uses = JSON.parse(row.special_uses || '[]'); } catch { /* ignore */ }
  return { ...row, special_uses: uses };
}
function addHistory(appId, actorId, action, from, to, remark) {
  db.prepare('INSERT INTO history (application_id, actor_id, action, from_status, to_status, remark, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(appId, actorId, action, from || null, to || null, remark || null, nowIso());
}
function loadApp(ctx, id) {
  const row = db.prepare('SELECT * FROM applications WHERE id = ?').get(Number(id));
  if (!row) throw new HttpError(404, 'Application not found.');
  if (ctx.user.role === 'admin') {
    if (row.status === 'draft') throw new HttpError(404, 'Application not found.');
  } else if (row.user_id !== ctx.user.user_id) {
    throw new HttpError(404, 'Application not found.');
  }
  return row;
}
const isEditable = (app) => app.status === 'draft' || app.status === 'returned';
const isEccOpen = (app) => app.status === 'pamb_cleared';

function appDetail(app, forAdmin) {
  const files = db.prepare('SELECT id, req_key, original_name, size, uploaded_at FROM files WHERE application_id = ? ORDER BY id').all(app.id);
  const reviews = {};
  for (const r of db.prepare('SELECT req_key, status, remark, reviewed_at FROM req_reviews WHERE application_id = ?').all(app.id)) {
    reviews[r.req_key] = r;
  }
  const history = db.prepare(`SELECT h.id, h.action, h.from_status, h.to_status, h.remark, h.created_at,
      u.name AS actor_name, u.role AS actor_role
    FROM history h LEFT JOIN users u ON u.id = h.actor_id WHERE h.application_id = ? ORDER BY h.id DESC`).all(app.id);
  const out = {
    application: parseApp(app),
    files,
    reviews,
    history,
    editable: isEditable(app),
    ecc_open: isEccOpen(app),
    next_statuses: forAdmin ? ADMIN_TRANSITIONS[app.status] || [] : [],
  };
  if (forAdmin) {
    out.owner = db.prepare('SELECT id, name, email, phone, organization FROM users WHERE id = ?').get(app.user_id);
  }
  return out;
}

function sanitizeAppFields(body) {
  const f = {};
  f.project_title = cleanStr(body.project_title, 160);
  f.site_location = cleanStr(body.site_location, 240);
  f.applicant_name = cleanStr(body.applicant_name, 160);
  f.address = cleanStr(body.address, 260);
  f.tel = cleanStr(body.tel, 40);
  f.email = cleanStr(body.email, 120).toLowerCase();
  f.other_use = cleanStr(body.other_use, 160);
  f.description = cleanStr(body.description, 3000);

  f.status_type = body.status_type === 'renewal' ? 'renewal' : 'new';

  const type = cleanStr(body.applicant_type, 40);
  f.applicant_type = APPLICANT_TYPES.some(([k]) => k === type) ? type : '';

  const uses = Array.isArray(body.special_uses) ? body.special_uses : [];
  const allowed = new Set(SPECIAL_USES.map(([k]) => k));
  f.special_uses = JSON.stringify([...new Set(uses.filter((u) => typeof u === 'string' && allowed.has(u)))]);

  if (body.area_ha === '' || body.area_ha === null || body.area_ha === undefined) f.area_ha = null;
  else {
    const n = Number(body.area_ha);
    if (!Number.isFinite(n) || n < 0 || n > 1e7) throw new HttpError(400, 'Area must be a number of hectares, 0 or more.');
    f.area_ha = n;
  }

  const de = cleanStr(body.date_expired, 10);
  if (de && !isDate(de)) throw new HttpError(400, 'Date expired must be a valid date.');
  f.date_expired = de || null;
  return f;
}

function submitProblems(app) {
  const p = [];
  const uses = JSON.parse(app.special_uses || '[]');
  if (!app.project_title) p.push('Enter a project title.');
  if (!app.site_location) p.push('Enter the site location.');
  if (!app.applicant_name) p.push('Enter the name of the applicant.');
  if (!app.address) p.push('Enter the applicant address.');
  if (!app.tel) p.push('Enter a telephone number.');
  if (!app.email || !isEmail(app.email)) p.push('Enter a valid email address.');
  if (!app.applicant_type) p.push('Choose the type of applicant.');
  if (!uses.length) p.push('Choose at least one type of special use.');
  if (uses.includes('other') && !app.other_use) p.push('Specify the other special use.');
  if (!app.description || app.description.length < 20) p.push('Describe the special use in at least 20 characters.');
  if (app.status_type === 'renewal' && !app.date_expired) p.push('Enter the date your current agreement expires.');
  const have = new Set(db.prepare('SELECT DISTINCT req_key FROM files WHERE application_id = ?').all(app.id).map((r) => r.req_key));
  for (const r of APP_REQS) if (!have.has(r.key)) p.push(`Upload: ${r.label}.`);
  return p;
}

function nextAppNo() {
  const year = manilaDate().slice(0, 4);
  const last = db.prepare('SELECT app_no FROM applications WHERE app_no LIKE ? ORDER BY app_no DESC LIMIT 1').get(`SBPS-${year}-%`);
  const seq = last ? Number(last.app_no.split('-')[2]) + 1 : 1;
  return `SBPS-${year}-${String(seq).padStart(4, '0')}`;
}

function removeStoredFile(storedName) {
  fs.unlink(path.join(UPLOAD_DIR, path.basename(storedName)), () => {});
}

function detectKind(buf) {
  if (buf.length < 8) return null;
  if (buf.subarray(0, 4).toString('latin1') === '%PDF') return 'pdf';
  if (buf[0] === 0x89 && buf.subarray(1, 4).toString('latin1') === 'PNG') return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) return 'docx';
  if (buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0) return 'doc';
  return null;
}
const EXT_KIND = { pdf: 'pdf', png: 'png', jpg: 'jpg', jpeg: 'jpg', docx: 'docx', doc: 'doc' };
const MIME = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', doc: 'application/msword' };

// ---------------------------------------------------------------- routes: public / auth
route('GET', '/api/config', {}, async (ctx) => {
  sendJson(ctx.res, 200, {
    applicant_types: APPLICANT_TYPES,
    special_uses: SPECIAL_USES,
    statuses: STATUSES,
    requirements: REQUIREMENTS,
    max_file_mb: MAX_FILE_BYTES / 1024 / 1024,
    contact: {
      office: 'Protected Area Management Office (PAMO), Sarangani Bay Protected Seascape',
      address: 'PENRO Alabel, Brgy. Poblacion, Alabel, Sarangani Province',
      numbers: ['0909-618-9917', '0995-305-0306'],
      email: 'sbpspasu@gmail.com',
      staff: {
        name: 'Krizelle C. Pangcatan',
        title: 'Sustainable Financing & Project Development Staff',
        numbers: ['508-2008', '0965-548-8334'],
      },
    },
  });
});

route('POST', '/api/register', {}, async (ctx) => {
  rateLimit(`reg|${clientIp(ctx.req)}`, 10, 60 * 60 * 1000);
  const b = await readJson(ctx.req);
  const name = cleanStr(b.name, 120);
  const email = cleanStr(b.email, 120).toLowerCase();
  const phone = cleanStr(b.phone, 40);
  const organization = cleanStr(b.organization, 160);
  if (name.length < 2) throw new HttpError(400, 'Enter your full name.');
  if (!isEmail(email)) throw new HttpError(400, 'Enter a valid email address.');
  const weak = checkPasswordStrength(b.password);
  if (weak) throw new HttpError(400, weak);
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
    throw new HttpError(409, 'An account with this email already exists. Log in instead.');
  }
  const hash = await hashPassword(b.password);
  const r = db.prepare('INSERT INTO users (name, email, phone, organization, password_hash, role, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(name, email, phone || null, organization || null, hash, 'applicant', nowIso());
  const { token, csrf } = createSession(Number(r.lastInsertRowid));
  setSessionCookie(ctx.res, token, SESSION_MS / 1000);
  const user = { id: Number(r.lastInsertRowid), name, email, phone, organization, role: 'applicant', must_change: false };
  sendJson(ctx.res, 201, { user, csrf });
});

route('POST', '/api/login', {}, async (ctx) => {
  const b = await readJson(ctx.req);
  const email = cleanStr(b.email, 120).toLowerCase();
  const key = `login|${clientIp(ctx.req)}|${email}`;
  rateLimit(key, 8, 15 * 60 * 1000);
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  const ok = u && u.active && typeof b.password === 'string' && (await verifyPassword(b.password, u.password_hash));
  if (!ok) {
    if (!u) await hashPassword('timing-pad'); // keep response time similar
    throw new HttpError(401, 'The email or password is incorrect.');
  }
  buckets.delete(key);
  const { token, csrf } = createSession(u.id);
  setSessionCookie(ctx.res, token, SESSION_MS / 1000);
  sendJson(ctx.res, 200, {
    user: { id: u.id, name: u.name, email: u.email, phone: u.phone, organization: u.organization, role: u.role, must_change: !!u.must_change },
    csrf,
  });
});

route('GET', '/api/me', {}, async (ctx) => {
  if (!ctx.user) return sendJson(ctx.res, 200, { user: null });
  sendJson(ctx.res, 200, { user: publicUser(ctx.user), csrf: ctx.user.csrf });
});

route('POST', '/api/logout', { auth: 'user' }, async (ctx) => {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(ctx.user.token_hash);
  setSessionCookie(ctx.res, '', 0);
  sendJson(ctx.res, 200, { ok: true });
});

route('POST', '/api/password', { auth: 'user' }, async (ctx) => {
  rateLimit(`pw|${ctx.user.user_id}`, 10, 15 * 60 * 1000);
  const b = await readJson(ctx.req);
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(ctx.user.user_id);
  if (!(await verifyPassword(String(b.current || ''), u.password_hash))) throw new HttpError(400, 'Your current password is incorrect.');
  const weak = checkPasswordStrength(b.next);
  if (weak) throw new HttpError(400, weak);
  if (b.next === b.current) throw new HttpError(400, 'Choose a password different from your current one.');
  db.prepare('UPDATE users SET password_hash = ?, must_change = 0 WHERE id = ?').run(await hashPassword(b.next), u.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').run(u.id, ctx.user.token_hash);
  sendJson(ctx.res, 200, { ok: true });
});

route('PUT', '/api/profile', { auth: 'user' }, async (ctx) => {
  const b = await readJson(ctx.req);
  const name = cleanStr(b.name, 120);
  if (name.length < 2) throw new HttpError(400, 'Enter your full name.');
  db.prepare('UPDATE users SET name = ?, phone = ?, organization = ? WHERE id = ?')
    .run(name, cleanStr(b.phone, 40) || null, cleanStr(b.organization, 160) || null, ctx.user.user_id);
  const u = db.prepare('SELECT id, name, email, phone, organization, role, must_change FROM users WHERE id = ?').get(ctx.user.user_id);
  sendJson(ctx.res, 200, { user: { ...u, must_change: !!u.must_change } });
});

// ---------------------------------------------------------------- routes: applicant
route('GET', '/api/applications', { auth: 'user' }, async (ctx) => {
  const rows = db.prepare('SELECT * FROM applications WHERE user_id = ? ORDER BY updated_at DESC').all(ctx.user.user_id);
  const counts = db.prepare(`SELECT f.application_id, COUNT(DISTINCT f.req_key) AS n FROM files f
    JOIN applications a ON a.id = f.application_id WHERE a.user_id = ? AND f.req_key <> 'ecc' GROUP BY f.application_id`)
    .all(ctx.user.user_id);
  const byApp = Object.fromEntries(counts.map((c) => [c.application_id, c.n]));
  sendJson(ctx.res, 200, {
    applications: rows.map((r) => ({ ...parseApp(r), req_done: byApp[r.id] || 0, req_total: APP_REQS.length })),
  });
});

route('POST', '/api/applications', { auth: 'user' }, async (ctx) => {
  if (ctx.user.role === 'admin') throw new HttpError(403, 'Admin accounts review applications. Register an applicant account to apply.');
  const drafts = db.prepare("SELECT COUNT(*) AS n FROM applications WHERE user_id = ? AND status = 'draft'").get(ctx.user.user_id).n;
  if (drafts >= 10) throw new HttpError(400, 'You have 10 drafts open. Finish or delete one before starting another.');
  const b = await readJson(ctx.req);
  const t = nowIso();
  const u = db.prepare('SELECT name, email, phone FROM users WHERE id = ?').get(ctx.user.user_id);
  const r = db.prepare(`INSERT INTO applications (user_id, status, status_type, applicant_name, email, tel, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(ctx.user.user_id, 'draft', b.status_type === 'renewal' ? 'renewal' : 'new', u.name, u.email, u.phone || '', t, t);
  addHistory(Number(r.lastInsertRowid), ctx.user.user_id, 'Started a draft application', null, 'draft');
  sendJson(ctx.res, 201, { id: Number(r.lastInsertRowid) });
});

route('GET', '/api/applications/:id', { auth: 'user' }, async (ctx) => {
  const app = loadApp(ctx, ctx.params.id);
  sendJson(ctx.res, 200, appDetail(app, ctx.user.role === 'admin'));
});

route('PUT', '/api/applications/:id', { auth: 'user' }, async (ctx) => {
  const app = loadApp(ctx, ctx.params.id);
  if (ctx.user.role === 'admin' || app.user_id !== ctx.user.user_id) throw new HttpError(403, 'Only the applicant can edit this application.');
  if (!isEditable(app)) throw new HttpError(409, 'This application is locked while PAMO reviews it.');
  const f = sanitizeAppFields(await readJson(ctx.req));
  db.prepare(`UPDATE applications SET status_type=?, project_title=?, site_location=?, area_ha=?, applicant_name=?, address=?, tel=?,
      email=?, applicant_type=?, special_uses=?, other_use=?, description=?, date_expired=?, updated_at=? WHERE id=?`)
    .run(f.status_type, f.project_title, f.site_location, f.area_ha, f.applicant_name, f.address, f.tel, f.email,
      f.applicant_type, f.special_uses, f.other_use, f.description, f.date_expired, nowIso(), app.id);
  sendJson(ctx.res, 200, appDetail(db.prepare('SELECT * FROM applications WHERE id = ?').get(app.id), false));
});

route('DELETE', '/api/applications/:id', { auth: 'user' }, async (ctx) => {
  const app = loadApp(ctx, ctx.params.id);
  if (app.user_id !== ctx.user.user_id || app.status !== 'draft') throw new HttpError(409, 'Only your own drafts can be deleted.');
  const files = db.prepare('SELECT stored_name FROM files WHERE application_id = ?').all(app.id);
  db.prepare('DELETE FROM applications WHERE id = ?').run(app.id);
  files.forEach((f) => removeStoredFile(f.stored_name));
  sendJson(ctx.res, 200, { ok: true });
});

route('POST', '/api/applications/:id/submit', { auth: 'user' }, async (ctx) => {
  const app = loadApp(ctx, ctx.params.id);
  if (app.user_id !== ctx.user.user_id) throw new HttpError(403, 'Only the applicant can submit this application.');
  if (!isEditable(app)) throw new HttpError(409, 'This application has already been submitted.');
  const problems = submitProblems(app);
  if (problems.length) throw new HttpError(422, 'Complete the items below before you submit.', { problems });
  const resubmit = app.status === 'returned';
  db.exec('BEGIN');
  try {
    const appNo = app.app_no || nextAppNo();
    db.prepare(`UPDATE applications SET status='submitted', app_no=?, date_filed=COALESCE(date_filed, ?), submitted_at=?, updated_at=? WHERE id=?`)
      .run(appNo, manilaDate(), nowIso(), nowIso(), app.id);
    db.prepare("UPDATE req_reviews SET status='pending' WHERE application_id=? AND status='revision'").run(app.id);
    addHistory(app.id, ctx.user.user_id, resubmit ? 'Resubmitted after revision' : 'Submitted application', app.status, 'submitted');
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  sendJson(ctx.res, 200, appDetail(db.prepare('SELECT * FROM applications WHERE id = ?').get(app.id), false));
});

route('POST', '/api/applications/:id/ecc-submit', { auth: 'user' }, async (ctx) => {
  const app = loadApp(ctx, ctx.params.id);
  if (app.user_id !== ctx.user.user_id) throw new HttpError(403, 'Only the applicant can submit the ECC.');
  if (!isEccOpen(app)) throw new HttpError(409, 'You can submit the ECC after PAMB clearance is approved.');
  if (!db.prepare("SELECT 1 FROM files WHERE application_id = ? AND req_key = 'ecc'").get(app.id)) {
    throw new HttpError(422, 'Upload a copy of your ECC first.', { problems: ['Upload: Environmental Compliance Certificate (ECC).'] });
  }
  db.prepare("UPDATE applications SET status='ecc_submitted', updated_at=? WHERE id=?").run(nowIso(), app.id);
  db.prepare("UPDATE req_reviews SET status='pending' WHERE application_id=? AND req_key='ecc'").run(app.id);
  addHistory(app.id, ctx.user.user_id, 'Submitted ECC for SAPA approval', app.status, 'ecc_submitted');
  sendJson(ctx.res, 200, appDetail(db.prepare('SELECT * FROM applications WHERE id = ?').get(app.id), false));
});

// -- files
route('POST', '/api/applications/:id/files', { auth: 'user', raw: true }, async (ctx) => {
  const app = loadApp(ctx, ctx.params.id);
  if (app.user_id !== ctx.user.user_id) throw new HttpError(403, 'Only the applicant can upload files.');
  const reqKey = ctx.query.get('req');
  const def = REQ_BY_KEY[reqKey];
  if (!def) throw new HttpError(400, 'Unknown requirement.');
  const allowed = def.phase === 'post' ? isEccOpen(app) : isEditable(app);
  if (!allowed) throw new HttpError(409, def.phase === 'post'
    ? 'You can upload the ECC after PAMB clearance is approved.'
    : 'This application is locked while PAMO reviews it.');
  if (db.prepare('SELECT COUNT(*) AS n FROM files WHERE application_id = ?').get(app.id).n >= MAX_FILES_PER_APP) {
    throw new HttpError(400, 'This application has reached the file limit.');
  }
  let name = '';
  try { name = decodeURIComponent(String(ctx.req.headers['x-filename'] || '')); } catch { /* ignore */ }
  name = path.basename(name.replace(/[\u0000-\u001F\\/]/g, '_')).slice(0, 180) || 'file';
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  if (!EXT_KIND[ext]) throw new HttpError(415, 'Upload a PDF, JPG, PNG, DOC or DOCX file.');
  const buf = await readBody(ctx.req, MAX_FILE_BYTES);
  if (!buf.length) throw new HttpError(400, 'That file is empty.');
  const kind = detectKind(buf);
  if (kind !== EXT_KIND[ext] && !(kind === 'docx' && ext === 'doc')) {
    throw new HttpError(415, 'The file contents do not match its extension. Upload a real PDF, JPG, PNG, DOC or DOCX file.');
  }
  const stored = `${crypto.randomBytes(16).toString('hex')}.bin`;
  fs.writeFileSync(path.join(UPLOAD_DIR, stored), buf, { mode: 0o600 });
  const r = db.prepare('INSERT INTO files (application_id, req_key, original_name, stored_name, size, uploaded_by, uploaded_at) VALUES (?,?,?,?,?,?,?)')
    .run(app.id, reqKey, name, stored, buf.length, ctx.user.user_id, nowIso());
  db.prepare('UPDATE applications SET updated_at = ? WHERE id = ?').run(nowIso(), app.id);
  sendJson(ctx.res, 201, { file: { id: Number(r.lastInsertRowid), req_key: reqKey, original_name: name, size: buf.length, uploaded_at: nowIso() } });
});

route('DELETE', '/api/files/:id', { auth: 'user' }, async (ctx) => {
  const f = db.prepare('SELECT * FROM files WHERE id = ?').get(Number(ctx.params.id));
  if (!f) throw new HttpError(404, 'File not found.');
  const app = loadApp(ctx, f.application_id);
  if (app.user_id !== ctx.user.user_id) throw new HttpError(403, 'Only the applicant can remove files.');
  const def = REQ_BY_KEY[f.req_key];
  const allowed = def && def.phase === 'post' ? isEccOpen(app) : isEditable(app);
  if (!allowed) throw new HttpError(409, 'Files can’t be removed while PAMO reviews this application.');
  db.prepare('DELETE FROM files WHERE id = ?').run(f.id);
  removeStoredFile(f.stored_name);
  sendJson(ctx.res, 200, { ok: true });
});

route('GET', '/api/files/:id', { auth: 'user' }, async (ctx) => {
  const f = db.prepare('SELECT * FROM files WHERE id = ?').get(Number(ctx.params.id));
  if (!f) throw new HttpError(404, 'File not found.');
  loadApp(ctx, f.application_id); // authorization
  const full = path.join(UPLOAD_DIR, path.basename(f.stored_name));
  if (!fs.existsSync(full)) throw new HttpError(404, 'File is missing from storage.');
  const ext = f.original_name.includes('.') ? f.original_name.split('.').pop().toLowerCase() : '';
  const safe = encodeURIComponent(f.original_name).replace(/['()]/g, escape);
  ctx.res.writeHead(200, {
    'Content-Type': MIME[EXT_KIND[ext]] || 'application/octet-stream',
    'Content-Length': f.size,
    'Content-Disposition': `attachment; filename*=UTF-8''${safe}`,
    'Cache-Control': 'private, no-store',
  });
  fs.createReadStream(full).pipe(ctx.res);
});

// ---------------------------------------------------------------- routes: admin
route('GET', '/api/admin/stats', { auth: 'admin' }, async (ctx) => {
  const byStatus = Object.fromEntries(Object.keys(STATUSES).map((k) => [k, 0]));
  for (const r of db.prepare("SELECT status, COUNT(*) AS c FROM applications WHERE status <> 'draft' GROUP BY status").all()) byStatus[r.status] = r.c;
  delete byStatus.draft;

  const useCounts = Object.fromEntries(SPECIAL_USES.map(([k]) => [k, 0]));
  const typeCounts = Object.fromEntries(APPLICANT_TYPES.map(([k]) => [k, 0]));
  for (const r of db.prepare("SELECT special_uses, applicant_type FROM applications WHERE status <> 'draft'").all()) {
    try { JSON.parse(r.special_uses).forEach((u) => { if (u in useCounts) useCounts[u] += 1; }); } catch { /* ignore */ }
    if (r.applicant_type in typeCounts) typeCounts[r.applicant_type] += 1;
  }

  const monthly = db.prepare(`SELECT substr(date_filed, 1, 7) AS month, COUNT(*) AS c FROM applications
    WHERE date_filed IS NOT NULL GROUP BY month ORDER BY month DESC LIMIT 6`).all().reverse();

  const attention = db.prepare(`SELECT id, app_no, project_title, applicant_name, status, updated_at FROM applications
    WHERE status IN ('submitted','ecc_submitted') ORDER BY updated_at ASC LIMIT 8`).all();

  const applicants = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'applicant'").get().n;
  const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
  const recent = db.prepare(`SELECT h.created_at, h.action, h.to_status, a.id AS application_id, a.app_no, u.name AS actor_name
    FROM history h JOIN applications a ON a.id = h.application_id LEFT JOIN users u ON u.id = h.actor_id
    WHERE a.status <> 'draft' AND h.to_status <> 'draft' ORDER BY h.id DESC LIMIT 8`).all();
  sendJson(ctx.res, 200, { total, applicants, by_status: byStatus, by_use: useCounts, by_type: typeCounts, monthly, attention, recent });
});

route('GET', '/api/admin/applications', { auth: 'admin' }, async (ctx) => {
  const where = ["a.status <> 'draft'"];
  const params = [];
  const status = ctx.query.get('status');
  if (status && STATUSES[status]) { where.push('a.status = ?'); params.push(status); }
  const type = ctx.query.get('type');
  if (type && APPLICANT_TYPES.some(([k]) => k === type)) { where.push('a.applicant_type = ?'); params.push(type); }
  const use = ctx.query.get('use');
  if (use && SPECIAL_USES.some(([k]) => k === use)) { where.push('a.special_uses LIKE ?'); params.push(`%"${use}"%`); }
  const q = cleanStr(ctx.query.get('q') || '', 80);
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, (m) => '\\' + m)}%`;
    where.push("(a.app_no LIKE ? ESCAPE '\\' OR a.applicant_name LIKE ? ESCAPE '\\' OR a.project_title LIKE ? ESCAPE '\\' OR a.site_location LIKE ? ESCAPE '\\')");
    params.push(like, like, like, like);
  }
  const rows = db.prepare(`SELECT a.*, u.name AS owner_name FROM applications a JOIN users u ON u.id = a.user_id
    WHERE ${where.join(' AND ')} ORDER BY a.updated_at DESC LIMIT 500`).all(...params);
  sendJson(ctx.res, 200, { applications: rows.map(parseApp) });
});

route('GET', '/api/healthz', {}, async (ctx) => {
  db.prepare('SELECT 1').get();
  sendJson(ctx.res, 200, { ok: true });
});

route('POST', '/api/admin/applications/:id/status', { auth: 'admin' }, async (ctx) => {
  const app = loadApp(ctx, ctx.params.id);
  const b = await readJson(ctx.req);
  const to = cleanStr(b.status, 30);
  const remark = cleanStr(b.remark, 2000);
  if (!(ADMIN_TRANSITIONS[app.status] || []).includes(to)) {
    throw new HttpError(409, `An application that is “${STATUSES[app.status]}” can’t move to “${STATUSES[to] || to}”.`);
  }
  if (['returned', 'rejected'].includes(to) && remark.length < 5) {
    throw new HttpError(400, 'Add a remark that tells the applicant why (at least 5 characters).');
  }
  if (to === 'pamb_cleared' && app.status === 'ecc_submitted' && remark.length < 5) {
    throw new HttpError(400, 'Add a remark that tells the applicant what is wrong with the ECC.');
  }
  let dateExpired = app.date_expired;
  if (to === 'sapa_approved') {
    const d = cleanStr(b.date_expired, 10);
    if (!isDate(d)) throw new HttpError(400, 'Enter the date the SAPA expires.');
    if (d <= manilaDate()) throw new HttpError(400, 'The expiry date must be in the future.');
    dateExpired = d;
  }
  db.prepare('UPDATE applications SET status = ?, date_expired = ?, updated_at = ? WHERE id = ?').run(to, dateExpired, nowIso(), app.id);
  addHistory(app.id, ctx.user.user_id, `Status changed to ${STATUSES[to]}`, app.status, to, remark);
  // Preserve the decision even if SMTP is unavailable or delivery fails.
  if (emailKind(app.status, to)) {
    sendDecisionEmail(app, to, remark, app.status).catch((err) => {
      console.error('Decision email could not be sent:', err.message);
    });
  }
  sendJson(ctx.res, 200, appDetail(db.prepare('SELECT * FROM applications WHERE id = ?').get(app.id), true));
});

route('POST', '/api/admin/applications/:id/requirements/:key', { auth: 'admin' }, async (ctx) => {
  const app = loadApp(ctx, ctx.params.id);
  const def = REQ_BY_KEY[ctx.params.key];
  if (!def) throw new HttpError(404, 'Unknown requirement.');
  const b = await readJson(ctx.req);
  const status = ['pending', 'accepted', 'revision'].includes(b.status) ? b.status : null;
  if (!status) throw new HttpError(400, 'Choose accepted, needs revision, or pending.');
  const remark = cleanStr(b.remark, 1000);
  if (status === 'revision' && remark.length < 3) throw new HttpError(400, 'Add a remark that tells the applicant what to fix.');
  db.prepare(`INSERT INTO req_reviews (application_id, req_key, status, remark, reviewed_by, reviewed_at) VALUES (?,?,?,?,?,?)
    ON CONFLICT(application_id, req_key) DO UPDATE SET status=excluded.status, remark=excluded.remark, reviewed_by=excluded.reviewed_by, reviewed_at=excluded.reviewed_at`)
    .run(app.id, def.key, status, remark || null, ctx.user.user_id, nowIso());
  addHistory(app.id, ctx.user.user_id, `${def.label}: ${status === 'accepted' ? 'accepted' : status === 'revision' ? 'needs revision' : 'set to pending'}`, null, null, remark);
  sendJson(ctx.res, 200, appDetail(db.prepare('SELECT * FROM applications WHERE id = ?').get(app.id), true));
});

route('GET', '/api/admin/users', { auth: 'admin' }, async (ctx) => {
  const users = db.prepare(`SELECT u.id, u.name, u.email, u.phone, u.organization, u.role, u.active, u.created_at,
      (SELECT COUNT(*) FROM applications a WHERE a.user_id = u.id AND a.status <> 'draft') AS applications
    FROM users u ORDER BY u.created_at DESC`).all();
  sendJson(ctx.res, 200, { users: users.map((u) => ({ ...u, active: !!u.active })) });
});

route('PATCH', '/api/admin/users/:id', { auth: 'admin' }, async (ctx) => {
  const id = Number(ctx.params.id);
  if (id === ctx.user.user_id) throw new HttpError(400, 'You can’t change your own role or access.');
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!u) throw new HttpError(404, 'User not found.');
  const b = await readJson(ctx.req);
  if (b.role !== undefined) {
    if (!['admin', 'applicant'].includes(b.role)) throw new HttpError(400, 'Role must be admin or applicant.');
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(b.role, id);
  }
  if (b.active !== undefined) {
    db.prepare('UPDATE users SET active = ? WHERE id = ?').run(b.active ? 1 : 0, id);
    if (!b.active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  }
  sendJson(ctx.res, 200, { ok: true });
});

route('GET', '/api/admin/export.csv', { auth: 'admin' }, async (ctx) => {
  const rows = db.prepare("SELECT * FROM applications WHERE status <> 'draft' ORDER BY id").all().map(parseApp);
  const useLabel = Object.fromEntries(SPECIAL_USES);
  const typeLabel = Object.fromEntries(APPLICANT_TYPES);
  const esc = (v) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // block spreadsheet formula injection
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ['Application no.', 'Status', 'Type', 'Project', 'Site location', 'Area (ha)', 'Applicant', 'Applicant type',
    'Special uses', 'Address', 'Telephone', 'Email', 'Date filed', 'Date expired', 'Last updated'];
  const lines = [head.map(esc).join(',')];
  for (const a of rows) {
    lines.push([a.app_no, STATUSES[a.status], a.status_type === 'renewal' ? 'Renewal' : 'New', a.project_title, a.site_location, a.area_ha,
      a.applicant_name, typeLabel[a.applicant_type] || '', a.special_uses.map((u) => (u === 'other' && a.other_use ? `Other: ${a.other_use}` : useLabel[u])).join('; '),
      a.address, a.tel, a.email, a.date_filed, a.date_expired, a.updated_at].map(esc).join(','));
  }
  const body = '﻿' + lines.join('\r\n') + '\r\n';
  ctx.res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="sbps-applications-${manilaDate()}.csv"`,
    'Cache-Control': 'no-store',
  });
  ctx.res.end(body);
});

// ---------------------------------------------------------------- static files
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8',
};
function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  let full;
  try { full = path.resolve(PUBLIC_DIR, '.' + path.normalize(decodeURIComponent(rel))); } catch { full = null; }
  if (!full || (full !== PUBLIC_DIR && !full.startsWith(PUBLIC_DIR + path.sep))) {
    res.writeHead(400); res.end('Bad request'); return;
  }
  fs.stat(full, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not found'); return; }
    const ext = path.extname(full).toLowerCase();
    res.writeHead(200, {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
    });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(full).pipe(res);
  });
}

// ---------------------------------------------------------------- server
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': [
    "default-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data:",
    "script-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join('; '),
};

async function handle(req, res) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/api/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end('Method not allowed'); return; }
    serveStatic(req, res, url.pathname);
    return;
  }
  try {
    let matched = false;
    for (const r of routes) {
      const m = r.re.exec(url.pathname);
      if (!m) continue;
      matched = true;
      if (r.method !== req.method) continue;
      const user = loadSession(req);
      const ctx = { req, res, params: m.groups || {}, query: url.searchParams, user };
      if (r.opts.auth && !user) throw new HttpError(401, 'Log in to continue.');
      if (r.opts.auth === 'admin' && user.role !== 'admin') throw new HttpError(403, 'This area is for PAMO administrators.');
      if (user && req.method !== 'GET' && req.method !== 'HEAD' && r.opts.auth) {
        const token = String(req.headers['x-csrf-token'] || '');
        const a = Buffer.from(token);
        const b = Buffer.from(user.csrf);
        if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new HttpError(403, 'Your session token is out of date. Reload the page and try again.');
      }
      await r.handler(ctx);
      return;
    }
    if (matched) throw new HttpError(405, 'Method not allowed.');
    throw new HttpError(404, 'Not found.');
  } catch (e) {
    if (res.headersSent) { res.destroy(); return; }
    if (e instanceof HttpError) sendJson(res, e.status, { error: e.message, ...(e.extra || {}) });
    else { console.error(e); sendJson(res, 500, { error: 'Something went wrong on the server. Try again.' }); }
  }
}

// ---------------------------------------------------------------- bootstrap admin
async function ensureAdmin() {
  if (db.prepare("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1").get()) return;
  const email = (process.env.ADMIN_EMAIL || 'admin@sbps.local').toLowerCase();
  const generated = !process.env.ADMIN_PASSWORD;
  const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  db.prepare('INSERT INTO users (name, email, password_hash, role, must_change, created_at) VALUES (?,?,?,?,?,?)')
    .run('PAMO Administrator', email, await hashPassword(password), 'admin', 1, nowIso());
  console.log('\n  First run: administrator account created');
  console.log(`    Email:    ${email}`);
  console.log(`    Password: ${password}${generated ? '   (generated; shown only once)' : ''}`);
  console.log('    You will be asked to change this password after you log in.\n');
}

const server = http.createServer((req, res) => { handle(req, res); });
server.requestTimeout = 60_000;
server.headersTimeout = 20_000;

if (require.main === module) {
  ensureAdmin().then(() => {
    server.listen(PORT, HOST, () => console.log(`  SBPS PAMB Clearance System running at http://localhost:${PORT}`));
  });
}

module.exports = { server, ensureAdmin };
