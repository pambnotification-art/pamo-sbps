(() => {
  'use strict';

  /* ================================================================
     Small DOM toolkit (builds nodes with textContent, never innerHTML)
     ================================================================ */
  const SVGNS = 'http://www.w3.org/2000/svg';

  function applyAttrs(el, attrs, deferred) {
    if (!attrs) return;
    for (const [k, v] of Object.entries(attrs)) {
      if (v === false || v === null || v === undefined) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.setAttribute('class', v);
      else if (k === 'style' && typeof v === 'object') {
        // CSSOM only (CSP-safe): custom properties via setProperty, camelCase via direct assignment
        for (const [p, val] of Object.entries(v)) { if (p.startsWith('--') || p.includes('-')) el.style.setProperty(p, String(val)); else el.style[p] = String(val); }
      } else if (['value', 'checked', 'disabled', 'selected', 'readOnly'].includes(k)) deferred.push([k, v]);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  function appendKids(el, kids) {
    for (const k of kids.flat(Infinity)) {
      if (k === null || k === undefined || k === false) continue;
      el.append(k.nodeType ? k : document.createTextNode(String(k)));
    }
  }
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    const deferred = [];
    applyAttrs(el, attrs, deferred);
    appendKids(el, kids);
    for (const [k, v] of deferred) el[k] = v;
    return el;
  }
  // Replace an element's children, flattening arrays and skipping null/false (native replaceChildren would print "null")
  function put(el, ...kids) {
    el.replaceChildren();
    appendKids(el, kids);
  }
  function s(tag, attrs, ...kids) {
    const el = document.createElementNS(SVGNS, tag);
    applyAttrs(el, attrs, []);
    appendKids(el, kids);
    return el;
  }

  /* ================================================================
     State, API, formatting
     ================================================================ */
  const state = { me: null, csrf: null, cfg: null, loaded: false, flush: null };
  const root = document.getElementById('app');

  class ApiError extends Error {
    constructor(status, message, data) { super(message); this.status = status; this.data = data; }
  }

  async function api(url, { method = 'GET', body, raw, headers } = {}) {
    const opts = { method, headers: { ...(headers || {}) }, credentials: 'same-origin' };
    if (method !== 'GET') opts.headers['X-CSRF-Token'] = state.csrf || '';
    if (raw !== undefined) opts.body = raw;
    else if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    else if (method !== 'GET') { opts.headers['Content-Type'] = 'application/json'; opts.body = '{}'; }
    let res;
    try { res = await fetch(url, opts); } catch { throw new ApiError(0, 'Can’t reach the server. Check your connection and try again.'); }
    let data = null;
    if ((res.headers.get('content-type') || '').includes('json')) data = await res.json().catch(() => null);
    if (!res.ok) {
      if (res.status === 401 && state.me) { state.me = null; state.csrf = null; location.hash = '#/login'; }
      throw new ApiError(res.status, (data && data.error) || 'Something went wrong. Try again.', data);
    }
    return data;
  }

  const TZ = 'Asia/Manila';
  const fmtDate = (v) => {
    if (!v) return '—';
    const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00+08:00`) : new Date(v);
    return d.toLocaleDateString('en-PH', { timeZone: TZ, year: 'numeric', month: 'short', day: 'numeric' });
  };
  const fmtDateTime = (v) => new Date(v).toLocaleString('en-PH', { timeZone: TZ, year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const fmtSize = (n) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
  const waiting = (iso) => {
    const d = Math.floor((Date.now() - Date.parse(iso)) / 864e5);
    return d <= 0 ? 'today' : d === 1 ? '1 day' : `${d} days`;
  };
  const label = (list, key) => (list.find(([k]) => k === key) || [])[1] || '';
  const statusName = (k) => state.cfg.statuses[k] || k;
  const chip = (k) => h('span', { class: `chip s-${k}` }, statusName(k));
  const usesText = (a) => (a.special_uses || []).map((u) => (u === 'other' && a.other_use ? `Other: ${a.other_use}` : label(state.cfg.special_uses, u))).join(', ') || '—';

  function toast(msg, bad) {
    const t = h('div', { class: `toast${bad ? ' bad' : ''}` }, msg);
    document.getElementById('toasts').append(t);
    setTimeout(() => t.remove(), bad ? 7000 : 4000);
  }
  const errMsg = (e) => (e && e.message) || 'Something went wrong. Try again.';

  /* ================================================================
     Depth-contour artwork (the bay as a bathymetric chart)
     ================================================================ */
  function ringPath(cx, cy, r, phase, wob) {
    const N = 44;
    const pts = [];
    for (let i = 0; i < N; i++) {
      const t = (i / N) * Math.PI * 2;
      const k = 1 + wob * (0.55 * Math.sin(2 * t + phase) + 0.3 * Math.sin(3 * t + phase * 1.7) + 0.15 * Math.sin(5 * t + phase * 2.3));
      pts.push([cx + Math.cos(t) * r * k * 1.3, cy + Math.sin(t) * r * k * 0.92]);
    }
    const mid = (a, b) => `${((a[0] + b[0]) / 2).toFixed(1)} ${((a[1] + b[1]) / 2).toFixed(1)}`;
    let d = `M${mid(pts[N - 1], pts[0])}`;
    for (let i = 0; i < N; i++) d += `Q${pts[i][0].toFixed(1)} ${pts[i][1].toFixed(1)} ${mid(pts[i], pts[(i + 1) % N])}`;
    return `${d}Z`;
  }
  function contourArt() {
    const W = 800, H = 900;
    const svg = s('svg', { class: 'contours', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid slice', 'aria-hidden': 'true', focusable: 'false' });
    const depths = { 4: '10 m', 8: '50 m', 12: '200 m', 15: '1,000 m' };
    for (let i = 0; i < 18; i++) {
      const r = 34 + i * 32;
      const p = s('path', {
        class: `ring${i % 4 === 0 ? ' major' : ''}`,
        d: ringPath(560 - i * 6, 520 + i * 3, r, 0.8 + i * 0.07, 0.06 + i * 0.012),
        pathLength: '1',
        style: { '--i': i },
      });
      svg.append(p);
    }
    for (const [i, txt] of Object.entries(depths)) {
      const r = 34 + Number(i) * 32;
      svg.append(s('text', { x: (560 - i * 6 + r * 1.3 * 0.97).toFixed(0), y: (520 + i * 3 + r * 0.92 * 0.2).toFixed(0), 'text-anchor': 'middle' }, txt));
    }
    return svg;
  }
  /*
  function brandMark() {
    return s('svg', { width: 34, height: 34, viewBox: '0 0 64 64', 'aria-hidden': 'true' },
      s('rect', { width: 64, height: 64, rx: 14, fill: '#124a52' }),
      s('path', { d: 'M32 12c11 0 20 8 20 19s-9 21-21 21S12 43 12 32 21 12 32 12z', fill: 'none', stroke: '#7cc4b8', 'stroke-width': 2.6 }),
      s('path', { d: 'M33 20c7 0 13 5 13 12s-6 13-14 13-12-6-12-13 6-12 13-12z', fill: 'none', stroke: '#b7e3da', 'stroke-width': 2.6 }),
      s('circle', { cx: 33, cy: 32, r: 5, fill: '#f2b705' }));
  }
  */
  function brandMark() {
    return h('img', { src: '/images/sbps-logo.png', alt: '', width: 34, height: 34 });
  }

  /* ================================================================
     Layout
     ================================================================ */
  function shell(content, active) {
    const admin = state.me.role === 'admin';
    const links = admin
      ? [['#/admin', 'Dashboard', 'dash'], ['#/admin/applications', 'Applications', 'apps'], ['#/admin/users', 'Users', 'users'], ['#/account', 'Account', 'account']]
      : [['#/', 'My applications', 'home'], ['#/account', 'Account', 'account']];
    const c = state.cfg.contact;
    return h('div', { class: 'app-shell' },
      h('header', { class: 'topbar' },
        h('div', { class: 'topbar-inner' },
          h('a', { class: 'brand', href: admin ? '#/admin' : '#/' }, brandMark(),
            h('span', null, 'PAMB Clearance desk', h('small', null, 'Sarangani Bay Protected Seascape'))),
          h('nav', { class: 'nav', 'aria-label': 'Main' },
            links.map(([href, text, key]) => h('a', { href, 'aria-current': key === active ? 'page' : false }, text))),
          h('div', { class: 'who' },
            h('span', null, state.me.name),
            h('button', { class: 'btn ghost small', type: 'button', onclick: logout }, 'Log out')))),
      h('main', { id: 'main' }, content),
      h('footer', { class: 'foot' },
        h('p', null, `${c.office}. ${c.address}.`),
        h('p', null, `Phone ${c.numbers.join(' or ')} · `, h('a', { href: `mailto:${c.email}` }, c.email))));
  }

  async function logout() {
    try { await api('/api/logout', { method: 'POST' }); } catch { /* ignore */ }
    state.me = null; state.csrf = null;
    location.hash = '#/login';
    render();
  }

  function authLayout(card) {
    return h('div', { class: 'auth' },
      h('section', { class: 'auth-art' },
        contourArt(),
        h('div', { class: 'copy' },
          h('div', { class: 'crests' },
            h('img', { src: '/images/denr-logo.png', alt: 'DENR logo', width: 84, height: 84 }),
            h('img', { src: '/images/sbps-logo.png', alt: 'Sarangani Bay Protected Seascape logo', width: 74, height: 84 })),
          h('p', { class: 'place' }, 'PROTECTED AREA MANAGEMENT OFFICE'),
          h('h1', null, 'Sarangani Bay Protected Seascape'),
          h('p', null, 'Apply for a PAMB clearance and a Special Agreement in Protected Area (SAPA), submit your requirements, and follow the review from one place.')),
        h('ol', null,
          h('li', null, 'Create an account'),
          h('li', null, 'Fill in the application form and upload your requirements'),
          h('li', null, 'PAMO reviews and may return it for revision'),
          h('li', null, 'After PAMB clearance, upload your ECC for SAPA approval'))),
      h('section', { class: 'auth-form' }, h('div', { class: 'auth-card' }, card)));
  }

  function field(lbl, input, hint, id) {
    return h('div', { class: 'field' }, h('label', { for: id }, lbl), input, hint ? h('p', { class: 'hint', id: `${id}-hint` }, hint) : null);
  }
  function loading(text) { return h('div', { class: 'loading' }, text || 'Loading…'); }
  function errorPanel(e, retry) {
    return h('div', { class: 'alert bad' }, h('h3', null, 'We couldn’t load this page'), h('p', null, errMsg(e)),
      retry ? h('button', { class: 'btn ghost small', type: 'button', onclick: retry }, 'Try again') : null);
  }
  function problemsAlert(title, problems) {
    return h('div', { class: 'alert warn', role: 'alert' }, h('h3', null, title), h('ul', null, problems.map((p) => h('li', null, p))));
  }

  /* ================================================================
     Pages: auth
     ================================================================ */
  function pageLogin() {
    const errBox = h('p', { class: 'err', role: 'alert', hidden: true });
    const btn = h('button', { class: 'btn', type: 'submit' }, 'Log in');
    const email = h('input', { id: 'email', type: 'email', autocomplete: 'username', required: true, autofocus: true });
    const pw = h('input', { id: 'password', type: 'password', autocomplete: 'current-password', required: true });
    const form = h('form', {
      novalidate: true,
      onsubmit: async (ev) => {
        ev.preventDefault();
        errBox.hidden = true; btn.disabled = true;
        try {
          const r = await api('/api/login', { method: 'POST', body: { email: email.value, password: pw.value } });
          state.me = r.user; state.csrf = r.csrf;
          location.hash = r.user.role === 'admin' ? '#/admin' : '#/';
          render();
        } catch (e) { errBox.textContent = errMsg(e); errBox.hidden = false; btn.disabled = false; }
      },
    },
      field('Email', email, null, 'email'), field('Password', pw, null, 'password'), errBox, btn);
    return { title: 'Log in', node: authLayout([
      h('h2', null, 'Log in'),
      h('p', null, 'Use the account you registered with.'),
      form,
      h('p', { class: 'auth-alt' }, 'New here? ', h('a', { href: '#/register' }, 'Create an applicant account')),
    ]), bare: true };
  }

  function pageRegister() {
    const errBox = h('p', { class: 'err', role: 'alert', hidden: true });
    const btn = h('button', { class: 'btn', type: 'submit' }, 'Create account');
    const f = {
      name: h('input', { id: 'name', type: 'text', autocomplete: 'name', required: true, maxlength: 120 }),
      org: h('input', { id: 'org', type: 'text', autocomplete: 'organization', maxlength: 160 }),
      phone: h('input', { id: 'phone', type: 'tel', autocomplete: 'tel', maxlength: 40 }),
      email: h('input', { id: 'email', type: 'email', autocomplete: 'email', required: true, maxlength: 120 }),
      pw: h('input', { id: 'pw', type: 'password', autocomplete: 'new-password', required: true, 'aria-describedby': 'pw-hint' }),
      pw2: h('input', { id: 'pw2', type: 'password', autocomplete: 'new-password', required: true }),
    };
    const form = h('form', {
      novalidate: true,
      onsubmit: async (ev) => {
        ev.preventDefault();
        errBox.hidden = true;
        if (f.pw.value !== f.pw2.value) { errBox.textContent = 'The two passwords don’t match.'; errBox.hidden = false; return; }
        btn.disabled = true;
        try {
          const r = await api('/api/register', { method: 'POST', body: { name: f.name.value, organization: f.org.value, phone: f.phone.value, email: f.email.value, password: f.pw.value } });
          state.me = r.user; state.csrf = r.csrf;
          location.hash = '#/';
          render();
          toast('Account created. You can start your application now.');
        } catch (e) { errBox.textContent = errMsg(e); errBox.hidden = false; btn.disabled = false; }
      },
    },
      field('Full name', f.name, null, 'name'),
      field('Organization or business (optional)', f.org, null, 'org'),
      field('Mobile or telephone number', f.phone, null, 'phone'),
      field('Email', f.email, null, 'email'),
      field('Password', f.pw, 'At least 8 characters, with a letter and a number.', 'pw'),
      field('Confirm password', f.pw2, null, 'pw2'),
      errBox, btn);
    return { title: 'Create account', node: authLayout([
      h('h2', null, 'Create an account'),
      h('p', null, 'An account lets you save drafts, upload requirements, and track your application.'),
      form,
      h('p', { class: 'auth-alt' }, 'Already registered? ', h('a', { href: '#/login' }, 'Log in')),
    ]), bare: true };
  }

  /* ================================================================
     Pages: account
     ================================================================ */
  function pageAccount() {
    const u = state.me;
    const pErr = h('p', { class: 'err', role: 'alert', hidden: true });
    const nm = h('input', { id: 'a-name', type: 'text', value: u.name, maxlength: 120, required: true });
    const ph = h('input', { id: 'a-phone', type: 'tel', value: u.phone || '', maxlength: 40 });
    const og = h('input', { id: 'a-org', type: 'text', value: u.organization || '', maxlength: 160 });
    const profile = h('form', {
      novalidate: true,
      onsubmit: async (ev) => {
        ev.preventDefault(); pErr.hidden = true;
        try {
          const r = await api('/api/profile', { method: 'PUT', body: { name: nm.value, phone: ph.value, organization: og.value } });
          state.me = { ...state.me, ...r.user };
          toast('Profile saved.'); render();
        } catch (e) { pErr.textContent = errMsg(e); pErr.hidden = false; }
      },
    },
      field('Full name', nm, null, 'a-name'), field('Telephone', ph, null, 'a-phone'), field('Organization', og, null, 'a-org'),
      h('div', { class: 'field' }, h('div', { class: 'label' }, 'Email'), h('input', { type: 'email', value: u.email, readOnly: true, 'aria-label': 'Email' }), h('p', { class: 'hint' }, 'To change your email, contact PAMO.')),
      pErr, h('button', { class: 'btn', type: 'submit' }, 'Save profile'));

    const wErr = h('p', { class: 'err', role: 'alert', hidden: true });
    const cur = h('input', { id: 'cur', type: 'password', autocomplete: 'current-password', required: true });
    const nxt = h('input', { id: 'nxt', type: 'password', autocomplete: 'new-password', required: true });
    const nx2 = h('input', { id: 'nx2', type: 'password', autocomplete: 'new-password', required: true });
    const pwForm = h('form', {
      novalidate: true,
      onsubmit: async (ev) => {
        ev.preventDefault(); wErr.hidden = true;
        if (nxt.value !== nx2.value) { wErr.textContent = 'The two new passwords don’t match.'; wErr.hidden = false; return; }
        try {
          await api('/api/password', { method: 'POST', body: { current: cur.value, next: nxt.value } });
          state.me.must_change = false;
          cur.value = nxt.value = nx2.value = '';
          toast('Password changed. Other devices were logged out.'); render();
        } catch (e) { wErr.textContent = errMsg(e); wErr.hidden = false; }
      },
    },
      field('Current password', cur, null, 'cur'), field('New password', nxt, 'At least 8 characters, with a letter and a number.', 'nxt'),
      field('Confirm new password', nx2, null, 'nx2'), wErr, h('button', { class: 'btn', type: 'submit' }, 'Change password'));

    return {
      title: 'Account', active: 'account',
      node: h('div', null,
        h('div', { class: 'page-head' }, h('h1', { id: 'h1', tabindex: -1 }, 'Your account')),
        u.must_change ? h('div', { class: 'alert warn', role: 'alert' }, h('h3', null, 'Change your temporary password'), h('p', null, 'You are using a password that was generated for you. Set your own below before you continue.')) : null,
        h('div', { class: 'row2' },
          h('section', { class: 'panel' }, h('h2', null, 'Profile'), profile),
          h('section', { class: 'panel' }, h('h2', null, 'Password'), pwForm))),
    };
  }

  /* ================================================================
     Pages: applicant home
     ================================================================ */
  async function pageHome() {
    const [{ applications }] = await Promise.all([api('/api/applications')]);
    const c = state.cfg.contact;
    const starting = { busy: false };
    async function start(type) {
      if (starting.busy) return; starting.busy = true;
      try {
        const r = await api('/api/applications', { method: 'POST', body: { status_type: type } });
        location.hash = `#/app/${r.id}`;
      } catch (e) { toast(errMsg(e), true); starting.busy = false; }
    }
    const table = applications.length
      ? h('div', { class: 'table-wrap' }, h('table', { class: 'list stack' },
        h('thead', null, h('tr', null, ['Application', 'Status', 'Requirements', 'Updated', ''].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', null, applications.map((a) => h('tr', null,
          h('td', { 'data-label': 'Application' }, h('div', { class: 'cell-title' }, a.project_title || 'Untitled application'),
            h('div', { class: 'cell-sub' }, a.app_no ? `${a.app_no} · ` : 'No application number yet · ', a.status_type === 'renewal' ? 'Renewal' : 'New')),
          h('td', { 'data-label': 'Status' }, chip(a.status)),
          h('td', { class: 'num', 'data-label': 'Requirements' }, `${a.req_done} of ${a.req_total} uploaded`),
          h('td', { class: 'num', 'data-label': 'Updated' }, fmtDate(a.updated_at)),
          h('td', { class: 'go', 'data-label': '' }, h('a', { href: `#/app/${a.id}` }, a.status === 'draft' || a.status === 'returned' ? 'Continue' : 'Open', h('span', { class: 'sr-only' }, ` ${a.project_title || 'application'}`))))))))
      : h('div', { class: 'empty' }, h('h3', null, 'You have no applications yet'),
        h('p', null, 'Start one now. You can save it as a draft and finish it later.'),
        h('button', { class: 'btn accent', type: 'button', onclick: () => start('new') }, 'Start an application'));
    return {
      title: 'My applications', active: 'home',
      node: h('div', null,
        h('div', { class: 'page-head' },
          h('div', null, h('h1', { id: 'h1', tabindex: -1 }, 'Your applications'),
            h('p', null, 'Apply for a PAMB clearance and a Special Agreement in Protected Area (SAPA) for activities inside the Sarangani Bay Protected Seascape.')),
          applications.length ? h('div', { class: 'actions', style: { margin: 0 } },
            h('button', { class: 'btn accent', type: 'button', onclick: () => start('new') }, 'Start a new application'),
            h('button', { class: 'btn ghost', type: 'button', onclick: () => start('renewal') }, 'Renew a SAPA')) : null),
        h('div', { class: 'split' },
          h('section', { class: 'panel' }, h('h2', null, 'Applications'), table),
          h('aside', { class: 'aside' },
            h('section', { class: 'panel' }, h('h2', null, 'How it works'),
              h('ol', { class: 'lead-steps' },
                h('li', null, 'Fill in the application form (Annex A).'),
                h('li', null, `Upload each of the ${state.cfg.requirements.filter((r) => r.phase === 'application').length} requirements.`),
                h('li', null, 'Submit. PAMO reviews it and may return it with remarks.'),
                h('li', null, 'After PAMB clearance, upload your Environmental Compliance Certificate (ECC) for SAPA approval.'))),
            h('section', { class: 'panel' }, h('h2', null, 'Questions about your application?'),
              h('p', { class: 'muted' }, 'Contact the Sustainable Financing & Project Development Staff.'),
              h('dl', { class: 'facts' },
                h('dt', null, 'Staff'), h('dd', null, c.staff.name),
                h('dt', null, 'Phone'), h('dd', null, c.staff.numbers.join(' or ')),
                h('dt', null, 'PAMO'), h('dd', null, c.numbers.join(' or ')),
                h('dt', null, 'Email'), h('dd', null, h('a', { href: `mailto:${c.email}` }, c.email))))))),
    };
  }

  /* ================================================================
     Pages: applicant application (Annex A form + requirements)
     ================================================================ */
  const FIELDS = ['status_type', 'project_title', 'site_location', 'area_ha', 'applicant_name', 'address', 'tel', 'email', 'applicant_type', 'special_uses', 'other_use', 'description', 'date_expired'];

  async function pageApplication(id) {
    let detail = await api(`/api/applications/${id}`);
    const cfg = state.cfg;
    const form = {};
    const loadForm = () => { for (const k of FIELDS) form[k] = Array.isArray(detail.application[k]) ? [...detail.application[k]] : (detail.application[k] ?? ''); };
    loadForm();

    const mounts = { top: h('div'), form: h('section', { class: 'panel', id: 'annex-a' }), reqs: h('section', { class: 'panel', id: 'requirements' }), submit: h('div'), ecc: h('div'), aside: h('aside', { class: 'aside' }) };
    let dirty = false, saving = null, timer = null;
    const saveState = h('span', { class: 'save-state', 'aria-live': 'polite' });

    const app = () => detail.application;
    const appReqs = cfg.requirements.filter((r) => r.phase === 'application');

    async function save({ quiet } = {}) {
      clearTimeout(timer);
      if (!dirty || !detail.editable) return true;
      if (saving) await saving;
      saveState.textContent = 'Saving…';
      saving = api(`/api/applications/${id}`, { method: 'PUT', body: form });
      try {
        detail = await saving; dirty = false;
        saveState.textContent = `Saved ${new Date().toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: TZ })}`;
        drawTop(); drawAside();
        return true;
      } catch (e) {
        saveState.textContent = 'Not saved';
        if (!quiet) toast(errMsg(e), true);
        return false;
      } finally { saving = null; }
    }
    state.flush = () => save({ quiet: true });
    const touch = () => { dirty = true; saveState.textContent = 'Unsaved changes'; clearTimeout(timer); timer = setTimeout(() => save(), 1500); };
    const bind = (key, transform) => (ev) => { form[key] = transform ? transform(ev.target) : ev.target.value; touch(); };

    /* ----- top ----- */
    function latestDecision() {
      return detail.history.find((x) => x.to_status && ['returned', 'rejected', 'pamb_cleared'].includes(x.to_status) && x.actor_role === 'admin');
    }
    function drawTop() {
      const a = app();
      const d = latestDecision();
      const kids = [
        h('a', { class: 'back', href: '#/' }, '← Your applications'),
        h('div', { class: 'page-head' },
          h('div', null, h('h1', { id: 'h1', tabindex: -1 }, a.project_title || 'New application'),
            h('p', null, a.app_no ? `Application no. ${a.app_no}` : 'Application number is assigned when you submit.')),
          chip(a.status)),
      ];
      if (a.status === 'returned' && d && d.to_status === 'returned') {
        kids.push(h('div', { class: 'alert bad', role: 'alert' }, h('h3', null, 'PAMO returned this application'),
          h('p', null, d.remark || 'See the remarks on each requirement below.'),
          h('p', { class: 'muted' }, 'Fix the items marked “Needs revision”, then submit again.')));
      } else if (a.status === 'rejected') {
        kids.push(h('div', { class: 'alert bad' }, h('h3', null, 'This application was rejected'), h('p', null, (d && d.remark) || 'Contact PAMO for details.')));
      } else if (['submitted', 'under_review'].includes(a.status)) {
        kids.push(h('div', { class: 'alert info' }, h('h3', null, a.status === 'submitted' ? 'Submitted. Waiting for PAMO to start the review.' : 'PAMO is reviewing your application.'),
          h('p', null, 'You can’t edit it while it is under review. If anything is missing, PAMO will return it with remarks.')));
      } else if (a.status === 'pamb_cleared') {
        kids.push(h('div', { class: 'alert good' }, h('h3', null, 'Your PAMB clearance is approved'),
          h('p', null, 'Next, upload your Environmental Compliance Certificate (ECC) below so PAMO can approve your SAPA.')));
      } else if (a.status === 'ecc_submitted') {
        kids.push(h('div', { class: 'alert info' }, h('h3', null, 'ECC submitted'), h('p', null, 'PAMO is reviewing your ECC for the approval of your SAPA.')));
      } else if (a.status === 'sapa_approved') {
        kids.push(h('div', { class: 'alert good' }, h('h3', null, 'Your SAPA is approved'), h('p', null, a.date_expired ? `It expires on ${fmtDate(a.date_expired)}. To renew, start a renewal application before that date.` : 'Contact PAMO for your agreement.')));
      }
      put(mounts.top, ...kids);
    }

    /* ----- Annex A form ----- */
    function drawForm() {
      const ed = detail.editable;
      const a = app();
      const choice = (type, name, value, text, checked, on) => h('label', { class: 'choice' }, h('input', { type, name, value, checked, disabled: !ed, onchange: on }), h('span', null, text));
      const usesBox = form.special_uses;
      put(mounts.form, 
        h('h2', null, 'Application form (Annex A)'),
        h('p', { class: 'sub' }, 'Republic of the Philippines · Department of Environment and Natural Resources · Region 12'),
        h('dl', { class: 'facts wide', style: { marginBottom: '1.25rem' } },
          h('dt', null, 'Protected area'), h('dd', null, 'Sarangani Bay Protected Seascape'),
          h('dt', null, 'Application no.'), h('dd', null, a.app_no || 'Assigned on submission'),
          h('dt', null, 'Date filed'), h('dd', null, a.date_filed ? fmtDate(a.date_filed) : 'Set on submission')),
        h('fieldset', null, h('legend', null, 'Status'),
          h('div', { class: 'choices cols' },
            choice('radio', 'status_type', 'new', 'New application', form.status_type === 'new', (e) => { form.status_type = 'new'; touch(); drawForm(); }),
            choice('radio', 'status_type', 'renewal', 'Renewal', form.status_type === 'renewal', (e) => { form.status_type = 'renewal'; touch(); drawForm(); }))),
        form.status_type === 'renewal' ? field('Date your current agreement expires', h('input', { id: 'f-exp', type: 'date', value: form.date_expired || '', disabled: !ed, oninput: bind('date_expired') }), null, 'f-exp') : null,
        h('div', { class: 'row2' },
          field('Project title', h('input', { id: 'f-title', type: 'text', maxlength: 160, value: form.project_title, disabled: !ed, oninput: bind('project_title') }), 'For example, “Mangrove boardwalk and visitor center”.', 'f-title'),
          field('Site location', h('input', { id: 'f-site', type: 'text', maxlength: 240, value: form.site_location, disabled: !ed, oninput: bind('site_location') }), 'Barangay and municipality or city.', 'f-site')),
        field('Area applied for (hectares)', h('input', { id: 'f-area', type: 'number', min: 0, step: 'any', value: form.area_ha ?? '', disabled: !ed, oninput: bind('area_ha') }), 'Optional. Use the SAPA area on your sketch plan.', 'f-area'),
        h('div', { class: 'row2' },
          field('Name of applicant', h('input', { id: 'f-name', type: 'text', maxlength: 160, value: form.applicant_name, disabled: !ed, oninput: bind('applicant_name') }), null, 'f-name'),
          field('Telephone no.', h('input', { id: 'f-tel', type: 'tel', maxlength: 40, value: form.tel, disabled: !ed, oninput: bind('tel') }), null, 'f-tel')),
        field('Address', h('input', { id: 'f-addr', type: 'text', maxlength: 260, value: form.address, disabled: !ed, oninput: bind('address') }), null, 'f-addr'),
        field('Email address', h('input', { id: 'f-mail', type: 'email', maxlength: 120, value: form.email, disabled: !ed, oninput: bind('email') }), null, 'f-mail'),
        h('fieldset', null, h('legend', null, 'Type of applicant'),
          h('div', { class: 'choices cols' }, cfg.applicant_types.map(([k, t]) => choice('radio', 'applicant_type', k, t, form.applicant_type === k, () => { form.applicant_type = k; touch(); })))),
        h('fieldset', null, h('legend', null, 'Type of special use applied for'),
          h('div', { class: 'choices cols' }, cfg.special_uses.map(([k, t]) => choice('checkbox', 'special_uses', k, t, usesBox.includes(k), (e) => {
            const set = new Set(form.special_uses); e.target.checked ? set.add(k) : set.delete(k); form.special_uses = [...set]; touch(); drawForm();
          })))),
        usesBox.includes('other') ? field('Specify the other special use', h('input', { id: 'f-other', type: 'text', maxlength: 160, value: form.other_use, disabled: !ed, oninput: bind('other_use') }), null, 'f-other') : null,
        field('Brief description of the special use applied for', h('textarea', { id: 'f-desc', maxlength: 3000, disabled: !ed, oninput: bind('description') }, form.description), 'Say what you will build or operate, where, and for how long.', 'f-desc'),
        ed ? h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', onclick: async () => { if (await save()) toast('Draft saved.'); } }, 'Save draft'), saveState,
          detail.application.status === 'draft' ? h('button', { class: 'link-btn danger', type: 'button', style: { marginLeft: 'auto' }, onclick: deleteDraft }, 'Delete this draft') : null) : null);
      if (form.description !== undefined) mounts.form.querySelector('#f-desc').value = form.description;
    }

    async function deleteDraft() {
      if (!confirm('Delete this draft and its uploaded files? This can’t be undone.')) return;
      try { dirty = false; await api(`/api/applications/${id}`, { method: 'DELETE' }); toast('Draft deleted.'); location.hash = '#/'; } catch (e) { toast(errMsg(e), true); }
    }

    /* ----- requirements ----- */
    function badgeFor(def) {
      const rv = detail.reviews[def.key];
      const n = detail.files.filter((f) => f.req_key === def.key).length;
      if (rv && rv.status === 'accepted') return h('span', { class: 'badge b-accepted' }, 'Accepted');
      if (rv && rv.status === 'revision') return h('span', { class: 'badge b-revision' }, 'Needs revision');
      return n ? h('span', { class: 'badge b-uploaded' }, 'Uploaded') : h('span', { class: 'badge b-missing' }, 'Not uploaded');
    }
    const busy = new Set();
    async function uploadFiles(def, list) {
      if (!list.length) return;
      if (!(await save())) return;
      busy.add(def.key); drawReqs(); drawEcc();
      for (const file of list) {
        if (file.size > cfg.max_file_mb * 1024 * 1024) { toast(`${file.name} is larger than ${cfg.max_file_mb} MB.`, true); continue; }
        try {
          await api(`/api/applications/${id}/files?req=${encodeURIComponent(def.key)}`, { method: 'POST', raw: file, headers: { 'X-Filename': encodeURIComponent(file.name), 'Content-Type': 'application/octet-stream' } });
        } catch (e) { toast(`${file.name}: ${errMsg(e)}`, true); }
      }
      busy.delete(def.key);
      await refresh();
    }
    async function removeFile(f) {
      if (!confirm(`Remove ${f.original_name}?`)) return;
      try { await api(`/api/files/${f.id}`, { method: 'DELETE' }); await refresh(); } catch (e) { toast(errMsg(e), true); }
    }
    function reqRow(def, canEdit) {
      const files = detail.files.filter((f) => f.req_key === def.key);
      const rv = detail.reviews[def.key];
      const input = h('input', { type: 'file', multiple: true, accept: '.pdf,.jpg,.jpeg,.png,.doc,.docx', hidden: true, onchange: (e) => { uploadFiles(def, [...e.target.files]); e.target.value = ''; } });
      return h('li', { class: 'req' },
        h('div', null,
          h('div', { class: 'req-title' }, def.label, badgeFor(def)),
          def.hint ? h('p', { class: 'hint' }, def.hint) : null,
          files.length ? h('ul', { class: 'files' }, files.map((f) => h('li', null,
            h('a', { href: `/api/files/${f.id}` }, f.original_name), h('span', { class: 'size' }, fmtSize(f.size)),
            canEdit ? h('button', { class: 'link-btn danger', type: 'button', onclick: () => removeFile(f), 'aria-label': `Remove ${f.original_name}` }, 'Remove') : null))) : null,
          rv && rv.remark && rv.status !== 'pending' ? h('p', { class: `remark${rv.status === 'accepted' ? ' okr' : ''}` }, h('strong', null, rv.status === 'accepted' ? 'PAMO note: ' : 'PAMO remark: '), rv.remark) : null),
        canEdit ? h('div', { class: 'req-actions' }, input,
          h('button', { class: 'btn ghost small', type: 'button', disabled: busy.has(def.key), onclick: () => input.click() }, busy.has(def.key) ? 'Uploading…' : files.length ? 'Add another file' : 'Upload file')) : null);
    }
    function drawReqs() {
      const canEdit = detail.editable;
      const groups = [];
      for (const r of appReqs) { let g = groups.find((x) => x.name === r.group); if (!g) { g = { name: r.group, items: [] }; groups.push(g); } g.items.push(r); }
      put(mounts.reqs, 
        h('h2', null, 'Requirements'),
        h('p', { class: 'sub' }, `Upload a PDF, JPG, PNG, DOC or DOCX file (up to ${cfg.max_file_mb} MB each). Add several files if a requirement has more than one page or part. The application form above counts as Annex 01.`),
        groups.map((g) => h('div', { class: 'req-group' }, h('h3', null, g.name), h('ul', { class: 'reqs' }, g.items.map((r) => reqRow(r, canEdit))))));
    }

    /* ----- submit ----- */
    function drawSubmit(problems) {
      if (!detail.editable) { put(mounts.submit, ); return; }
      const resub = app().status === 'returned';
      const btn = h('button', { class: 'btn accent', type: 'button' }, resub ? 'Submit again' : 'Submit application');
      btn.onclick = async () => {
        if (!confirm(resub ? 'Submit this application again for review?' : 'Submit this application to PAMO? You can’t edit it while it is under review.')) return;
        btn.disabled = true;
        try {
          if (!(await save())) { btn.disabled = false; return; }
          detail = await api(`/api/applications/${id}/submit`, { method: 'POST' });
          loadForm(); toast('Application submitted. PAMO will review it.'); drawAll(); window.scrollTo({ top: 0 });
        } catch (e) {
          btn.disabled = false;
          if (e.status === 422 && e.data && e.data.problems) { drawSubmit(e.data.problems); document.getElementById('submit-box')?.scrollIntoView({ block: 'center' }); } else toast(errMsg(e), true);
        }
      };
      put(mounts.submit, h('section', { class: 'panel', id: 'submit-box' }, h('h2', null, 'Submit for review'),
        problems ? problemsAlert('Complete these items first', problems) : null,
        h('p', null, 'PAMO checks your form and requirements. If something is missing or unclear, they return it to you with remarks.'),
        h('div', { class: 'actions' }, btn)));
    }

    /* ----- ECC ----- */
    function drawEcc() {
      const a = app();
      if (!['pamb_cleared', 'ecc_submitted', 'sapa_approved'].includes(a.status)) { put(mounts.ecc, ); return; }
      const def = cfg.requirements.find((r) => r.key === 'ecc');
      const open = detail.ecc_open;
      const hasFile = detail.files.some((f) => f.req_key === 'ecc');
      const btn = h('button', { class: 'btn accent', type: 'button', disabled: !hasFile }, 'Submit ECC for SAPA approval');
      btn.onclick = async () => {
        if (!confirm('Submit your ECC to PAMO for SAPA approval?')) return;
        btn.disabled = true;
        try { detail = await api(`/api/applications/${id}/ecc-submit`, { method: 'POST' }); toast('ECC submitted.'); drawAll(); window.scrollTo({ top: 0 }); } catch (e) { btn.disabled = false; toast(errMsg(e), true); }
      };
      put(mounts.ecc, h('section', { class: 'panel' }, h('h2', null, 'After PAMB clearance'),
        h('ul', { class: 'reqs' }, reqRow(def, open)),
        open ? h('div', { class: 'actions' }, btn) : null));
    }

    /* ----- aside ----- */
    function drawAside() {
      const a = app();
      const done = new Set(detail.files.filter((f) => f.req_key !== 'ecc').map((f) => f.req_key)).size;
      const pct = Math.round((done / appReqs.length) * 100);
      const c = cfg.contact;
      const bar = h('span'); bar.style.width = `${pct}%`;
      put(mounts.aside, 
        h('section', { class: 'panel' }, h('h2', null, 'Progress'),
          h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': appReqs.length, 'aria-valuenow': done, 'aria-label': 'Requirements uploaded' }, bar),
          h('p', { class: 'progress-label' }, `${done} of ${appReqs.length} requirements uploaded`),
          h('dl', { class: 'facts', style: { marginTop: '.9rem' } },
            h('dt', null, 'Status'), h('dd', null, chip(a.status)),
            h('dt', null, 'Filed'), h('dd', null, a.date_filed ? fmtDate(a.date_filed) : '—'),
            h('dt', null, 'Expires'), h('dd', null, a.date_expired ? fmtDate(a.date_expired) : '—'))),
        h('section', { class: 'panel' }, h('h2', null, 'History'),
          h('ol', { class: 'timeline' }, detail.history.slice(0, 12).map((x) => h('li', null, h('div', null, x.action), h('div', { class: 'when' }, `${fmtDateTime(x.created_at)}${x.actor_role === 'admin' ? ' · PAMO' : ''}`), x.remark ? h('p', { class: 'note' }, x.remark) : null)))),
        h('section', { class: 'panel' }, h('h2', null, 'Need help?'),
          h('p', { class: 'muted' }, `${c.staff.name}, ${c.staff.title}`),
          h('p', null, c.staff.numbers.join(' or '))));
    }

    async function refresh() { detail = await api(`/api/applications/${id}`); drawReqs(); drawSubmit(); drawEcc(); drawAside(); drawTop(); }
    function drawAll() { loadForm(); drawTop(); drawForm(); drawReqs(); drawSubmit(); drawEcc(); drawAside(); }
    drawAll();

    return {
      title: app().project_title || 'Application', active: 'home',
      node: h('div', { class: 'split' }, h('div', null, mounts.top, mounts.form, mounts.reqs, mounts.ecc, mounts.submit), mounts.aside),
      bare: false, raw: true,
    };
  }

  /* ================================================================
     Pages: admin dashboard
     ================================================================ */
  const SEG = { submitted: '#6fa8dc', under_review: '#f2b705', returned: '#e48a6b', pamb_cleared: '#5cbf8a', ecc_submitted: '#2a9d8f', sapa_approved: '#145a38', rejected: '#8a2f1b' };

  async function pageAdminDashboard() {
    const st = await api('/api/admin/stats');
    const by = st.by_status;
    const awaiting = by.submitted + by.ecc_submitted;
    const order = ['submitted', 'under_review', 'returned', 'pamb_cleared', 'ecc_submitted', 'sapa_approved', 'rejected'];
    const pipe = h('div', { class: 'pipe', role: 'img', 'aria-label': 'Applications by status' });
    order.forEach((k) => { if (by[k]) { const sp = h('span'); sp.style.width = `${(by[k] / st.total) * 100}%`; sp.style.background = SEG[k]; pipe.append(sp); } });
    const maxUse = Math.max(1, ...Object.values(st.by_use));
    const useRows = state.cfg.special_uses.filter(([k]) => st.by_use[k] > 0 || k !== 'other').map(([k, t]) => {
      const sp = h('span'); sp.style.width = `${(st.by_use[k] / maxUse) * 100}%`;
      return h('div', { class: 'bar-row' }, h('span', null, t), h('div', { class: 'track', 'aria-hidden': 'true' }, sp), h('span', { class: 'v' }, st.by_use[k]));
    });
    const maxM = Math.max(1, ...st.monthly.map((m) => m.c));
    const months = st.monthly.map((m) => {
      const col = h('div', { class: 'col' }); col.style.height = `${(m.c / maxM) * 100}%`;
      const [y, mo] = m.month.split('-');
      return h('div', { class: 'month' }, h('b', null, m.c), col, h('span', null, new Date(Number(y), Number(mo) - 1, 1).toLocaleString('en-PH', { month: 'short' })));
    });
    return {
      title: 'Dashboard', active: 'dash',
      node: h('div', null,
        h('div', { class: 'page-head' },
          h('div', null, h('h1', { id: 'h1', tabindex: -1 }, 'Dashboard'), h('p', null, new Date().toLocaleDateString('en-PH', { timeZone: TZ, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }))),
          h('a', { class: 'btn ghost', href: '/api/admin/export.csv' }, 'Export applications (CSV)')),
        h('div', { class: 'figures' },
          h('a', { class: `figure${awaiting ? ' hot' : ''}`, href: '#/admin/applications?status=submitted' }, h('div', { class: 'n' }, awaiting), h('div', { class: 'l' }, 'Waiting for you')),
          h('div', { class: 'figure' }, h('div', { class: 'n' }, by.under_review), h('div', { class: 'l' }, 'Under review')),
          h('div', { class: 'figure' }, h('div', { class: 'n' }, by.pamb_cleared), h('div', { class: 'l' }, 'PAMB cleared')),
          h('div', { class: 'figure' }, h('div', { class: 'n' }, by.sapa_approved), h('div', { class: 'l' }, 'SAPA approved')),
          h('div', { class: 'figure' }, h('div', { class: 'n' }, st.applicants), h('div', { class: 'l' }, 'Registered applicants'))),
        h('div', { class: 'dashboard-summary' },
          h('div', null,
            h('section', { class: 'panel' }, h('h2', null, 'Pipeline'),
              st.total ? [pipe, h('ul', { class: 'legend' }, order.map((k) => h('li', null, h('a', { href: `#/admin/applications?status=${k}` }, h('span', { class: 'sw', style: { background: SEG[k] } }), h('span', null, statusName(k)), h('span', { class: 'c' }, by[k])))))] : h('p', { class: 'muted' }, 'No submitted applications yet.')),
            h('section', { class: 'panel' }, h('h2', null, 'Special uses applied for'), h('div', { class: 'bars' }, useRows)),
            h('section', { class: 'panel' }, h('h2', null, 'Filed per month'), st.monthly.length ? h('div', { class: 'months' }, months) : h('p', { class: 'muted' }, 'Nothing filed yet.'))))),
    };
  }

  /* ================================================================
     Pages: admin application list
     ================================================================ */
  async function pageAdminApplications(query) {
    const params = new URLSearchParams(query || '');
    const { applications } = await api(`/api/admin/applications?${params}`);
    const activityStats = await api('/api/admin/stats');
    const cfg = state.cfg;
    const q = h('input', { id: 'q', type: 'search', value: params.get('q') || '', placeholder: 'Application no., applicant, project or site' });
    const st = h('select', { id: 'st' }, h('option', { value: '' }, 'All statuses'), Object.entries(cfg.statuses).filter(([k]) => k !== 'draft').map(([k, t]) => h('option', { value: k }, t)));
    const ty = h('select', { id: 'ty' }, h('option', { value: '' }, 'All applicant types'), cfg.applicant_types.map(([k, t]) => h('option', { value: k }, t)));
    const us = h('select', { id: 'us' }, h('option', { value: '' }, 'All special uses'), cfg.special_uses.map(([k, t]) => h('option', { value: k }, t)));
    st.value = params.get('status') || ''; ty.value = params.get('type') || ''; us.value = params.get('use') || '';
    const apply = (ev) => {
      ev && ev.preventDefault();
      const p = new URLSearchParams();
      if (q.value.trim()) p.set('q', q.value.trim());
      if (st.value) p.set('status', st.value); if (ty.value) p.set('type', ty.value); if (us.value) p.set('use', us.value);
      location.hash = `#/admin/applications${p.toString() ? `?${p}` : ''}`;
    };
    return {
      title: 'Applications', active: 'apps',
      node: h('div', null,
        h('div', { class: 'page-head' }, h('div', null, h('h1', { id: 'h1', tabindex: -1 }, 'Applications'), h('p', null, `${applications.length} ${applications.length === 1 ? 'application' : 'applications'} match your filters.`)),
          h('a', { class: 'btn ghost', href: '/api/admin/export.csv' }, 'Export all (CSV)')),
        h('div', { class: 'application-overview' },
          h('section', { class: 'panel' }, h('h2', null, 'Waiting for review'),
            activityStats.attention.length ? h('ul', { class: 'attn' }, activityStats.attention.map((a) => h('li', null,
              h('div', null, h('div', { class: 'cell-title' }, a.project_title || 'Untitled'), h('div', { class: 'cell-sub' }, `${a.app_no} · ${a.applicant_name}`)),
              h('div', { style: { textAlign: 'right' } }, chip(a.status), h('div', { class: 'wait' }, `Waiting ${waiting(a.updated_at)}`), h('a', { href: `#/admin/app/${a.id}` }, 'Review'))))) :
              h('div', { class: 'empty' }, h('h3', null, 'Nothing is waiting'), h('p', null, 'New submissions and ECC uploads will show up here.'))),
          h('section', { class: 'panel' }, h('h2', null, 'Recent activity'),
            activityStats.recent.length ? h('ul', { class: 'activity' }, activityStats.recent.map((r) => h('li', null,
              h('span', { class: 'when' }, fmtDateTime(r.created_at)), h('a', { href: `#/admin/app/${r.application_id}` }, r.app_no),
              ` · ${r.action}${r.actor_name ? ` · ${r.actor_name}` : ''}`))) : h('p', { class: 'muted' }, 'No activity yet.'))),
        h('form', { class: 'filters', onsubmit: apply },
          field('Search', q, null, 'q'), field('Status', st, null, 'st'), field('Applicant type', ty, null, 'ty'), field('Special use', us, null, 'us'),
          h('button', { class: 'btn', type: 'submit', style: { marginBottom: '1.05rem' } }, 'Apply filters')),
        h('section', { class: 'panel' },
          applications.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'list stack' },
            h('thead', null, h('tr', null, ['Application', 'Applicant', 'Special use', 'Status', 'Filed', 'Updated'].map((t) => h('th', { scope: 'col' }, t)))),
            h('tbody', null, applications.map((a) => h('tr', null,
              h('td', { 'data-label': 'Application' }, h('a', { class: 'cell-title', href: `#/admin/app/${a.id}` }, a.app_no), h('div', { class: 'cell-sub' }, a.project_title || '—')),
              h('td', { 'data-label': 'Applicant' }, h('div', null, a.applicant_name || '—'), h('div', { class: 'cell-sub' }, label(cfg.applicant_types, a.applicant_type))),
              h('td', { 'data-label': 'Special use' }, usesText(a)),
              h('td', { 'data-label': 'Status' }, chip(a.status)),
              h('td', { class: 'num', 'data-label': 'Filed' }, fmtDate(a.date_filed)),
              h('td', { class: 'num', 'data-label': 'Updated' }, fmtDate(a.updated_at))))))) :
            h('div', { class: 'empty' }, h('h3', null, 'No applications found'), h('p', null, 'Clear a filter or search for something else.'),
              h('a', { class: 'btn ghost small', href: '#/admin/applications' }, 'Clear filters')))),
    };
  }

  /* ================================================================
     Pages: admin review
     ================================================================ */
  async function pageAdminReview(id) {
    let detail = await api(`/api/applications/${id}`);
    const cfg = state.cfg;
    const mounts = { head: h('div'), decision: h('div'), details: h('div'), reqs: h('section', { class: 'panel' }), aside: h('aside', { class: 'aside' }) };
    const open = new Set(); // requirement keys with the revision box open

    const DECISION_LABEL = (to, from) => ({
      under_review: 'Start review',
      returned: 'Return to applicant for revision',
      pamb_cleared: from === 'ecc_submitted' ? 'Ask for a new ECC' : 'Grant PAMB clearance',
      sapa_approved: 'Approve SAPA',
      rejected: 'Reject application',
    }[to]);

    function drawHead() {
      const a = detail.application;
      put(mounts.head, h('a', { class: 'back', href: '#/admin/applications' }, '← All applications'),
        h('div', { class: 'page-head' }, h('div', null, h('h1', { id: 'h1', tabindex: -1 }, a.project_title || a.app_no), h('p', null, `${a.app_no} · filed ${fmtDate(a.date_filed)}`)), chip(a.status)));
    }

    function drawDecision() {
      const a = detail.application;
      const next = detail.next_statuses;
      if (!next.length) {
        const why = a.status === 'returned' ? 'This application was returned. The decision opens again when the applicant revises and resubmits it.'
          : a.status === 'pamb_cleared' ? 'PAMB clearance is granted. The decision opens again after the applicant uploads and submits the ECC.'
          : a.status === 'sapa_approved' ? 'The SAPA is approved. No further decision is needed.'
          : 'No further decision is available for this application.';
        put(mounts.decision, h('section', { class: 'panel decision is-disabled', 'aria-disabled': 'true' },
          h('h2', null, 'Decision'),
          h('p', { class: 'muted' }, why),
          h('fieldset', { disabled: true },
            h('div', { class: 'field' }, h('label', { for: 'd-remark' }, 'Remark'), h('textarea', { id: 'd-remark', disabled: true })),
            h('button', { class: 'btn', type: 'button', disabled: true }, 'Save decision'))));
        return;
      }
      let sel = next[0];
      const remark = h('textarea', { id: 'd-remark', maxlength: 2000 });
      const date = h('input', { id: 'd-date', type: 'date' });
      const dateField = field('SAPA expiry date', date, 'The date the agreement ends.', 'd-date');
      const err = h('p', { class: 'err', role: 'alert', hidden: true });
      const remarkLabel = h('label', { for: 'd-remark' }, 'Remark');
      const remarkHint = h('p', { class: 'hint' });
      function sync() {
        dateField.hidden = sel !== 'sapa_approved';
        const need = ['returned', 'rejected'].includes(sel) || (sel === 'pamb_cleared' && a.status === 'ecc_submitted');
        remarkLabel.textContent = need ? 'Remark for the applicant (required)' : 'Remark (optional)';
        remarkHint.textContent = need ? 'Say what is wrong and what to fix. The applicant sees this.' : 'The applicant sees this in their history.';
      }
      const btn = h('button', { class: 'btn', type: 'button' }, 'Save decision');
      btn.onclick = async () => {
        err.hidden = true;
        if (['rejected', 'sapa_approved', 'pamb_cleared'].includes(sel) && !confirm(`${DECISION_LABEL(sel, a.status)}?`)) return;
        btn.disabled = true;
        try {
          detail = await api(`/api/admin/applications/${id}/status`, { method: 'POST', body: { status: sel, remark: remark.value, date_expired: date.value } });
          toast(`Saved: ${statusName(detail.application.status)}.`); drawAll();
        } catch (e) { err.textContent = errMsg(e); err.hidden = false; btn.disabled = false; }
      };
      put(mounts.decision, h('section', { class: 'panel decision' }, h('h2', null, 'Decision'),
        h('fieldset', null, h('legend', null, 'Next step'),
          h('div', { class: 'choices' }, next.map((to) => h('label', { class: 'choice' }, h('input', { type: 'radio', name: 'decision', value: to, checked: to === sel, onchange: () => { sel = to; sync(); } }), h('span', null, DECISION_LABEL(to, a.status)))))),
        dateField, h('div', { class: 'field' }, remarkLabel, remark, remarkHint), err, btn));
      sync();
    }

    function drawDetails() {
      const a = detail.application;
      put(mounts.details, h('section', { class: 'panel' }, h('h2', null, 'Application form (Annex A)'),
        h('dl', { class: 'facts wide' },
          h('dt', null, 'Protected area'), h('dd', null, 'Sarangani Bay Protected Seascape'),
          h('dt', null, 'Application no.'), h('dd', null, a.app_no),
          h('dt', null, 'Application status'), h('dd', null, a.status_type === 'renewal' ? 'Renewal' : 'New'),
          h('dt', null, 'Date filed'), h('dd', null, fmtDate(a.date_filed)),
          h('dt', null, 'Date expired'), h('dd', null, fmtDate(a.date_expired)),
          h('dt', null, 'Name of applicant'), h('dd', null, a.applicant_name),
          h('dt', null, 'Type of applicant'), h('dd', null, label(cfg.applicant_types, a.applicant_type)),
          h('dt', null, 'Address'), h('dd', null, a.address),
          h('dt', null, 'Telephone'), h('dd', null, a.tel),
          h('dt', null, 'Email'), h('dd', null, h('a', { href: `mailto:${a.email}` }, a.email)),
          h('dt', null, 'Project title'), h('dd', null, a.project_title),
          h('dt', null, 'Site location'), h('dd', null, a.site_location),
          h('dt', null, 'Area applied for'), h('dd', null, a.area_ha != null ? `${a.area_ha} ha` : '—'),
          h('dt', null, 'Special use'), h('dd', null, usesText(a)),
          h('dt', null, 'Description'), h('dd', null, h('div', { style: { whiteSpace: 'pre-wrap' } }, a.description)))));
    }

    async function review(key, status, remark) {
      try { detail = await api(`/api/admin/applications/${id}/requirements/${key}`, { method: 'POST', body: { status, remark } }); open.delete(key); drawReqs(); drawAside(); }
      catch (e) { toast(errMsg(e), true); }
    }
    function drawReqs() {
      const a = detail.application;
      const defs = cfg.requirements.filter((r) => r.phase === 'application' || ['ecc_submitted', 'sapa_approved'].includes(a.status) || detail.files.some((f) => f.req_key === r.key));
      put(mounts.reqs, h('h2', null, 'Requirements'),
        h('p', { class: 'sub' }, 'Open each file, then mark the requirement accepted or tell the applicant what to fix. Notes on a requirement are shown to the applicant.'),
        h('ul', { class: 'reqs' }, defs.map((def) => {
          const files = detail.files.filter((f) => f.req_key === def.key);
          const rv = detail.reviews[def.key];
          const rem = h('input', { type: 'text', maxlength: 1000, placeholder: 'What should the applicant fix?', 'aria-label': `Remark for ${def.label}`, value: rv && rv.status === 'revision' ? rv.remark || '' : '' });
          const badge = rv && rv.status === 'accepted' ? h('span', { class: 'badge b-accepted' }, 'Accepted') : rv && rv.status === 'revision' ? h('span', { class: 'badge b-revision' }, 'Needs revision') : files.length ? h('span', { class: 'badge b-uploaded' }, 'Awaiting review') : h('span', { class: 'badge b-missing' }, 'Not uploaded');
          return h('li', { class: 'req', style: { gridTemplateColumns: '1fr' } },
            h('div', null,
              h('div', { class: 'req-title' }, def.label, badge),
              files.length ? h('ul', { class: 'files' }, files.map((f) => h('li', null, h('a', { href: `/api/files/${f.id}` }, f.original_name), h('span', { class: 'size' }, fmtSize(f.size))))) : h('p', { class: 'hint' }, 'No file uploaded.'),
              rv && rv.remark ? h('p', { class: `remark${rv.status === 'accepted' ? ' okr' : ''}` }, rv.remark) : null,
              h('div', { class: 'review-controls' },
                h('button', { class: 'btn small', type: 'button', disabled: !files.length || (rv && rv.status === 'accepted'), onclick: () => review(def.key, 'accepted', '') }, 'Accept'),
                open.has(def.key) || (rv && rv.status === 'revision') ? [rem, h('button', { class: 'btn danger small', type: 'button', onclick: () => review(def.key, 'revision', rem.value) }, 'Mark needs revision')] :
                  h('button', { class: 'btn ghost small', type: 'button', onclick: () => { open.add(def.key); drawReqs(); } }, 'Needs revision'),
                rv && rv.status !== 'pending' ? h('button', { class: 'link-btn', type: 'button', onclick: () => review(def.key, 'pending', '') }, 'Reset') : null)));
        })));
    }

    function drawAside() {
      const o = detail.owner;
      const accepted = Object.values(detail.reviews).filter((r) => r.status === 'accepted').length;
      const total = cfg.requirements.filter((r) => r.phase === 'application').length;
      put(mounts.aside, 
        h('section', { class: 'panel' }, h('h2', null, 'Review progress'), h('p', null, `${accepted} of ${total} requirements accepted`)),
        h('section', { class: 'panel' }, h('h2', null, 'Applicant account'),
          h('dl', { class: 'facts' }, h('dt', null, 'Name'), h('dd', null, o.name), h('dt', null, 'Email'), h('dd', null, o.email), h('dt', null, 'Phone'), h('dd', null, o.phone || '—'), h('dt', null, 'Organization'), h('dd', null, o.organization || '—'))),
        h('section', { class: 'panel' }, h('h2', null, 'History'),
          h('ol', { class: 'timeline' }, detail.history.slice(0, 20).map((x) => h('li', null, h('div', null, x.action), h('div', { class: 'when' }, `${fmtDateTime(x.created_at)}${x.actor_name ? ` · ${x.actor_name}` : ''}`), x.remark ? h('p', { class: 'note' }, x.remark) : null)))));
    }
    function drawAll() { drawHead(); drawDecision(); drawDetails(); drawReqs(); drawAside(); }
    drawAll();
    return { title: detail.application.app_no, active: 'apps', raw: true, node: h('div', { class: 'split' }, h('div', null, mounts.head, mounts.decision, mounts.reqs, mounts.details), mounts.aside) };
  }

  /* ================================================================
     Pages: admin users
     ================================================================ */
  async function pageAdminUsers() {
    const { users } = await api('/api/admin/users');
    async function patch(u, body) {
      try { await api(`/api/admin/users/${u.id}`, { method: 'PATCH', body }); toast('Saved.'); render(); } catch (e) { toast(errMsg(e), true); }
    }
    return {
      title: 'Users', active: 'users',
      node: h('div', null,
        h('div', { class: 'page-head' }, h('div', null, h('h1', { id: 'h1', tabindex: -1 }, 'Users'), h('p', null, 'Make a PAMO staff member an administrator, or turn off an account. New people register themselves as applicants.'))),
        h('section', { class: 'panel' }, h('div', { class: 'table-wrap' }, h('table', { class: 'list stack' },
          h('thead', null, h('tr', null, ['Name', 'Role', 'Applications', 'Joined', 'Access'].map((t) => h('th', { scope: 'col' }, t)))),
          h('tbody', null, users.map((u) => {
            const me = u.id === state.me.id;
            return h('tr', null,
              h('td', { 'data-label': 'Name' }, h('div', { class: 'cell-title' }, u.name, me ? ' (you)' : ''), h('div', { class: 'cell-sub' }, u.email), u.organization ? h('div', { class: 'cell-sub' }, u.organization) : null),
              h('td', { 'data-label': 'Role' }, u.role === 'admin' ? 'Administrator' : 'Applicant'),
              h('td', { class: 'num', 'data-label': 'Applications' }, u.applications),
              h('td', { class: 'num', 'data-label': 'Joined' }, fmtDate(u.created_at)),
              h('td', { 'data-label': 'Access' }, me ? h('span', { class: 'muted' }, 'Your account') : h('div', { class: 'actions', style: { margin: 0 } },
                h('button', { class: 'btn ghost small', type: 'button', onclick: () => { if (confirm(u.role === 'admin' ? `Make ${u.name} an applicant?` : `Make ${u.name} an administrator? They will see every application.`)) patch(u, { role: u.role === 'admin' ? 'applicant' : 'admin' }); } }, u.role === 'admin' ? 'Make applicant' : 'Make administrator'),
                h('button', { class: `btn small ${u.active ? 'danger' : 'ghost'}`, type: 'button', onclick: () => patch(u, { active: !u.active }) }, u.active ? 'Deactivate' : 'Reactivate'))));
          })))))),
    };
  }

  /* ================================================================
     Router
     ================================================================ */
  const ROUTES = [
    { re: /^#\/login$/, auth: false, page: () => pageLogin() },
    { re: /^#\/register$/, auth: false, page: () => pageRegister() },
    { re: /^#\/?$/, auth: 'applicant', page: () => pageHome() },
    { re: /^#\/app\/(\d+)$/, auth: 'applicant', page: (m) => pageApplication(m[1]) },
    { re: /^#\/account$/, auth: 'any', page: () => pageAccount() },
    { re: /^#\/admin\/?$/, auth: 'admin', page: () => pageAdminDashboard() },
    { re: /^#\/admin\/applications(?:\?(.*))?$/, auth: 'admin', page: (m) => pageAdminApplications(m[1]) },
    { re: /^#\/admin\/app\/(\d+)$/, auth: 'admin', page: (m) => pageAdminReview(m[1]) },
    { re: /^#\/admin\/users$/, auth: 'admin', page: () => pageAdminUsers() },
  ];

  let renderToken = 0;
  async function render() {
    const token = ++renderToken;
    if (state.flush) { const f = state.flush; state.flush = null; try { await f(); } catch { /* ignore */ } }
    try {
      if (!state.cfg) state.cfg = await api('/api/config');
      if (!state.loaded) {
        const me = await api('/api/me');
        state.me = me.user; state.csrf = me.csrf || null; state.loaded = true;
      }
    } catch (e) { root.replaceChildren(h('main', null, errorPanel(e, () => location.reload()))); return; }

    const hash = location.hash || '#/';
    const r = ROUTES.find((x) => x.re.test(hash));
    const m = r && r.re.exec(hash);
    const goto = (to) => { if (location.hash !== to) location.hash = to; else render(); };

    if (!r) return goto(state.me ? (state.me.role === 'admin' ? '#/admin' : '#/') : '#/login');
    if (!state.me && r.auth !== false) return goto('#/login');
    if (state.me && r.auth === false) return goto(state.me.role === 'admin' ? '#/admin' : '#/');
    if (state.me && r.auth === 'admin' && state.me.role !== 'admin') return goto('#/');
    if (state.me && r.auth === 'applicant' && state.me.role === 'admin') return goto('#/admin');
    if (state.me && state.me.must_change && hash !== '#/account') return goto('#/account');

    if (state.me) root.replaceChildren(shell(loading(), null));
    let page;
    try { page = await r.page(m); } catch (e) {
      if (token !== renderToken) return;
      if (e.status === 401) return;
      root.replaceChildren(shell(errorPanel(e, render), null)); return;
    }
    if (token !== renderToken) return;
    document.title = `${page.title} · SBPS PAMB clearance`;
    root.replaceChildren(page.bare ? page.node : shell(page.node, page.active));
    window.scrollTo({ top: 0 });
    const h1 = document.getElementById('h1');
    if (h1) h1.focus({ preventScroll: true });
  }

  window.addEventListener('hashchange', render);
  window.addEventListener('beforeunload', (e) => { /* unsaved edits are autosaved; warn only if a save is pending */ if (state.flush && document.querySelector('.save-state')?.textContent === 'Unsaved changes') { e.preventDefault(); e.returnValue = ''; } });
  render();
})();
