// Naphtali PM Group Academy — Exam Portal (browser app)
// All grading, timing and unlock rules run on the server (Supabase functions).
// This file only displays questions and sends the candidate's answers.

const CFG = window.PORTAL_CONFIG || {};
const app = document.getElementById('app');
const configured = CFG.SUPABASE_URL && !CFG.SUPABASE_URL.includes('YOUR-PROJECT') && CFG.SUPABASE_ANON_KEY && !CFG.SUPABASE_ANON_KEY.includes('YOUR-');
const sb = configured && window.supabase
  ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, { auth: { flowType: 'implicit', persistSession: true, detectSessionInUrl: true } })
  : null;

let session = null;
let profile = null;
let X = null;            // the running exam, if any
let showingSignIn = false;

// ------------------------------------------------------------------
// Small helpers
// ------------------------------------------------------------------
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function fmtClock(sec) {
  sec = Math.max(0, Math.floor(sec));
  const hh = Math.floor(sec / 3600), mm = Math.floor((sec % 3600) / 60), ss = sec % 60;
  return (hh ? hh + ':' : '') + String(mm).padStart(hh ? 2 : 1, '0') + ':' + String(ss).padStart(2, '0');
}
function fmtDuration(sec) {
  if (sec == null) return '—';
  const s = Math.max(0, Math.round(sec)), hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60);
  if (hh) return `${hh} h ${String(mm).padStart(2, '0')} min`;
  if (mm) return `${mm} min ${String(s % 60).padStart(2, '0')} s`;
  return `${s % 60} s`;
}
function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function titleCase(s) {
  return String(s || '').toLowerCase().replace(/\b\w+/g, (w, i) => (i > 0 && ['and', 'or', 'of', 'the', 'to'].includes(w) ? w : w[0].toUpperCase() + w.slice(1)));
}

let toastTimer;
function toast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ''), isError ? 6000 : 3500);
}

async function rpc(fn, args = {}) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) {
    const msg = error.message || 'Something went wrong.';
    if (/JWT|not authenticated|sign in first/i.test(msg)) { await sb.auth.signOut(); }
    throw new Error(msg);
  }
  return data;
}

function modal(html, { wide = false } = {}) {
  const back = h(`<div class="modal-backdrop"><div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">${html}</div></div>`);
  document.body.appendChild(back);
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  back.addEventListener('click', (e) => { if (e.target === back) close(); });
  const first = back.querySelector('button, input, select');
  if (first) first.focus();
  return { el: back, close };
}
function confirmBox(title, body, okLabel, { danger = false } = {}) {
  return new Promise((resolve) => {
    const m = modal(`<h2>${esc(title)}</h2><div>${body}</div>
      <div class="actions"><button class="btn secondary" data-no>Cancel</button>
      <button class="btn ${danger ? 'danger' : ''}" data-yes>${esc(okLabel)}</button></div>`);
    $('[data-no]', m.el).onclick = () => { m.close(); resolve(false); };
    $('[data-yes]', m.el).onclick = () => { m.close(); resolve(true); };
  });
}

function csvDownload(filename, rows) {
  const csv = rows.map((r) => r.map((v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function topbar(active) {
  const isAdmin = profile?.role === 'admin';
  return `<header class="topbar">
    <a class="brand" href="#/dashboard"><img src="${esc(CFG.LOGO_URL)}" alt=""><strong>${esc(CFG.ACADEMY_NAME || 'Exam Portal')}</strong></a>
    <nav aria-label="Main">
      <a href="#/dashboard" class="${active === 'dashboard' ? 'active' : ''}">My exams</a>
      ${isAdmin ? `<a href="#/admin" class="${active === 'admin' ? 'active' : ''}">Facilitator</a>` : ''}
      <button type="button" data-signout>Sign out</button>
    </nav></header>`;
}
function wireTopbar(root) {
  const b = $('[data-signout]', root);
  if (b) b.onclick = async () => { await sb.auth.signOut(); location.hash = '#/'; };
}

// ------------------------------------------------------------------
// Routing
// ------------------------------------------------------------------
async function route() {
  stopExam();
  if (!sb) return renderNotConfigured();
  const hash = location.hash || '#/';
  if (/access_token|error_description/.test(hash)) return; // sign-in redirect being processed
  const { data } = await sb.auth.getSession();
  session = data.session;
  if (!session) { profile = null; return renderSignIn(); }
  showingSignIn = false;
  const parts = hash.replace(/^#\/?/, '').split('/');
  try {
    if (parts[0] === 'exam' && parts[1]) return await openExam(parts[1]);
    if (parts[0] === 'result' && parts[1]) return await renderResult(parts[1]);
    if (parts[0] === 'admin') return await renderAdmin();
    return await renderDashboard();
  } catch (e) {
    renderError(e.message);
  }
}

function renderNotConfigured() {
  app.innerHTML = `<main class="page narrow"><div class="panel stack">
    <h1>Portal not connected yet</h1>
    <p>Open <b>config.js</b> and paste your Supabase project URL and anon key, then upload the site again.
    The deployment manual explains where to find both values (Step 3).</p></div></main>`;
}
function renderError(msg) {
  app.innerHTML = topbar('') + `<main class="page narrow"><div class="notice fail"><b>That did not work.</b> ${esc(msg)}</div>
    <a class="btn secondary" href="#/dashboard">Back to my exams</a></main>`;
  wireTopbar(app);
}

// ------------------------------------------------------------------
// Sign in (email code or link, optional Google)
// ------------------------------------------------------------------
function renderSignIn() {
  showingSignIn = true;
  app.innerHTML = `
  <div class="signin">
    <section class="signin-intro">
      <a class="brand" href="#/"><img src="${esc(CFG.LOGO_URL)}" alt=""><strong>${esc(CFG.ACADEMY_NAME)}</strong></a>
      <div>
        <h1>Sit your mock exam the way the real one runs.</h1>
        <p>Full-length, timed PMP and PMI-RMP simulations with scheduled breaks, a server-kept clock,
        and a question-by-question review once you submit.</p>
      </div>
      <div class="exam-facts">
        <div><b>185</b><span>PMP questions in 240 minutes</span></div>
        <div><b>115</b><span>PMI-RMP questions in 150 minutes</span></div>
        <div><b>70%</b><span>Pass mark that unlocks the next mock</span></div>
        <div><b>3</b><span>PMP mocks, each reviewed after you submit</span></div>
      </div>
    </section>
    <section class="signin-form">
      <div class="panel" id="signin-panel"></div>
    </section>
  </div>`;
  stepEmail();
}

function stepEmail(prefill = '') {
  const p = $('#signin-panel');
  p.innerHTML = `
    <h2>Sign in</h2>
    <p class="hint">New candidates are registered automatically the first time they sign in. No password needed.</p>
    ${CFG.GOOGLE_SIGN_IN ? `<button class="btn secondary" style="width:100%" id="google">Continue with Google</button>
      <div class="divider">or use your email</div>` : ''}
    <form id="email-form" novalidate>
      <div class="field"><label for="email">Email address</label>
        <input class="input" id="email" type="email" autocomplete="email" required value="${esc(prefill)}" placeholder="you@example.com"></div>
      <div class="field"><label for="fullname">Full name <span class="hint">(as it should appear on your results)</span></label>
        <input class="input" id="fullname" type="text" autocomplete="name" placeholder="e.g. Adaeze Okafor"></div>
      <p class="error-text" id="email-err" hidden></p>
      <button class="btn" style="width:100%" type="submit" id="send">Email me a sign-in code</button>
    </form>
    <p class="hint" style="margin-top:16px">Problems signing in? Write to <a href="mailto:${esc(CFG.SUPPORT_EMAIL)}">${esc(CFG.SUPPORT_EMAIL)}</a>.</p>`;
  if (CFG.GOOGLE_SIGN_IN) $('#google').onclick = () => sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } });
  $('#email-form').onsubmit = async (e) => {
    e.preventDefault();
    const email = $('#email').value.trim().toLowerCase();
    const name = $('#fullname').value.trim();
    const err = $('#email-err');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { err.textContent = 'Enter a valid email address.'; err.hidden = false; return; }
    $('#send').disabled = true; $('#send').textContent = 'Sending…';
    const { error } = await sb.auth.signInWithOtp({
      email, options: { emailRedirectTo: location.origin + location.pathname, data: name ? { full_name: name } : undefined },
    });
    if (error) {
      err.textContent = /rate|seconds/i.test(error.message) ? 'Please wait a minute before asking for another code.' : error.message;
      err.hidden = false; $('#send').disabled = false; $('#send').textContent = 'Email me a sign-in code';
      return;
    }
    stepCode(email);
  };
}

function stepCode(email) {
  const p = $('#signin-panel');
  p.innerHTML = `
    <h2>Check your email</h2>
    <p>We sent a sign-in email to <b>${esc(email)}</b>. Enter the 6-digit code from it, or click the link in the email on this device.</p>
    <form id="code-form">
      <div class="field"><label for="code">Sign-in code</label>
        <input class="input code-input" id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="8" required></div>
      <p class="error-text" id="code-err" hidden></p>
      <button class="btn" style="width:100%" type="submit" id="verify">Sign in</button>
    </form>
    <div class="row" style="margin-top:16px"><button class="btn quiet small" id="back">Use a different email</button>
      <span class="spacer"></span><button class="btn quiet small" id="resend" disabled>Resend code</button></div>
    <p class="hint">The email can take a minute to arrive. Check your spam folder too.</p>`;
  $('#code').focus();
  let wait = 60; const r = $('#resend');
  const t = setInterval(() => { wait--; r.textContent = wait > 0 ? `Resend code (${wait}s)` : 'Resend code'; if (wait <= 0) { r.disabled = false; clearInterval(t); } }, 1000);
  r.onclick = async () => { r.disabled = true; await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } }); toast('A new code is on its way.'); };
  $('#back').onclick = () => { clearInterval(t); stepEmail(email); };
  $('#code-form').onsubmit = async (e) => {
    e.preventDefault();
    const token = $('#code').value.replace(/\D/g, '');
    $('#verify').disabled = true;
    const { error } = await sb.auth.verifyOtp({ email, token, type: 'email' });
    if (error) {
      $('#code-err').textContent = 'That code is wrong or has expired. Check the latest email, or resend the code.';
      $('#code-err').hidden = false; $('#verify').disabled = false; return;
    }
    clearInterval(t);  // the SIGNED_IN event opens the dashboard
  };
}

// ------------------------------------------------------------------
// Dashboard
// ------------------------------------------------------------------
async function renderDashboard() {
  const d = await rpc('get_dashboard');
  profile = d.profile;
  const needsName = !profile.fullName || profile.fullName.trim().length < 2;
  const firstName = (profile.fullName || '').split(' ')[0];
  app.innerHTML = topbar('dashboard') + `
  <main class="page">
    <div class="welcome">
      <div><h1>${needsName ? 'Welcome' : 'Welcome, ' + esc(firstName)}</h1>
        <p class="lede">Registration number <span class="reg">${esc(profile.regNumber)}</span></p></div>
      ${needsName ? '' : `<button class="btn quiet small" id="edit-name">Change my name</button>`}
    </div>
    ${profile.status !== 'active' ? `<div class="notice fail"><b>Your account is inactive.</b> You can view past results but cannot start a mock. Contact <a href="mailto:${esc(CFG.SUPPORT_EMAIL)}">${esc(CFG.SUPPORT_EMAIL)}</a>.</div>` : ''}
    ${needsName ? `<form class="notice" id="name-form"><p><b>Add your full name before you start.</b> It appears on your results.</p>
      <div class="row"><input class="input" id="name" style="max-width:360px" placeholder="Full name" required>
      <button class="btn" type="submit">Save name</button></div></form>` : ''}
    ${d.exams.map((e) => examBlock(e)).join('')}
    ${d.legacyResults.length ? `<section class="exam-block"><h2>Results from the previous portal</h2>
      <p class="hint">Kept for your records. These do not unlock mocks on the new portal.</p>
      <div class="table-wrap"><table><thead><tr><th>Mock</th><th class="num">Score</th><th class="num">Correct</th><th>Date</th><th class="num">Time</th></tr></thead><tbody>
      ${d.legacyResults.map((l) => `<tr><td>${esc(l.mockTitle)}</td><td class="num">${l.percentage}%</td><td class="num">${l.correct}/${l.total}</td><td>${fmtDate(l.submittedAt)}</td><td class="num">${fmtDuration(l.durationSeconds)}</td></tr>`).join('')}
      </tbody></table></div></section>` : ''}
  </main>`;
  wireTopbar(app);
  const nf = $('#name-form');
  if (nf) nf.onsubmit = async (e) => { e.preventDefault(); try { await rpc('update_my_name', { p_full_name: $('#name').value }); toast('Name saved.'); renderDashboard(); } catch (er) { toast(er.message, true); } };
  const en = $('#edit-name');
  if (en) en.onclick = () => {
    const m = modal(`<h2>Change my name</h2><div class="field"><label for="nn">Full name</label><input class="input" id="nn" value="${esc(profile.fullName)}"></div>
      <div class="actions"><button class="btn secondary" data-no>Cancel</button><button class="btn" data-yes>Save name</button></div>`);
    $('[data-no]', m.el).onclick = m.close;
    $('[data-yes]', m.el).onclick = async () => { try { await rpc('update_my_name', { p_full_name: $('#nn', m.el).value }); m.close(); toast('Name saved.'); renderDashboard(); } catch (er) { toast(er.message, true); } };
  };
  $$('[data-start]').forEach((b) => b.onclick = () => startMock(b.dataset.start, b.dataset.title, b.dataset.minutes, b.dataset.count));
  $$('[data-resume]').forEach((b) => b.onclick = () => { location.hash = '#/exam/' + b.dataset.resume; });
}

function examBlock(e) {
  const allFirst = e.mocks.every((m) => m.attempts.length);
  return `<section class="exam-block">
    <div class="exam-head"><h2>${esc(e.title)}</h2>
      <span class="readiness ${e.ready ? 'ready' : 'not-ready'}">${e.ready ? 'Exam ready: you passed every mock on the first attempt'
        : allFirst ? 'Readiness is based on first attempts; retakes are practice' : 'Readiness: pass each mock on your first attempt'}</span></div>
    <div class="mock-list">${e.mocks.map((m) => mockRow(m)).join('')}</div></section>`;
}
function mockRow(m) {
  const first = m.attempts[0];
  const best = m.attempts.length ? m.attempts.reduce((a, b) => (b.percentage > a.percentage ? b : a)) : null;
  let action;
  if (!m.unlocked) action = `<span class="pill">Pass ${esc(m.unlockAfterTitle || 'the previous mock')} to unlock</span>`;
  else if (m.inProgressId) action = `<button class="btn amber" data-resume="${esc(m.inProgressId)}">Resume exam</button>`;
  else action = `<button class="btn" data-start="${esc(m.id)}" data-title="${esc(m.title)}" data-minutes="${m.timeLimitMinutes}" data-count="${m.questionCount}">${m.attempts.length ? 'Retake' : 'Start mock'}</button>`;
  return `<div class="mock-row ${m.unlocked ? '' : 'locked'}">
    <div class="mock-no" aria-hidden="true">${m.mockNo}</div>
    <div><h3>${esc(m.title)}</h3><div class="mock-meta">${m.questionCount} questions, ${m.timeLimitMinutes} minutes, pass mark ${m.passMark}%</div>
      ${m.attempts.length ? `<div class="history">Attempts: ${m.attempts.map((a) => `<a href="#/result/${esc(a.id)}">#${a.attemptNo} ${a.percentage}%</a>`).join('')}</div>` : ''}</div>
    <div class="scores">${first ? `<div class="score"><small>First attempt</small><b class="${first.passed ? 'pass' : 'fail'}">${first.percentage}%</b></div>
      <div class="score"><small>Best</small><b>${best.percentage}%</b></div>` : ''}</div>
    <div class="mock-action">${action}</div></div>`;
}

async function startMock(mockId, title, minutes, count) {
  const ok = await confirmBox(`Start ${title}?`,
    `<p>You will have <b>${minutes} minutes</b> for <b>${count} questions</b>. The clock runs on the server and keeps running if you close the page.</p>
     <p>After each section you can take a break of up to 10 minutes, which does not count against your time. You cannot return to a section once you finish it.</p>
     <p class="hint">Your first attempt counts toward exam readiness. Retakes are for practice.</p>`, 'Start the clock');
  if (!ok) return;
  try {
    const r = await rpc('start_attempt', { p_mock_id: mockId });
    location.hash = '#/exam/' + r.attemptId;
  } catch (e) { toast(e.message, true); }
}

// ------------------------------------------------------------------
// Exam runner
// ------------------------------------------------------------------
const backupKey = (id) => 'npa-attempt-' + id;

async function openExam(attemptId) {
  const st = await rpc('get_attempt', { p_attempt_id: attemptId });
  if (st.status === 'submitted') { location.hash = '#/result/' + attemptId; return; }
  let struck = {};
  try { struck = JSON.parse(localStorage.getItem(backupKey(attemptId) + '-struck') || '{}'); } catch (e) { /* ignore */ }
  X = { id: attemptId, st, answers: { ...st.answers }, flags: { ...st.flags }, idx: Math.min(st.currentIndex || 0, st.questions.length - 1),
        dirty: false, saving: false, deadline: Date.now() + st.remainingSeconds * 1000, struck, timers: [], submitting: false, lastSaved: st.lastSavedAt };
  // Restore unsaved answers kept in this browser (e.g. after losing connection)
  try {
    const b = JSON.parse(localStorage.getItem(backupKey(attemptId)) || 'null');
    if (b && b.section === st.section && (!st.lastSavedAt || b.at > Date.parse(st.lastSavedAt))) {
      const ids = new Set(st.questions.map((q) => q.id));
      for (const [k, v] of Object.entries(b.answers || {})) if (ids.has(k)) X.answers[k] = v;
      for (const [k, v] of Object.entries(b.flags || {})) if (ids.has(k)) X.flags[k] = v;
      X.dirty = true;
    }
  } catch (e) { /* ignore */ }
  if (st.onBreak) return renderBreak();
  renderExam();
}

function stopExam() {
  if (!X) return;
  X.timers.forEach((t) => clearInterval(t));
  X.timers = [];
  window.removeEventListener('beforeunload', beforeUnload);
  document.removeEventListener('keydown', examKeys);
  document.removeEventListener('visibilitychange', onVisibility);
  X = null;
}
function beforeUnload(e) { if (X && X.dirty) { saveNow(); e.preventDefault(); e.returnValue = ''; } }
function onVisibility() { if (document.visibilityState === 'hidden' && X && X.dirty) saveNow(); }

function remaining() { return X ? Math.max(0, (X.deadline - Date.now()) / 1000) : 0; }

function renderExam() {
  const st = X.st;
  X.timers.forEach((t) => clearInterval(t)); X.timers = [];
  app.innerHTML = `
  <div class="exam">
    <header class="exam-bar">
      <div><div class="title">${esc(st.mock.title)}</div><div class="sub" id="pos"></div></div>
      <div class="timer" id="timer" role="timer" aria-label="Time remaining"></div>
      <div class="tools">
        <span class="save-state" id="save-state"></span>
        <button class="btn quiet small" id="calc-btn">Calculator</button>
        <button class="btn quiet small" id="nav-btn">All questions</button>
      </div>
    </header>
    <div class="progress-track"><div class="progress-fill" id="progress"></div></div>
    <div class="exam-body" id="exam-body"></div>
    <footer class="exam-foot">
      <button class="btn secondary" id="prev">Previous</button>
      <button class="flag-toggle" id="flag" aria-pressed="false">Flag for review</button>
      <span class="spacer"></span>
      <button class="btn secondary" id="review-sec">Review section</button>
      <button class="btn" id="next">Next</button>
    </footer>
  </div>`;
  $('#prev').onclick = () => go(X.idx - 1);
  $('#next').onclick = () => (X.idx >= X.st.questions.length - 1 ? openSectionReview() : go(X.idx + 1));
  $('#flag').onclick = toggleFlag;
  $('#review-sec').onclick = openSectionReview;
  $('#nav-btn').onclick = openNavigator;
  $('#calc-btn').onclick = toggleCalc;
  window.addEventListener('beforeunload', beforeUnload);
  document.addEventListener('keydown', examKeys);
  document.addEventListener('visibilitychange', onVisibility);
  X.timers.push(setInterval(tick, 1000));
  X.timers.push(setInterval(() => { if (X && X.dirty) saveNow(); }, 30000));
  tick();
  renderQuestion();
  setSaveState(X.dirty ? 'Unsaved changes' : 'All answers saved');
  if (X.dirty) saveNow();
}

function tick() {
  if (!X) return;
  const r = remaining();
  const t = $('#timer');
  if (!t) return;
  t.textContent = fmtClock(r);
  t.className = 'timer' + (r <= 300 ? ' critical' : r <= 900 ? ' low' : '');
  if (r <= 0 && !X.submitting) autoSubmit();
}

function setSaveState(text) { const s = $('#save-state'); if (s) s.textContent = text; }

function markDirty() {
  X.dirty = true;
  setSaveState('Saving…');
  try { localStorage.setItem(backupKey(X.id), JSON.stringify({ section: X.st.section, answers: X.answers, flags: X.flags, at: Date.now() })); } catch (e) { /* storage full */ }
  clearTimeout(X.debounce);
  X.debounce = setTimeout(saveNow, 2000);
}

async function saveNow() {
  if (!X || X.saving || X.submitting) return;
  X.saving = true; X.dirty = false;
  const id = X.id;
  try {
    const r = await rpc('save_progress', { p_attempt_id: id, p_answers: X.answers, p_flags: X.flags, p_index: X.idx });
    if (!X || X.id !== id) return;
    if (r.status === 'submitted') { stopExam(); location.hash = '#/result/' + id; return; }
    const serverDeadline = Date.now() + r.remainingSeconds * 1000;
    if (Math.abs(serverDeadline - X.deadline) > 3000) X.deadline = serverDeadline;
    setSaveState(X.dirty ? 'Saving…' : 'All answers saved');
  } catch (e) {
    if (X) { X.dirty = true; setSaveState('Not saved yet. Retrying…'); }
  } finally {
    if (X) X.saving = false;
  }
}

function go(i) {
  const n = X.st.questions.length;
  if (i < 0 || i >= n) return;
  X.idx = i;
  renderQuestion();
  if (X.dirty) saveNow(); else markIndexOnly();
  window.scrollTo(0, 0);
}
let indexTimer;
function markIndexOnly() { clearTimeout(indexTimer); indexTimer = setTimeout(() => { if (X) { X.dirty = true; saveNow(); } }, 8000); }

function toggleFlag() {
  const q = X.st.questions[X.idx];
  X.flags[q.id] = !X.flags[q.id];
  if (!X.flags[q.id]) X.flags[q.id] = false;
  $('#flag').setAttribute('aria-pressed', String(!!X.flags[q.id]));
  $('#flag').textContent = X.flags[q.id] ? 'Flagged' : 'Flag for review';
  markDirty();
}

function isAnswered(v) {
  if (v == null) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.values(v).some((x) => String(x || '').trim());
  return String(v).trim() !== '';
}

function renderQuestion() {
  const st = X.st, q = st.questions[X.idx];
  const globalNo = st.sectionOffset + X.idx + 1;
  $('#pos').textContent = `Section ${st.section} of ${st.sectionCount}, question ${globalNo} of ${st.totalQuestions}`;
  $('#progress').style.width = ((X.idx + 1) / st.questions.length * 100) + '%';
  $('#flag').setAttribute('aria-pressed', String(!!X.flags[q.id]));
  $('#flag').textContent = X.flags[q.id] ? 'Flagged' : 'Flag for review';
  $('#prev').disabled = X.idx === 0;
  $('#next').textContent = X.idx >= st.questions.length - 1 ? (st.section >= st.sectionCount ? 'Review and submit' : 'Review and finish section') : 'Next';
  const body = $('#exam-body');
  body.className = 'exam-body' + (q.case ? ' with-case' : '');
  body.innerHTML = `${q.case ? `<aside class="case-pane"><h2>${esc(q.case.title)}</h2><div class="case-text">${esc(q.case.body)}</div></aside>` : ''}
    <section class="question-pane"><div class="question-inner">
      <div class="q-head"><span class="q-number">Question ${globalNo}</span></div>
      <div id="q-area"></div></div></section>`;
  const area = $('#q-area');
  area.appendChild(questionView(q, X.answers[q.id], (v) => { X.answers[q.id] = v; markDirty(); }, {
    struck: X.struck[q.id] || [],
    onStrike: (letter) => {
      const list = new Set(X.struck[q.id] || []);
      list.has(letter) ? list.delete(letter) : list.add(letter);
      X.struck[q.id] = [...list];
      try { localStorage.setItem(backupKey(X.id) + '-struck', JSON.stringify(X.struck)); } catch (e) { /* ignore */ }
    },
  }));
}

// Interactive question renderer. onChange(value) is called with the new answer.
function questionView(q, value, onChange, opts = {}) {
  const wrap = document.createElement('div');
  const s = q.structure || {};
  const diagram = q.diagram ? `<figure class="diagram" data-zoom="${esc(q.diagram)}"><img src="${esc(q.diagram)}" alt="Exhibit for this question"></figure>` : '';
  const zoom = () => $$('[data-zoom]', wrap).forEach((f) => f.onclick = () => {
    const m = modal(`<img src="${esc(f.dataset.zoom)}" alt="Exhibit, enlarged" style="width:100%"><div class="actions"><button class="btn secondary" data-no>Close</button></div>`, { wide: true });
    $('[data-no]', m.el).onclick = m.close;
  });

  if (q.type === 'PULLDOWN') {
    const val = value || {};
    let html = esc(q.prompt);
    (s.tokens || []).forEach((t) => {
      const raw = esc(`{{${t.id}:${t.options.join('|')}}}`);
      const sel = `<select data-token="${esc(t.id)}" aria-label="Choose a value"><option value="">Choose…</option>${t.options.map((o) => `<option ${val[t.id] === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
      html = html.split(raw).join(sel);
    });
    html = html.replace(/\{\{[^}]*\}\}/g, '');
    wrap.innerHTML = diagram + `<p class="select-hint">Choose a value for each blank.</p><div class="cloze prompt">${html}</div>`;
    $$('select', wrap).forEach((sel) => sel.onchange = () => {
      const o = {}; $$('select', wrap).forEach((x) => { if (x.value) o[x.dataset.token] = x.value; }); onChange(o);
    });
    zoom(); return wrap;
  }

  let promptText = q.prompt;
  if (q.type === 'PULLDOWN') promptText = q.prompt;
  wrap.innerHTML = (q.type === 'GRAPHIC' || q.type === 'HOTSPOT' ? diagram : '') + `<div class="prompt">${esc(promptText)}</div>` + (q.type !== 'GRAPHIC' && q.type !== 'HOTSPOT' ? diagram : '');

  if (q.type === 'MATCHING') {
    const val = value || {};
    wrap.appendChild(h(`<ul class="columns-ref">${s.columns.map((c) => `<li><b>${esc(c.id)}.</b> ${esc(c.text)}</li>`).join('')}</ul>`));
    const grid = h(`<div class="match-grid">${s.rows.map((r) => `<div class="match-row"><div class="label"><b>${esc(r.id)}.</b> ${esc(r.text)}</div>
      <select class="input" data-row="${esc(r.id)}" aria-label="Match for ${esc(r.text)}"><option value="">Choose a match…</option>
      ${s.columns.map((c) => `<option value="${esc(c.id)}" ${val[r.id] === c.id ? 'selected' : ''}>${esc(c.id)}. ${esc(c.text.length > 80 ? c.text.slice(0, 78) + '…' : c.text)}</option>`).join('')}</select></div>`).join('')}</div>`);
    wrap.appendChild(grid);
    $$('select', grid).forEach((sel) => sel.onchange = () => {
      const o = {}; $$('select', grid).forEach((x) => { if (x.value) o[x.dataset.row] = x.value; }); onChange(o);
    });
    zoom(); return wrap;
  }

  if (q.type === 'HOTSPOT' && s.mode === 'classify') {
    const val = value || {};
    const grid = h(`<div class="match-grid">${(s.items || []).map((it) => `<div class="match-row"><div class="label"><b>${esc(it.label)}.</b> ${esc(it.text)}</div>
      <select class="input" data-item="${esc(it.label)}" aria-label="Classify ${esc(it.label)}"><option value="">Choose…</option>
      ${s.choices.map((c) => `<option ${val[it.label] === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>`).join('')}</div>`);
    wrap.appendChild(h(`<p class="select-hint">Choose an answer for each item.</p>`));
    wrap.appendChild(grid);
    $$('select', grid).forEach((sel) => sel.onchange = () => {
      const o = {}; $$('select', grid).forEach((x) => { if (x.value) o[x.dataset.item] = x.value; }); onChange(o);
    });
    zoom(); return wrap;
  }

  // Option lists: MCQ, CASE_STUDY, GRAPHIC, MULTI-RESPONSE, HOTSPOT (select)
  const isHotspot = q.type === 'HOTSPOT';
  const multi = q.type === 'MULTI-RESPONSE';
  const need = multi ? (s.select || 2) : 1;
  const items = isHotspot ? (s.items || []).map((it) => ({ key: it.label, text: it.text, label: it.label })) : q.options;
  if (multi) wrap.appendChild(h(`<p class="select-hint">Select ${need}.</p>`));
  const list = h(`<div class="options" role="${multi ? 'group' : 'radiogroup'}"></div>`);
  const selected = () => (multi ? (Array.isArray(value) ? value : []) : value);
  const draw = () => {
    const cur = selected();
    list.innerHTML = items.map((o) => {
      const on = multi ? cur.includes(o.key) : cur === o.key;
      const struck = (opts.struck || []).includes(o.key);
      return `<label class="option ${multi ? 'multi' : ''} ${on ? 'selected' : ''} ${struck ? 'struck' : ''}">
        <input type="${multi ? 'checkbox' : 'radio'}" name="q-${esc(q.id)}" value="${esc(o.key)}" ${on ? 'checked' : ''}>
        <span class="letter" aria-hidden="true">${isHotspot ? '•' : esc(o.key)}</span>
        <span class="option-text">${isHotspot ? `<b>${esc(o.label)}</b><br>` : ''}${esc(o.text)}</span>
        ${opts.onStrike ? `<button type="button" class="strike-btn" data-strike="${esc(o.key)}" aria-pressed="${struck}">${struck ? 'Restore' : 'Cross out'}</button>` : '<span></span>'}
      </label>`;
    }).join('');
    $$('input', list).forEach((inp) => inp.onchange = () => {
      if (multi) {
        let arr = [...(Array.isArray(value) ? value : [])];
        if (inp.checked) { if (!arr.includes(inp.value)) arr.push(inp.value); } else arr = arr.filter((x) => x !== inp.value);
        if (arr.length > need) { arr = arr.slice(arr.length - need); toast(`Select ${need}. Your earliest choice was cleared.`); }
        value = arr.sort();
      } else value = inp.value;
      onChange(value); draw();
    });
    $$('[data-strike]', list).forEach((b) => b.onclick = (e) => {
      e.preventDefault(); e.stopPropagation();
      opts.onStrike(b.dataset.strike);
      const k = b.dataset.strike, set = new Set(opts.struck || []);
      set.has(k) ? set.delete(k) : set.add(k); opts.struck = [...set];
      draw();
    });
  };
  draw();
  wrap.appendChild(list);
  zoom();
  return wrap;
}

function examKeys(e) {
  if (!X || $('.modal-backdrop') || $('.drawer')) return;
  if (e.target.closest('input, select, textarea') && e.target.type !== 'radio' && e.target.type !== 'checkbox') return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'n' || e.key === 'ArrowRight') { e.preventDefault(); $('#next').click(); }
  else if (k === 'p' || e.key === 'ArrowLeft') { e.preventDefault(); go(X.idx - 1); }
  else if (k === 'f') { e.preventDefault(); toggleFlag(); }
  else if (/^[a-e]$/.test(k)) {
    const inp = $(`#q-area input[value="${k.toUpperCase()}"]`);
    if (inp) { e.preventDefault(); inp.click(); }
  }
}

function sectionCounts() {
  const qs = X.st.questions;
  const answered = qs.filter((q) => isAnswered(X.answers[q.id])).length;
  const flagged = qs.filter((q) => X.flags[q.id]).length;
  return { total: qs.length, answered, unanswered: qs.length - answered, flagged };
}
function navGrid(onPick) {
  const st = X.st;
  const grid = h(`<div class="nav-grid">${st.questions.map((q, i) => `<button class="nav-cell ${isAnswered(X.answers[q.id]) ? 'answered' : ''} ${X.flags[q.id] ? 'flagged' : ''} ${i === X.idx ? 'current' : ''}"
      data-i="${i}" aria-label="Question ${st.sectionOffset + i + 1}${isAnswered(X.answers[q.id]) ? ', answered' : ', not answered'}${X.flags[q.id] ? ', flagged' : ''}">${st.sectionOffset + i + 1}</button>`).join('')}</div>`);
  $$('button', grid).forEach((b) => b.onclick = () => onPick(Number(b.dataset.i)));
  return grid;
}
function openNavigator() {
  const c = sectionCounts();
  const back = h(`<div class="drawer-backdrop"></div>`);
  const d = h(`<aside class="drawer" role="dialog" aria-label="All questions in this section"><header><h2 style="margin:0">Section ${X.st.section}</h2>
    <button class="btn quiet small" data-close>Close</button></header><div class="drawer-body">
    <p>${c.answered} of ${c.total} answered, ${c.flagged} flagged.</p>
    <div class="legend"><span class="l-ans">Answered</span><span>Not answered</span><span class="l-flag">Flagged</span></div></div></aside>`);
  const close = () => { back.remove(); d.remove(); };
  $('.drawer-body', d).appendChild(navGrid((i) => { close(); go(i); }));
  back.onclick = close; $('[data-close]', d).onclick = close;
  document.body.append(back, d);
  $('[data-close]', d).focus();
}

function openSectionReview() {
  const c = sectionCounts();
  const last = X.st.section >= X.st.sectionCount;
  const m = modal(`<h2>Review section ${X.st.section}</h2>
    <p>${c.answered} of ${c.total} answered${c.flagged ? `, ${c.flagged} flagged` : ''}.</p>
    ${c.unanswered ? `<div class="notice fail">${c.unanswered} question${c.unanswered > 1 ? 's are' : ' is'} not answered. Unanswered questions are marked wrong.</div>` : ''}
    <div class="legend"><span class="l-ans">Answered</span><span>Not answered</span><span class="l-flag">Flagged</span></div>
    <div id="rv-grid"></div>
    <p class="hint" style="margin-top:16px">${last ? 'Submitting ends the exam and shows your result.' : 'Once you finish this section you cannot come back to it.'}</p>
    <div class="actions"><button class="btn secondary" data-no>Back to questions</button>
    <button class="btn ${last ? 'amber' : ''}" data-yes>${last ? 'Submit exam' : 'Finish section ' + X.st.section}</button></div>`);
  $('#rv-grid', m.el).appendChild(navGrid((i) => { m.close(); go(i); }));
  $('[data-no]', m.el).onclick = m.close;
  $('[data-yes]', m.el).onclick = async () => { m.close(); await finishSection(); };
}

async function finishSection() {
  if (!X || X.submitting) return;
  X.submitting = true;
  clearTimeout(X.debounce);
  setSaveState('Saving…');
  const id = X.id;
  try {
    const st = await rpc('finish_section', { p_attempt_id: id, p_answers: X.answers, p_flags: X.flags });
    localStorage.removeItem(backupKey(id));
    if (st.status === 'submitted') { finished(id); return; }
    X.st = st; X.answers = { ...st.answers }; X.flags = { ...st.flags }; X.idx = 0; X.dirty = false; X.submitting = false;
    X.deadline = Date.now() + st.remainingSeconds * 1000;
    if (st.onBreak) renderBreak(); else renderExam();
  } catch (e) {
    X.submitting = false;
    toast('Could not finish the section: ' + e.message + ' Check your connection and try again.', true);
  }
}

async function autoSubmit() {
  if (!X || X.submitting) return;
  X.submitting = true;
  const id = X.id;
  setSaveState('Time is up. Submitting…');
  for (let tries = 0; tries < 5; tries++) {
    try {
      await rpc('submit_attempt', { p_attempt_id: id, p_answers: X ? X.answers : {}, p_flags: X ? X.flags : {} });
      finished(id); return;
    } catch (e) { await new Promise((r) => setTimeout(r, 3000)); }
  }
  toast('Time is up. We could not reach the server; your answers are kept in this browser. Reload the page when you are back online.', true);
}

function finished(id) {
  try { localStorage.removeItem(backupKey(id)); localStorage.removeItem(backupKey(id) + '-struck'); } catch (e) { /* ignore */ }
  stopExam();
  sendResultEmail(id);
  location.hash = '#/result/' + id;
}

async function sendResultEmail(id) {
  if (!CFG.RESULT_EMAILS || !CFG.RESULT_EMAIL_URL || /PASTE-/.test(CFG.RESULT_EMAIL_URL)) return;
  try {
    const { data } = await sb.auth.getSession();
    if (!data.session) return;
    // Google's web apps accept a plain-text POST from any site; the reply is not needed.
    await fetch(CFG.RESULT_EMAIL_URL, {
      method: 'POST', mode: 'no-cors', headers: { 'content-type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ attemptId: id, token: data.session.access_token }),
    });
  } catch (e) { /* email is best-effort */ }
}

function renderBreak() {
  const st = X.st;
  X.timers.forEach((t) => clearInterval(t)); X.timers = [];
  window.removeEventListener('beforeunload', beforeUnload);
  const endAt = Date.now() + (st.breakSecondsLeft || 0) * 1000;
  app.innerHTML = `<div class="break-screen"><div>
    <h1>Section ${st.section - 1} is complete</h1>
    <div class="break-clock" id="bclock">${fmtClock(st.breakSecondsLeft)}</div>
    <p>Your exam clock is paused during the break. Section ${st.section} of ${st.sectionCount} starts automatically when the break ends.
       You will have ${fmtDuration(st.remainingSeconds)} left.</p>
    <button class="btn amber" id="resume-now">Start section ${st.section} now</button></div></div>`;
  const resume = async () => {
    if (!X) return;
    X.timers.forEach((t) => clearInterval(t)); X.timers = [];
    try {
      const s2 = await rpc('end_break', { p_attempt_id: X.id });
      if (s2.status === 'submitted') { finished(X.id); return; }
      X.st = s2; X.answers = { ...s2.answers }; X.flags = { ...s2.flags }; X.idx = s2.currentIndex || 0;
      X.deadline = Date.now() + s2.remainingSeconds * 1000;
      renderExam();
    } catch (e) { toast(e.message, true); }
  };
  $('#resume-now').onclick = resume;
  X.timers.push(setInterval(() => {
    const left = (endAt - Date.now()) / 1000;
    const c = $('#bclock'); if (c) c.textContent = fmtClock(left);
    if (left <= 0) resume();
  }, 1000));
}

// ------------------------------------------------------------------
// Calculator (no eval: a small expression parser)
// ------------------------------------------------------------------
function calcEval(expr) {
  const toks = expr.replace(/×/g, '*').replace(/÷/g, '/').match(/\d*\.?\d+|[-+*/()]/g) || [];
  let i = 0;
  const peek = () => toks[i], next = () => toks[i++];
  const factor = () => {
    const t = next();
    if (t === '-') return -factor();
    if (t === '(') { const v = sum(); if (next() !== ')') throw new Error('bracket'); return v; }
    const n = parseFloat(t); if (Number.isNaN(n)) throw new Error('num'); return n;
  };
  const term = () => { let v = factor(); while (peek() === '*' || peek() === '/') { const op = next(); const r = factor(); v = op === '*' ? v * r : v / r; } return v; };
  const sum = () => { let v = term(); while (peek() === '+' || peek() === '-') { const op = next(); const r = term(); v = op === '+' ? v + r : v - r; } return v; };
  const v = sum(); if (i !== toks.length || !Number.isFinite(v)) throw new Error('bad');
  return Math.round(v * 1e10) / 1e10;
}
function toggleCalc() {
  const old = $('.calc'); if (old) { old.remove(); return; }
  const keys = ['C', '(', ')', '÷', '7', '8', '9', '×', '4', '5', '6', '-', '1', '2', '3', '+', '0', '.', '⌫', '='];
  const c = h(`<div class="calc" role="dialog" aria-label="Calculator"><div class="calc-head"><span>Calculator</span><button aria-label="Close calculator">×</button></div>
    <input class="calc-display" value="0" aria-label="Calculator display">
    <div class="calc-keys">${keys.map((k) => `<button class="${'÷×-+'.includes(k) ? 'op' : k === '=' ? 'eq' : ''}">${k}</button>`).join('')}</div></div>`);
  const d = $('.calc-display', c);
  const press = (k) => {
    if (k === 'C') d.value = '0';
    else if (k === '⌫') d.value = d.value.length > 1 ? d.value.slice(0, -1) : '0';
    else if (k === '=') { try { d.value = String(calcEval(d.value)); } catch (e) { d.value = 'Error'; } }
    else d.value = (d.value === '0' || d.value === 'Error') && !'÷×+-.'.includes(k) ? k : d.value + k;
  };
  $$('.calc-keys button', c).forEach((b) => b.onclick = () => press(b.textContent));
  d.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); press('='); }
  });
  $('.calc-head button', c).onclick = () => c.remove();
  document.body.appendChild(c);
}

// ------------------------------------------------------------------
// Results and review
// ------------------------------------------------------------------
async function renderResult(attemptId) {
  if (!profile) { const d = await rpc('get_dashboard'); profile = d.profile; }
  const r = await rpc('get_review', { p_attempt_id: attemptId });
  const mine = r.candidate.email === profile.email;
  if (mine) sendResultEmail(attemptId);
  const pm = r.mock.passMark;
  const domains = Object.entries(r.domainStats || {}).sort();
  app.innerHTML = topbar(mine ? 'dashboard' : 'admin') + `
  <main class="page">
    ${mine ? '' : `<div class="notice">Viewing <b>${esc(r.candidate.fullName)}</b> (${esc(r.candidate.regNumber)}, ${esc(r.candidate.email)})</div>`}
    <div class="result-hero">
      <div class="score-ring" style="--p:${r.percentage};--ring:${r.passed ? 'var(--pass)' : 'var(--fail)'}"><div><b>${r.percentage}%</b><span>${r.correct} of ${r.total} correct</span></div></div>
      <div>
        <span class="verdict ${r.passed ? 'pass' : 'fail'}">${r.passed ? 'Passed' : 'Below the pass mark'} (pass mark ${pm}%)</span>
        <h1>${esc(r.mock.title)}, attempt ${r.attemptNo}</h1>
        <div class="facts">
          <div><small>Answered</small><b>${r.answered} of ${r.total}</b></div>
          <div><small>Time used</small><b>${fmtDuration(r.timeUsedSeconds)}</b></div>
          <div><small>Submitted</small><b>${fmtDate(r.submittedAt)}</b></div>
          ${r.submitReason === 'time_expired' ? '<div><small>Ended by</small><b>Time limit</b></div>' : ''}
        </div>
        ${r.attemptNo > 1 ? '<p class="hint" style="margin-top:12px">This is a retake. Exam readiness uses your first attempt.</p>' : ''}
      </div>
    </div>
    <section class="panel"><h2>Performance by domain</h2>
      <div class="domains">${domains.map(([d, v]) => {
        const p = v.total ? Math.round(v.correct * 100 / v.total) : 0;
        return `<div class="domain-row"><span>${esc(titleCase(d))}</span>
          <div class="bar ${p < pm ? 'below' : ''}" role="img" aria-label="${p}% correct"><i style="width:${p}%"></i><span class="mark" style="left:${pm}%"></span></div>
          <b class="num">${p}% <span class="hint">(${v.correct}/${v.total})</span></b></div>`;
      }).join('')}</div>
      <p class="hint" style="margin-top:12px">The amber line marks the ${pm}% pass mark.</p></section>
    <div class="filters" role="group" aria-label="Filter questions">
      <button data-f="all" aria-pressed="true">All (${r.questions.length})</button>
      <button data-f="wrong" aria-pressed="false">Incorrect (${r.questions.filter((q) => q.answered && !q.correct).length})</button>
      <button data-f="blank" aria-pressed="false">Not answered (${r.questions.filter((q) => !q.answered).length})</button>
      <button data-f="flag" aria-pressed="false">Flagged (${r.questions.filter((q) => q.flagged).length})</button>
      <span class="spacer"></span>
      <button data-print>Print</button>
    </div>
    <div id="review-list"></div>
    <a class="btn secondary" href="${mine ? '#/dashboard' : '#/admin'}">Back</a>
  </main>`;
  wireTopbar(app);
  const show = (f) => {
    const list = $('#review-list');
    const qs = r.questions.filter((q) => f === 'all' || (f === 'wrong' && q.answered && !q.correct) || (f === 'blank' && !q.answered) || (f === 'flag' && q.flagged));
    list.innerHTML = qs.length ? '' : '<p class="hint">No questions in this view.</p>';
    qs.forEach((q) => list.appendChild(reviewItem(q)));
  };
  $$('.filters [data-f]').forEach((b) => b.onclick = () => {
    $$('.filters [data-f]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    show(b.dataset.f);
  });
  $('[data-print]').onclick = () => window.print();
  show('all');
}

function reviewItem(q) {
  const el = h(`<article class="review-item"><div class="q-head"><span class="q-number">Question ${q.n}</span>
    <span class="row"><span class="pill">${esc(titleCase(q.domain))}</span>${q.flagged ? '<span class="pill warn">Flagged</span>' : ''}
    <span class="pill ${q.correct ? 'pass' : 'fail'}">${q.correct ? 'Correct' : q.answered ? 'Incorrect' : 'Not answered'}</span></span></div></article>`);
  if (q.case) el.appendChild(h(`<details class="case"><summary>${esc(q.case.title)}</summary><div class="case-text">${esc(q.case.body)}</div></details>`));
  const s = q.structure || {}, key = q.key || {}, sel = q.selected;
  const diagram = q.diagram ? `<figure class="diagram"><img src="${esc(q.diagram)}" alt="Exhibit"></figure>` : '';
  let body = '';
  if (q.type === 'PULLDOWN' || q.type === 'MATCHING' || (q.type === 'HOTSPOT' && s.mode === 'classify')) {
    let prompt = q.prompt;
    let rows = [];
    if (q.type === 'PULLDOWN') {
      (s.tokens || []).forEach((t) => { prompt = prompt.split(`{{${t.id}:${t.options.join('|')}}}`).join(`[${t.id.replace(/_/g, ' ')}]`); });
      rows = (s.tokens || []).map((t) => ({ label: t.id.replace(/_/g, ' '), mine: sel?.[t.id], right: key.value?.[t.id] }));
    } else if (q.type === 'MATCHING') {
      const col = Object.fromEntries(s.columns.map((c) => [c.id, c.text]));
      rows = s.rows.map((r) => ({ label: `${r.id}. ${r.text}`, mine: sel?.[r.id] ? `${sel[r.id]}. ${col[sel[r.id]] || ''}` : null,
        right: `${key.value[r.id]}. ${col[key.value[r.id]] || ''}`, ok: (sel?.[r.id] || '').toUpperCase() === String(key.value[r.id]).toUpperCase() }));
    } else {
      rows = (s.items || []).map((it) => ({ label: `${it.label}. ${it.text}`, mine: sel?.[it.label], right: key.value[it.label] }));
    }
    body = (q.type === 'GRAPHIC' || q.type === 'HOTSPOT' ? diagram : '') + `<div class="prompt">${esc(prompt)}</div>` +
      rows.map((r) => {
        const ok = r.ok ?? (String(r.mine || '').trim().toLowerCase() === String(r.right || '').trim().toLowerCase());
        return `<div class="answer-line"><b>${esc(r.label)}</b><br>Your answer: <span class="${ok ? 'ok' : 'no'}">${esc(r.mine || 'not answered')}</span>${ok ? '' : `. Correct: <span class="ok">${esc(r.right)}</span>`}</div>`;
      }).join('');
  } else {
    const isHotspot = q.type === 'HOTSPOT';
    const items = isHotspot ? (s.items || []).map((it) => ({ key: it.label, text: it.text, label: it.label })) : q.options;
    const right = key.kind === 'multi' ? key.value : [key.value];
    const mine = Array.isArray(sel) ? sel : sel ? [sel] : [];
    body = (q.type === 'GRAPHIC' || isHotspot ? diagram : '') + `<div class="prompt">${esc(q.prompt)}</div>` + (q.type !== 'GRAPHIC' && !isHotspot ? diagram : '') +
      `<div class="options">${items.map((o) => {
        const isRight = right.map(String).map((x) => x.toUpperCase()).includes(String(o.key).toUpperCase());
        const isMine = mine.map(String).map((x) => x.toUpperCase()).includes(String(o.key).toUpperCase());
        const cls = isRight ? 'correct' : isMine ? 'wrong' : '';
        const tag = isRight && isMine ? 'Your answer, correct' : isRight ? 'Correct answer' : isMine ? 'Your answer' : '';
        return `<div class="option static ${cls} ${isMine ? 'selected' : ''}"><span class="letter">${isHotspot ? '•' : esc(o.key)}</span>
          <span class="option-text">${isHotspot ? `<b>${esc(o.label)}</b><br>` : ''}${esc(o.text)}</span><span class="tag">${tag}</span></div>`;
      }).join('')}</div>`;
  }
  el.appendChild(h(`<div>${body}</div>`));
  if (q.explanation) el.appendChild(h(`<div class="explanation"><b>Why:</b> ${esc(q.explanation)}</div>`));
  return el;
}

// ------------------------------------------------------------------
// Facilitator dashboard
// ------------------------------------------------------------------
async function renderAdmin() {
  const d = await rpc('admin_overview');
  const dash = await rpc('get_dashboard');
  profile = dash.profile;
  const k = d.kpis;
  app.innerHTML = topbar('admin') + `
  <main class="page">
    <h1>Facilitator dashboard</h1>
    <div class="kpis">
      <div class="kpi"><b>${k.candidates}</b><span>Candidates (${k.active} active)</span></div>
      <div class="kpi"><b>${k.attempts}</b><span>Submitted attempts</span></div>
      <div class="kpi"><b>${k.inProgress}</b><span>Exams in progress now</span></div>
      <div class="kpi"><b>${k.firstAttemptPassRate ?? '—'}${k.firstAttemptPassRate != null ? '%' : ''}</b><span>First-attempt pass rate</span></div>
      <div class="kpi"><b>${k.avgFirstAttempt ?? '—'}${k.avgFirstAttempt != null ? '%' : ''}</b><span>Average first-attempt score</span></div>
    </div>
    <div class="tabs" role="tablist">
      <button role="tab" data-tab="cands" aria-selected="true">Candidates</button>
      <button role="tab" data-tab="attempts" aria-selected="false">Attempts</button>
      <button role="tab" data-tab="questions" aria-selected="false">Question analysis</button>
      <button role="tab" data-tab="facil" aria-selected="false">Facilitators</button>
      <button role="tab" data-tab="legacy" aria-selected="false">Previous portal</button>
    </div>
    <div id="tab"></div>
  </main>`;
  wireTopbar(app);
  const tabs = { cands: () => adminCandidates(d), attempts: () => adminAttempts(d), questions: () => adminQuestions(d), facil: () => adminFacilitators(d), legacy: () => adminLegacy(d) };
  $$('[data-tab]').forEach((b) => b.onclick = () => {
    $$('[data-tab]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    tabs[b.dataset.tab]();
  });
  tabs.cands();
}

function adminCandidates(d) {
  const t = $('#tab');
  const mocks = d.mocks;
  t.innerHTML = `<div class="toolbar"><input class="input" id="search" placeholder="Search name, email or reg number" aria-label="Search candidates">
    <span class="spacer"></span><button class="btn secondary small" id="csv">Download CSV</button></div>
    <p class="hint">Scores show first attempt / best. A mock with a manual unlock can be opened without passing the previous mock.</p>
    <div class="table-wrap"><table><thead><tr><th>Reg no.</th><th>Name</th><th>Email</th><th>Status</th>
    ${mocks.map((m) => `<th>${esc(m.title)}</th>`).join('')}</tr></thead><tbody id="cbody"></tbody></table></div>`;
  const draw = () => {
    const q = $('#search').value.trim().toLowerCase();
    const rows = d.candidates.filter((c) => !q || [c.fullName, c.email, c.regNumber].join(' ').toLowerCase().includes(q));
    $('#cbody').innerHTML = rows.map((c) => `<tr>
      <td>${esc(c.regNumber)}</td><td>${esc(c.fullName || '—')}${c.role === 'admin' ? ' <span class="pill warn">Facilitator</span>' : ''}</td><td>${esc(c.email)}</td>
      <td><button class="btn small ${c.status === 'active' ? 'secondary' : 'danger'}" data-status="${esc(c.id)}" data-to="${c.status === 'active' ? 'inactive' : 'active'}" ${c.id === profile.id ? 'disabled' : ''}>${c.status === 'active' ? 'Active' : 'Inactive'}</button></td>
      ${mocks.map((m) => { const s = c.mocks[m.id] || {};
        return `<td>${s.attempts ? `${s.first}% / ${s.best}%<br><span class="hint">${s.attempts} attempt${s.attempts > 1 ? 's' : ''}</span>` : '<span class="hint">—</span>'}
          ${!s.unlocked || s.manualUnlock ? `<br><button class="btn quiet small unlock-toggle" data-unlock="${esc(c.id)}" data-mock="${esc(m.id)}" data-on="${s.manualUnlock ? 'false' : 'true'}">${s.manualUnlock ? 'Remove unlock' : 'Unlock'}</button>` : ''}</td>`; }).join('')}
    </tr>`).join('') || `<tr><td colspan="${4 + mocks.length}">No candidates match.</td></tr>`;
    $$('[data-status]').forEach((b) => b.onclick = async () => {
      try { await rpc('admin_set_status', { p_user_id: b.dataset.status, p_status: b.dataset.to }); const c = d.candidates.find((x) => x.id === b.dataset.status); c.status = b.dataset.to; toast(`Candidate set to ${b.dataset.to}.`); draw(); } catch (e) { toast(e.message, true); }
    });
    $$('[data-unlock]').forEach((b) => b.onclick = async () => {
      const on = b.dataset.on === 'true';
      try { await rpc('admin_set_unlock', { p_user_id: b.dataset.unlock, p_mock_id: b.dataset.mock, p_unlocked: on }); toast(on ? 'Mock unlocked.' : 'Unlock removed.'); renderAdmin(); } catch (e) { toast(e.message, true); }
    });
  };
  $('#search').oninput = draw;
  $('#csv').onclick = () => csvDownload('candidates.csv', [['Reg no', 'Name', 'Email', 'Status', 'Registered', ...mocks.flatMap((m) => [m.title + ' first %', m.title + ' best %', m.title + ' attempts'])],
    ...d.candidates.map((c) => [c.regNumber, c.fullName, c.email, c.status, c.createdAt, ...mocks.flatMap((m) => { const s = c.mocks[m.id] || {}; return [s.first ?? '', s.best ?? '', s.attempts || 0]; })])]);
  draw();
}

function adminAttempts(d) {
  const t = $('#tab');
  const title = Object.fromEntries(d.mocks.map((m) => [m.id, m.title]));
  t.innerHTML = `<div class="toolbar"><span class="hint">Latest 300 submitted attempts. Very short times with high scores are worth a closer look.</span>
    <span class="spacer"></span><button class="btn secondary small" id="csv">Download CSV</button></div>
    <div class="table-wrap"><table><thead><tr><th>Submitted</th><th>Candidate</th><th>Mock</th><th class="num">Attempt</th><th class="num">Score</th><th class="num">Answered</th><th class="num">Time used</th><th>Ended by</th><th></th></tr></thead><tbody>
    ${d.recentAttempts.map((a) => `<tr><td>${fmtDate(a.submittedAt)}</td><td>${esc(a.fullName)}<br><span class="hint">${esc(a.regNumber)}</span></td><td>${esc(title[a.mockId] || a.mockId)}</td>
      <td class="num">${a.attemptNo}</td><td class="num"><span class="pill ${a.passed ? 'pass' : 'fail'}">${a.percentage}%</span></td><td class="num">${a.answered}/${a.total}</td>
      <td class="num">${fmtDuration(a.timeUsedSeconds)}${a.timeUsedSeconds != null && a.timeUsedSeconds < a.total * 20 && a.percentage >= 70 ? ' <span class="pill warn">Fast</span>' : ''}</td>
      <td>${a.submitReason === 'time_expired' ? 'Time limit' : 'Candidate'}</td><td><a href="#/result/${esc(a.id)}">Review</a></td></tr>`).join('') || '<tr><td colspan="9">No attempts yet.</td></tr>'}
    </tbody></table></div>`;
  $('#csv').onclick = () => csvDownload('attempts.csv', [['Submitted', 'Name', 'Reg no', 'Email', 'Mock', 'Attempt', 'Score %', 'Passed', 'Answered', 'Total', 'Time used (s)', 'Ended by'],
    ...d.recentAttempts.map((a) => [a.submittedAt, a.fullName, a.regNumber, a.email, title[a.mockId] || a.mockId, a.attemptNo, a.percentage, a.passed ? 'Yes' : 'No', a.answered, a.total, a.timeUsedSeconds, a.submitReason])]);
}

async function adminQuestions(d) {
  const t = $('#tab');
  t.innerHTML = `<div class="toolbar"><label for="qm" class="hint">Mock</label><select class="input" id="qm" style="max-width:260px">${d.mocks.map((m) => `<option value="${esc(m.id)}">${esc(m.title)}</option>`).join('')}</select>
    <span class="spacer"></span><button class="btn secondary small" id="csv">Download CSV</button></div>
    <p class="hint">Sorted from hardest to easiest. Questions almost everyone gets right are too easy for a realistic mock; questions almost nobody gets right may have a wrong answer key.</p>
    <div id="qstats"><p class="hint">Loading…</p></div>`;
  let rows = [];
  const load = async () => {
    try {
      rows = await rpc('admin_question_stats', { p_mock_id: $('#qm').value });
      const sorted = [...rows].sort((a, b) => (a.pctCorrect ?? 101) - (b.pctCorrect ?? 101));
      $('#qstats').innerHTML = `<div class="table-wrap"><table><thead><tr><th class="num">Q</th><th>Domain</th><th>Type</th><th>Question</th><th class="num">Answered</th><th class="num">Correct</th><th>Note</th></tr></thead><tbody>
        ${sorted.map((r) => `<tr><td class="num">${r.qNumber}</td><td>${esc(titleCase(r.domain))}</td><td>${esc(r.type)}</td><td>${esc(r.prompt)}</td>
          <td class="num">${r.answered}</td><td class="num">${r.pctCorrect == null ? '—' : r.pctCorrect + '%'}</td>
          <td>${r.answered >= 5 && r.pctCorrect >= 90 ? '<span class="pill warn">Too easy</span>' : r.answered >= 5 && r.pctCorrect <= 20 ? '<span class="pill fail">Check key</span>' : ''}</td></tr>`).join('')}
        </tbody></table></div>`;
    } catch (e) { toast(e.message, true); }
  };
  $('#qm').onchange = load;
  $('#csv').onclick = () => csvDownload('question-analysis.csv', [['Q', 'Code', 'Domain', 'Type', 'Section', 'Answered', 'Correct', '% correct', 'Question'],
    ...rows.map((r) => [r.qNumber, r.code, r.domain, r.type, r.section, r.answered, r.correct, r.pctCorrect ?? '', r.prompt])]);
  load();
}

function adminFacilitators(d) {
  const t = $('#tab');
  t.innerHTML = `<div class="panel stack" style="max-width:640px"><h2>Facilitators</h2>
    <p class="hint">Facilitators can see every candidate, attempt and answer review. Add the email they will sign in with.</p>
    <form class="row" id="addf"><input class="input" id="femail" type="email" placeholder="name@example.com" style="max-width:340px" required><button class="btn" type="submit">Add facilitator</button></form>
    <div class="table-wrap"><table><tbody>${d.facilitatorEmails.map((e) => `<tr><td>${esc(e)}</td><td class="num">${e === profile.email ? '<span class="hint">You</span>' : `<button class="btn quiet small" data-remove="${esc(e)}">Remove</button>`}</td></tr>`).join('')}</tbody></table></div></div>`;
  $('#addf').onsubmit = async (e) => { e.preventDefault(); try { await rpc('admin_set_facilitator', { p_email: $('#femail').value, p_is_facilitator: true }); toast('Facilitator added.'); renderAdmin(); } catch (er) { toast(er.message, true); } };
  $$('[data-remove]').forEach((b) => b.onclick = async () => {
    if (!(await confirmBox('Remove facilitator?', `<p>${esc(b.dataset.remove)} will lose access to the facilitator dashboard.</p>`, 'Remove', { danger: true }))) return;
    try { await rpc('admin_set_facilitator', { p_email: b.dataset.remove, p_is_facilitator: false }); toast('Facilitator removed.'); renderAdmin(); } catch (er) { toast(er.message, true); }
  });
}

function adminLegacy(d) {
  const t = $('#tab');
  const title = Object.fromEntries(d.mocks.map((m) => [m.id, m.title]));
  t.innerHTML = `<h2>Results imported from the previous portal</h2>
    <p class="hint">Scores were recalculated from the number of correct answers. These were taken when answers could be seen in the browser, so treat them with caution.
    They do not unlock mocks; use Unlock on the Candidates tab if needed.</p>
    <div class="table-wrap"><table><thead><tr><th>Date</th><th>Name</th><th>Email</th><th>Mock</th><th class="num">Score</th><th class="num">Correct</th><th class="num">Time</th></tr></thead><tbody>
    ${d.legacyResults.map((l) => `<tr><td>${fmtDate(l.submittedAt)}</td><td>${esc(l.fullName)}</td><td>${esc(l.email)}</td><td>${esc(title[l.mockId] || l.mockId)}</td>
      <td class="num">${l.percentage}%</td><td class="num">${l.correct}/${l.total}</td><td class="num">${fmtDuration(l.durationSeconds)}</td></tr>`).join('')}</tbody></table></div>
    <h2 style="margin-top:28px">Previous candidates who have not signed in yet</h2>
    <p class="hint">They keep their registration number when they sign in with the same email.</p>
    <div class="table-wrap"><table><thead><tr><th>Reg no.</th><th>Name</th><th>Email</th></tr></thead><tbody>
    ${d.legacyCandidatesNotYetSignedIn.map((c) => `<tr><td>${esc(c.regNumber)}</td><td>${esc(c.fullName)}</td><td>${esc(c.email)}</td></tr>`).join('') || '<tr><td colspan="3">Everyone has signed in.</td></tr>'}</tbody></table></div>`;
}

// ------------------------------------------------------------------
// Start
// ------------------------------------------------------------------
window.addEventListener('hashchange', route);
if (sb) {
  sb.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_IN' && (showingSignIn || /access_token/.test(location.hash))) {
      showingSignIn = false;
      if (!location.hash || location.hash === '#/' || /access_token/.test(location.hash)) {
        history.replaceState(null, '', location.pathname + '#/dashboard');
      }
      setTimeout(route, 0);
    }
    if (event === 'SIGNED_OUT') { profile = null; stopExam(); renderSignIn(); }
  });
}
route();
