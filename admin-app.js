(function () {
'use strict';
const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, '0');
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
const D = d => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
const T = d => new Date(d).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const mmss = s => pad(Math.floor(s / 60)) + ':' + pad(s % 60);
const DAY = d => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' });
const DFMT = d => D(d + 'T12:00:00');

const BASE = (window.API_BASE || '').replace(/\/+$/, '');
const tok = () => { try { return sessionStorage.getItem('asid') || ''; } catch (e) { return ''; } };
async function api(path, body) {
  const parts = path.split('?'), q = {};
  if (parts[1]) new URLSearchParams(parts[1]).forEach((v, k) => { q[k] = v; });
  let j;
  try {
    // plain-text POST: works from GitHub Pages without any CORS set-up
    const r = await fetch(BASE, { method: 'POST', redirect: 'follow', body: JSON.stringify({ path: parts[0], q, token: tok(), body: body === undefined ? {} : body }) });
    j = await r.json();
  } catch (e) { throw new Error('Cannot reach the server. Check your internet connection.'); }
  if (j.status === 401) { try { sessionStorage.removeItem('asid'); } catch (e) {} location.reload(); throw new Error('Session ended'); }
  if (j.status !== 200) { const e = new Error(j.error || 'Request failed'); e.status = j.status; throw e; }
  return j.data;
}

let ME, SET, tab = 'dash', poll = null, slips = [];
const app = $('app');

async function init() {
  ME = await api('/api/admin/me'); SET = await api('/api/admin/settings');
  app.innerHTML = '<div class="wrap"><div class="tabs" id="tabs"></div><div id="pane"></div></div>';
  [['dash', 'Dashboard'], ['res', 'Results'], ['qs', 'Questions'], ['set', 'Settings']].forEach(([k, l]) => {
    const b = document.createElement('button'); b.textContent = l; b.dataset.k = k; b.onclick = () => go(k); $('tabs').appendChild(b);
  });
  const lo = document.createElement('button'); lo.textContent = 'Logout'; lo.style.marginLeft = 'auto';
  lo.onclick = async () => { try { await api('/api/admin/logout', {}); } catch (e) {} try { sessionStorage.removeItem('asid'); } catch (x) {} location.reload(); };
  $('tabs').appendChild(lo);
  go('dash');
}
function go(k) {
  tab = k; clearInterval(poll); poll = null;
  [...$('tabs').children].forEach(b => b.classList.toggle('on', b.dataset.k === k));
  ({ dash: viewDash, cand: viewCand, res: viewRes, qs: viewQs, set: viewSet })[k]();
}
const msg = (el, text, cls) => { el.className = 'msg ' + (cls || ''); el.textContent = text; };

/* =============== DASHBOARD =============== */
function viewDash() {
  $('pane').innerHTML = `
  <div class="box"><h3>Test Entry Control</h3>
    <div id="entryline" style="margin-bottom:10px"></div><div id="codebox"></div>
    <div class="arow" style="align-items:center;margin-top:0">
      <span>Keep entry open for</span><input class="in" style="width:90px" type="number" id="emin" min="1" max="240" value="${SET.entry_window_min}"><span>minutes</span>
      <button class="btn grn" id="eopen">Open Entry</button><button class="btn red" id="eclose">Close Entry Now</button>
    </div>
    <p class="fine" style="margin:10px 0 0">Press Open Entry: a 5-digit Test Code appears. Write it on the board for the students in the centre. Students log in with Name, Father Name, Course and this code. When the entry window ends, nobody new can start; students already inside continue until their own timer finishes. Each press of Open Entry creates a new code.</p>
  </div>
  <div class="row2" id="counts"></div>
  <div class="box" style="margin-top:16px"><h3>Students Taking the Test Now</h3><div class="scroll" id="live"></div></div>`;
  $('eopen').onclick = async () => { await api('/api/admin/entry', { action: 'open', minutes: +$('emin').value || SET.entry_window_min }); refresh(); };
  $('eclose').onclick = async () => { await api('/api/admin/entry', { action: 'close' }); refresh(); };
  refresh(); poll = setInterval(refresh, 8000);
}
let dashOff = 0, dashUntil = 0, tickIv = null, dashCode = '';
async function refresh() {
  if (tab !== 'dash') return;
  let s; try { s = await api('/api/admin/status'); } catch (e) { return; }
  if (tab !== 'dash') return;
  dashOff = s.now - Date.now(); dashUntil = s.entryOpen ? s.entryUntil : 0; dashCode = s.entryOpen ? s.code : ''; drawEntry();
  clearInterval(tickIv); tickIv = setInterval(() => { if (tab !== 'dash') clearInterval(tickIv); else drawEntry(); }, 1000);
  const c = s.counts;
  $('counts').innerHTML = [['Logged in Today', c.registered], ['Not Started Yet', c.pending], ['Taking Test', c.running], ['Completed', c.completed]].map(([l, v]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('');
  $('live').innerHTML = s.running.length ? `<table class="dt"><tr><th>Roll</th><th>Name</th><th>Father</th><th>Course</th><th>Time Left</th><th>Answered</th><th>Warnings</th><th></th></tr>` +
    s.running.map(r => `<tr><td>${esc(r.roll)}</td><td>${esc(r.name)}</td><td>${esc(r.father)}</td><td>${esc(r.courseName)}</td><td>${mmss(r.left)}</td><td>${r.answered}/${r.total}</td><td>${r.violations}</td>
    <td><button class="btn ghost sm" data-a="rel" data-id="${r.id}">Allow other device</button> <button class="btn red sm" data-a="end" data-id="${r.id}">End paper</button></td></tr>`).join('') + '</table>' : '<p class="fine">Nobody is taking the test right now.</p>';
  $('live').querySelectorAll('button').forEach(b => b.onclick = async () => {
    if (b.dataset.a === 'end' && !confirm('End this student\'s paper now?')) return;
    try { await api(b.dataset.a === 'end' ? '/api/admin/candidates/force-end' : '/api/admin/candidates/release', { id: b.dataset.id }); refresh(); } catch (e) { alert(e.message); }
  });
}
function drawEntry() {
  const el = $('entryline'); if (!el) return;
  const left = Math.round((dashUntil - (Date.now() + dashOff)) / 1000);
  const cb = $('codebox'); if (cb) cb.innerHTML = left > 0 && dashCode ? `<div style="text-align:center;margin:6px 0 14px"><span class="fine">TEST CODE (write on the board)</span><div style="font:700 64px Consolas,monospace;letter-spacing:10px;color:var(--p)">${esc(dashCode)}</div></div>` : '';
  el.innerHTML = left > 0 ? `<span class="status on">Entry is OPEN</span> closes in <b>${mmss(left)}</b>` : '<span class="status off">Entry is CLOSED</span> students cannot start the test.';
}

/* =============== STUDENTS =============== */
function viewCand() {
  const opts = ME.courses.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  $('pane').innerHTML = `
  <div class="box"><h3>Add Students</h3>
    <div class="row2">
      <div><label class="lbl">Test Date</label><input class="in" type="date" id="cdate" value="${ME.today}"></div>
      <div><label class="lbl">Course</label><select class="in" id="ccourse">${opts}</select></div>
    </div>
    <label class="lbl">Students (one per line: Student Name, Father Name)</label>
    <textarea class="in" id="clist" placeholder="Ali Khan, Muhammad Khan&#10;Sara Bibi, Abdul Rehman"></textarea>
    <div class="arow"><button class="btn" id="cadd">Add and Generate Passwords</button></div>
    <div id="cmsg" class="msg"></div>
  </div>
  <div class="box"><h3>Students List</h3>
    <div class="arow" style="margin:0 0 10px;align-items:center"><span>Date</span><input class="in" style="width:190px" type="date" id="fdate" value="${ME.today}"><button class="btn ghost sm" id="slipbtn">Print last generated slips</button></div>
    <div class="scroll" id="clistbox"></div>
  </div>`;
  $('cadd').onclick = async () => {
    const list = $('clist').value.split('\n').map(l => l.trim()).filter(Boolean).map(l => { const i = l.indexOf(','); return i < 0 ? { name: l, father: '' } : { name: l.slice(0, i), father: l.slice(i + 1) }; });
    if (!list.length) return msg($('cmsg'), 'Write at least one student.', 'e');
    try { slips = await api('/api/admin/candidates/add', { date: $('cdate').value, course: $('ccourse').value, list }); $('clist').value = ''; msg($('cmsg'), slips.length + ' students added. Passwords are shown only once, so print the slips now.', 'g'); $('fdate').value = $('cdate').value; loadCand(); showSlips(); }
    catch (e) { msg($('cmsg'), e.message, 'e'); }
  };
  $('slipbtn').onclick = () => slips.length ? showSlips() : alert('No new passwords in this session. Use Reset Password for a student.');
  $('fdate').onchange = loadCand; loadCand();
}
async function loadCand() {
  const rows = await api('/api/admin/candidates?date=' + $('fdate').value);
  $('clistbox').innerHTML = rows.length ? `<table class="dt"><tr><th>Roll</th><th>Name</th><th>Father</th><th>Course</th><th>Status</th><th>Result</th><th></th></tr>` + rows.map(r => `<tr>
    <td>${esc(r.roll)}</td><td>${esc(r.name)}</td><td>${esc(r.father)}</td><td>${esc(r.courseName)}</td><td><span class="tag ${r.status}">${r.status}</span></td>
    <td>${r.status === 'completed' ? r.correct + '/' + r.total + ' (' + r.pct + '%)' : ''}</td>
    <td>${r.status === 'pending' ? `<button class="btn ghost sm" data-a="pw" data-id="${r.id}">Reset Password</button> <button class="btn red sm" data-a="del" data-id="${r.id}">Delete</button>` : ''}
        ${r.status === 'completed' ? `<button class="btn ghost sm" data-a="retake" data-id="${r.id}">Allow Retake</button>` : ''}</td></tr>`).join('') + '</table>' : '<p class="fine">No students for this date.</p>';
  $('clistbox').querySelectorAll('button').forEach(b => b.onclick = async () => {
    const a = b.dataset.a, id = b.dataset.id;
    try {
      if (a === 'pw') { slips = await api('/api/admin/candidates/reset-password', { id }); showSlips(); }
      else if (a === 'del') { if (confirm('Delete this student?')) { await api('/api/admin/candidates/delete', { id }); loadCand(); } }
      else if (a === 'retake') { if (confirm('The old result is archived and a new password is generated so the student can take the test again. Continue?')) { slips = await api('/api/admin/candidates/retake', { id }); showSlips(); loadCand(); } }
    } catch (e) { alert(e.message); }
  });
}
function showSlips() {
  const center = SET.center;
  $('sheet').innerHTML = `<div class="rh"><h1>${esc(center)}</h1><p>Entry Test &mdash; Student Login Slips</p></div><div class="slips">` + slips.map(s => `<div class="slip">
    <b>${esc(center)}</b><br>Name: <b>${esc(s.name)}</b><br>Father: ${esc(s.father)}<br>Course: ${esc(s.courseName)}<br>Test Date: ${esc(DFMT(s.date))}<br>
    Roll No: <b>${esc(s.roll)}</b><br>Password: <b class="pw">${esc(s.password)}</b><br><span class="fine">One attempt only. Do not share this slip.</span></div>`).join('') + '</div>';
  $('report').classList.remove('hidden');
}

/* =============== RESULTS =============== */
let RR = [], RDATE = '';
async function viewRes() {
  const dates = await api('/api/admin/dates');
  RDATE = RDATE || (dates[0] ? dates[0].date : ME.today);
  $('pane').innerHTML = `
  <div class="box"><h3>Results</h3>
    <div class="arow" style="margin:0;align-items:end">
      <div><label class="lbl">Test Date</label><input class="in" type="date" id="rdate" value="${RDATE}"></div>
      <div><label class="lbl">Course</label><select class="in" id="rcourse"><option value="">All courses</option>${ME.courses.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>
      <button class="btn" id="rsum">Print All Courses</button>${ME.courses.map(c => `<button class="btn grn" data-pc="${c.id}">Print: ${esc(c.name)}</button>`).join('')}<button class="btn ghost" id="rsep">All Courses (separate pages)</button><button class="btn ghost" id="rcsv">Download CSV</button>
    </div>
    <p class="fine" style="margin:10px 0 0">Dates with results: ${dates.length ? dates.map(d => `<a href="#" class="dl" data-d="${d.date}">${d.date} (${d.count})</a>`).join(' &bull; ') : 'none yet'}</p>
  </div>
  <div class="box"><div id="rstats" class="row2" style="margin-bottom:14px"></div><div class="scroll" id="rtable"></div></div>`;
  document.querySelectorAll('.dl').forEach(a => a.onclick = e => { e.preventDefault(); $('rdate').value = a.dataset.d; loadRes(); });
  $('rdate').onchange = loadRes; $('rcourse').onchange = loadRes;
  $('rsum').onclick = () => printSummary(''); $('rsep').onclick = () => printSummary('*'); document.querySelectorAll('[data-pc]').forEach(b => b.onclick = () => printSummary(b.dataset.pc)); $('rcsv').onclick = async () => {
    try {
      const r = await api('/api/admin/export?date=' + $('rdate').value);
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([r.csv], { type: 'text/csv' })); a.download = 'results_' + $('rdate').value + '.csv'; a.click();
    } catch (e) { alert(e.message); }
  };
  loadRes();
}
function stats(rows) {
  const n = rows.length, pass = rows.filter(r => r.pass).length, avg = n ? Math.round(rows.reduce((a, r) => a + r.pct, 0) / n * 10) / 10 : 0;
  return { n, pass, fail: n - pass, avg, hi: n ? Math.max(...rows.map(r => r.pct)) : 0, lo: n ? Math.min(...rows.map(r => r.pct)) : 0 };
}
let RALL = [];
async function loadRes() {
  RDATE = $('rdate').value;
  RALL = await api('/api/admin/results?date=' + RDATE); const fc = $('rcourse').value; RALL.sort((a, b) => a.courseName.localeCompare(b.courseName) || b.pct - a.pct || a.name.localeCompare(b.name));
  RR = fc ? RALL.filter(r => r.course === fc) : RALL.slice();
  RR.sort((a, b) => a.courseName.localeCompare(b.courseName) || b.pct - a.pct || a.name.localeCompare(b.name));
  const s = stats(RR);
  $('rstats').innerHTML = [['Appeared', s.n], ['Passed', s.pass], ['Failed', s.fail], ['Average %', s.avg], ['Highest %', s.hi], ['Lowest %', s.lo]].map(([l, v]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('');
  $('rtable').innerHTML = RR.length ? `<table class="dt"><tr><th>#</th><th>Roll</th><th>Name</th><th>Father</th><th>Qualification</th><th>Course</th><th>Correct</th><th>Wrong</th><th>N/A</th><th>%</th><th>Grade</th><th>Result</th><th>Time</th><th>Warn</th><th></th></tr>` +
    RR.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.roll)}</td><td>${esc(r.name)}</td><td>${esc(r.father)}</td><td>${esc(r.qual || '')}</td><td>${esc(r.courseName)}</td><td>${r.correct}</td><td>${r.wrong}</td><td>${r.unanswered}</td><td>${r.pct}</td><td>${r.grade}</td>
    <td><span class="tag ${r.pass ? 'pass' : 'fail'}">${r.pass ? 'PASS' : 'FAIL'}</span></td><td>${mmss(r.used)}</td><td>${r.violations || ''}</td><td><button class="btn ghost sm" data-id="${r.id}">Detail</button> <button class="btn ghost sm" data-rt="${r.id}">Retake</button></td></tr>`).join('') + '</table>' : '<p class="fine">No completed tests for this date.</p>';
  $('rtable').querySelectorAll('button').forEach(b => b.onclick = async () => {
    if (b.dataset.rt) { if (!confirm('Allow this student to take the test again? The old result is archived and removed from this list.')) return; try { await api('/api/admin/candidates/retake', { id: b.dataset.rt }); loadRes(); } catch (e) { alert(e.message); } }
    else detail(b.dataset.id);
  });
}
function sumPage(rows, label, perLine, last) {
  const n = rows.length, fs = n <= 25 ? 13 : n <= 40 ? 11 : n <= 55 ? 9.5 : n <= 75 ? 8.2 : 7, s = stats(rows), cc = 'text-align:center';
  const rh = Math.round(Math.max(fs * 1.9, Math.min(fs * 3.4, 700 / (n + 1))));
  const per = perLine ? ME.courses.map(c => { const x = rows.filter(r => r.course === c.id); return x.length ? `${esc(c.name)}: ${x.length} appeared, ${x.filter(r => r.pass).length} passed` : ''; }).filter(Boolean).join(' &nbsp;|&nbsp; ') : '';
  return `<div class="sum" style="font-size:${fs}px;${last ? '' : 'page-break-after:always;margin-bottom:30px'}">
  <div class="rh" style="padding-bottom:8px;margin-bottom:10px"><h1 style="font-size:${fs + 8}px">${esc(SET.center)}</h1><p style="font-size:${fs + 1}px">Entry Test Result Summary &mdash; ${esc(label)}<br><b>Test Date: ${esc(DFMT(RDATE))} (${DAY(RDATE)})</b></p></div>
  <table style="width:100%;border-collapse:collapse;margin-bottom:8px"><tr>
   ${[['Appeared', s.n], ['Passed', s.pass], ['Failed', s.fail], ['Average %', s.avg], ['Highest %', s.hi], ['Lowest %', s.lo]].map(([l, v]) => `<td style="${cc}"><b style="font-size:${fs + 5}px">${v}</b><br>${l}</td>`).join('')}</tr></table>
  ${per ? `<div style="margin-bottom:6px">${per}</div>` : ''}
  <table style="width:100%;border-collapse:collapse;table-layout:fixed"><colgroup><col style="width:4%"><col style="width:6%"><col style="width:15%"><col style="width:15%"><col style="width:12%"><col style="width:12%"><col style="width:7%"><col style="width:6%"><col style="width:23%"></colgroup>
  <tr><th>Sr</th><th>Roll</th><th>Student Name</th><th>Father Name</th><th>Qualification</th><th>Course</th><th>Result</th><th>Time</th><th>Remarks</th></tr>` +
    rows.map((r, i) => `<tr style="height:${rh}px"><td style="${cc}">${i + 1}</td><td style="${cc}">${esc(r.roll)}</td><td>${esc(r.name)}</td><td>${esc(r.father)}</td><td>${esc(r.qual || '')}</td><td>${esc(r.courseName)}</td><td style="${cc}"><b>${r.pass ? 'PASS' : 'FAIL'}</b></td><td style="${cc}">${mmss(r.used)}</td><td></td></tr>`).join('') +
    `</table><div class="rf" style="font-size:${Math.max(7, fs - 2)}px">Passing percentage ${SET.pass_pct}% &bull; Printed on ${D(Date.now())} ${T(Date.now())}</div>
  <div class="sign" style="margin-top:22px"><div>Prepared by</div><div>Instructor / Incharge</div></div></div>`;
}
/* sel: '' = all courses together, course id = that course only, '*' = every course on its own page */
function printSummary(sel) {
  const groups = sel === '*' ? ME.courses.map(c => [c.name, RALL.filter(r => r.course === c.id), false]).filter(g => g[1].length)
    : sel ? [[(ME.courses.find(c => c.id === sel) || {}).name || sel, RALL.filter(r => r.course === sel), false]] : [['All Courses', RALL, true]];
  if (!groups.length || !groups[0][1].length) return alert('No results for this date.');
  $('sheet').innerHTML = groups.map((g, i) => sumPage(g[1], g[0], g[2], i === groups.length - 1)).join('');
  $('report').classList.remove('hidden');
}
async function detail(id) {
  const r = await api('/api/admin/result/' + id), N = r.total;
  const reasons = { submitted: 'Submitted by student', time: 'Time over (auto)', violations: 'Auto-ended (too many warnings)', admin: 'Ended by admin' };
  const segs = [[r.correct, '#0b9f6e'], [r.wrong, '#e0445a'], [r.unanswered, '#9aa5b8']], R = 54, C = 2 * Math.PI * R; let off = 0;
  const arcs = segs.map(([v, col]) => { const l = v / N * C, s = `<circle cx="70" cy="70" r="${R}" fill="none" stroke="${col}" stroke-width="22" stroke-dasharray="${l} ${C - l}" stroke-dashoffset="${-off}" transform="rotate(-90 70 70)"/>`; off += l; return s; }).join('');
  const vl = r.violationLog.length ? r.violationLog.map(v => T(v.t) + ' (' + esc(v.type) + ')').join(', ') : 'None';
  $('sheet').innerHTML = `
  <div class="rh"><h1>${esc(SET.center)}</h1><p>Entry Test Detailed Result &mdash; ${esc(r.course)}</p></div>
  <table class="info">
   <tr><td>Student Name</td><td>${esc(r.name)}</td><td>Father Name</td><td>${esc(r.father)}</td></tr>
   <tr><td>Course</td><td>${esc(r.course)}</td><td>Roll No.</td><td>${esc(r.roll)}</td></tr>
   <tr><td>Qualification</td><td colspan="3">${esc(r.qual || '-')}</td></tr>
   <tr><td>Test Date</td><td>${esc(DFMT(r.date))}</td><td>Day</td><td>${DAY(r.date)}</td></tr>
   <tr><td>Start Time</td><td>${T(r.startedAt)}</td><td>End Time</td><td>${T(r.finishedAt)}</td></tr>
   <tr><td>Time Allowed</td><td>${Math.round(r.durationSec / 60)} minutes</td><td>Time Used</td><td>${mmss(r.used)} (mm:ss)</td></tr>
   <tr><td>Ended By</td><td colspan="3">${esc(reasons[r.reason] || r.reason)}</td></tr>
   <tr><td>Warnings</td><td colspan="3">${r.violations} &mdash; ${vl}</td></tr>
  </table>
  <div class="score"><div><b>${N}</b><span>Total Marks</span></div><div><b>${r.correct}</b><span>Obtained Marks</span></div><div><b>${r.pct}%</b><span>Percentage</span></div><div><b>${r.grade}</b><span>Grade</span></div></div>
  <div class="res ${r.pass ? 'p' : 'f'}">Result: ${r.pass ? 'PASS' : 'FAIL'} &nbsp;(Correct ${r.correct}, Wrong ${r.wrong}, Not attempted ${r.unanswered} &bull; Passing ${r.passPct}%)</div>
  <h2 style="text-align:left;font-size:16px">Question-wise Review</h2>
  <table class="rv" style="width:100%;border-collapse:collapse"><tr><th>#</th><th>Question</th><th>Student Answer</th><th>Correct Answer</th><th></th></tr>` +
    r.review.map((q, i) => { const ok = q.chosen === q.a; return `<tr><td>${i + 1}</td><td>${esc(q.q)}</td><td>${q.chosen >= 0 ? 'ABCD'[q.chosen] + '. ' + esc(q.o[q.chosen]) : '<i>Not attempted</i>'}</td><td>${'ABCD'[q.a]}. ${esc(q.o[q.a])}</td><td class="${ok ? 'ok' : 'no'}">${ok ? '&#10003;' : '&#10007;'}</td></tr>`; }).join('') +
    `</table><div class="rf">Printed on ${D(Date.now())} at ${T(Date.now())} &bull; Computer generated report</div>`;
  $('report').classList.remove('hidden');
}
$('rclose').onclick = () => $('report').classList.add('hidden'); $('prt').onclick = () => window.print();

/* =============== QUESTIONS =============== */
let pending = null;
function viewQs() {
  $('pane').innerHTML = `
  <div class="box"><h3>Upload MCQs</h3>
   <ol class="rules" style="margin-top:0">
    <li>Click "Download Template" and open it in Microsoft Excel. Row 1 is the heading row. Start your MCQs from row 2.</li>
    <li>Use exactly 6 columns: A = Question, B = Option A, C = Option B, D = Option C, E = Option D, F = Correct Answer (one letter: A, B, C or D).</li>
    <li>Every question needs all 4 options. No empty cells and no blank rows. Save as .xlsx or .csv (only the first sheet is read).</li>
    <li>Choose the course and file, press Check File, then Save Questions. Saved questions replace the old questions of that course.</li>
   </ol>
   <div class="row2"><div><label class="lbl">Course</label><select class="in" id="qcourse">${ME.courses.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select><div class="fine" id="qcount" style="margin-top:6px"></div></div>
   <div><label class="lbl">Excel (.xlsx) or CSV file</label><input class="in" type="file" id="qfile" accept=".xlsx,.csv"></div></div>
   <div class="arow"><button class="btn" id="qcheck">Check File</button><button class="btn grn" id="qsave" disabled>Save Questions</button><button class="btn ghost" id="qtpl">Download Template</button><button class="btn ghost" id="qreset">Restore Default</button></div>
   <div id="qmsg" class="msg"></div>
  </div>
  <div class="box"><h3>Current Questions (admin view only)</h3><div class="scroll" id="qlist"></div></div>`;
  $('qcourse').onchange = () => { pending = null; $('qsave').disabled = true; $('qmsg').textContent = ''; loadQs(); };
  $('qcheck').onclick = checkFile; $('qsave').onclick = saveQs; $('qtpl').onclick = tpl;
  $('qreset').onclick = async () => { if (!confirm('Replace this course\'s questions with the built-in default set?')) return; await api('/api/admin/questions/reset', { course: $('qcourse').value }); msg($('qmsg'), 'Default questions restored.', 'g'); loadQs(); };
  loadQs();
}
async function loadQs() {
  const qs = await api('/api/admin/questions?course=' + $('qcourse').value);
  $('qcount').textContent = 'Saved questions for this course: ' + qs.length;
  $('qlist').innerHTML = `<table class="dt"><tr><th>#</th><th>Question</th><th>A</th><th>B</th><th>C</th><th>D</th><th>Ans</th></tr>` + qs.map((q, i) => `<tr><td>${i + 1}</td><td>${esc(q.q)}</td>${q.o.map(o => `<td>${esc(o)}</td>`).join('')}<td><b>${'ABCD'[q.a]}</b></td></tr>`).join('') + '</table>';
}
function tpl() {
  const t = 'Question,Option A,Option B,Option C,Option D,Correct Answer\nWhat does CPU stand for?,Central Process Unit,Central Processing Unit,Computer Personal Unit,Control Program Unit,B\nWhich of these is an input device?,Monitor,Printer,Keyboard,Speaker,C\n';
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\uFEFF' + t], { type: 'text/csv' })); a.download = 'MCQ_Template.csv'; a.click();
}
/* file parsing (runs in the admin's browser; the server validates again) */
function csv(t) { t = t.replace(/^\uFEFF/, ''); const l0 = t.split('\n')[0]; const d = (l0.match(/;/g) || []).length > (l0.match(/,/g) || []).length ? ';' : ','; const rows = []; let r = [], f = '', q = false;
  for (let i = 0; i < t.length; i++) { const ch = t[i]; if (q) { if (ch === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; } else if (ch === '"') q = true; else if (ch === d) { r.push(f); f = ''; } else if (ch === '\n') { r.push(f); rows.push(r); r = []; f = ''; } else if (ch !== '\r') f += ch; }
  if (f || r.length) { r.push(f); rows.push(r); } return rows; }
async function inflate(u8) { const s = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw')); return new Uint8Array(await new Response(s).arrayBuffer()); }
async function unzip(buf) { const dv = new DataView(buf), u = new Uint8Array(buf); let e = u.length - 22; while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--; if (e < 0) throw Error('Not a valid .xlsx file.');
  const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true); const out = {}, td = new TextDecoder();
  for (let i = 0; i < n; i++) { const m = dv.getUint16(p + 10, true), cs = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
    const name = td.decode(u.subarray(p + 46, p + 46 + nl)); p += 46 + nl + el + cl;
    if (!/^xl\/(sharedStrings|worksheets\/sheet\d+)\.xml$/.test(name)) continue;
    const ds = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true), raw = u.subarray(ds, ds + cs); out[name] = td.decode(m === 0 ? raw : await inflate(raw)); } return out; }
function xrows(f) { const dp = new DOMParser(), ss = [];
  if (f['xl/sharedStrings.xml']) [...dp.parseFromString(f['xl/sharedStrings.xml'], 'text/xml').getElementsByTagName('si')].forEach(si => ss.push([...si.getElementsByTagName('t')].map(x => x.textContent).join('')));
  const k = Object.keys(f).filter(x => x.includes('worksheets')).sort((a, b) => a.length - b.length || a.localeCompare(b))[0]; if (!k) throw Error('No worksheet found.');
  const col = r => { let n = 0; for (const ch of r.replace(/\d/g, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
  return [...dp.parseFromString(f[k], 'text/xml').getElementsByTagName('row')].map(r => { const a = [];
    for (const c of r.getElementsByTagName('c')) { const t = c.getAttribute('t'), ve = c.getElementsByTagName('v')[0]; let v = '';
      if (t === 's') v = ss[+ve.textContent]; else if (t === 'inlineStr') v = [...c.getElementsByTagName('t')].map(x => x.textContent).join(''); else if (ve) v = ve.textContent; a[col(c.getAttribute('r'))] = v; }
    return Array.from(a, x => x == null ? '' : x); }); }
function toQs(rows) { const qs = [], er = [];
  rows.forEach((r, i) => { r = Array.from({ length: 6 }, (_, j) => String(r[j] == null ? '' : r[j]).trim()); if (r.every(x => !x)) return; if (i === 0 && /question/i.test(r[0])) return;
    const [q, a, b, c, d, k] = r, n = i + 1; if (!q || !a || !b || !c || !d) { er.push('Row ' + n + ': the question or one of the 4 options is empty.'); return; }
    let x = 'ABCD'.indexOf(k.toUpperCase()); if (k.length !== 1) x = -1; if (x < 0 && /^[1-4]$/.test(k)) x = +k - 1;
    if (x < 0) { er.push('Row ' + n + ': Correct Answer must be A, B, C or D (found "' + k + '").'); return; }
    qs.push({ q, o: [a, b, c, d], a: x }); });
  if (!qs.length && !er.length) er.push('No questions found in the file.'); return { qs, er }; }
async function checkFile() {
  pending = null; $('qsave').disabled = true; const f = $('qfile').files[0]; if (!f) return msg($('qmsg'), 'Please choose a file first.', 'e');
  try {
    const rows = /\.xlsx$/i.test(f.name) ? xrows(await unzip(await f.arrayBuffer())) : csv(await f.text()); const { qs, er } = toQs(rows);
    if (er.length) { $('qmsg').className = 'msg e'; $('qmsg').innerHTML = '<b>Please fix these errors and check again:</b><br>' + er.slice(0, 15).map(esc).join('<br>') + (er.length > 15 ? '<br>...and ' + (er.length - 15) + ' more' : ''); return; }
    pending = qs; $('qsave').disabled = false; msg($('qmsg'), 'File is correct. ' + qs.length + ' questions found. Press Save Questions to apply.', 'g');
  } catch (e) { msg($('qmsg'), 'Could not read the file: ' + e.message + '. Save it again as .xlsx or .csv using the template.', 'e'); }
}
async function saveQs() {
  if (!pending) return;
  try { const r = await api('/api/admin/questions', { course: $('qcourse').value, questions: pending }); msg($('qmsg'), 'Saved. ' + r.count + ' questions are now active for this course.', 'g'); pending = null; $('qsave').disabled = true; loadQs(); }
  catch (e) { msg($('qmsg'), e.message, 'e'); }
}

/* =============== SETTINGS =============== */
function viewSet() {
  const s = SET;
  $('pane').innerHTML = `
  <div class="box"><h3>Test Settings</h3>
   <div class="row2">
    <div><label class="lbl">Test duration (minutes)</label><input class="in" type="number" id="s_dur" min="1" max="300" value="${s.duration_min}"></div>
    <div><label class="lbl">End Paper unlocks after (minutes)</label><input class="in" type="number" id="s_unl" min="0" max="300" value="${s.unlock_min}"></div>
    <div><label class="lbl">Passing percentage</label><input class="in" type="number" id="s_pass" min="1" max="100" value="${s.pass_pct}"></div>
    <div><label class="lbl">Default entry window (minutes)</label><input class="in" type="number" id="s_ent" min="1" max="240" value="${s.entry_window_min}"></div>
    <div><label class="lbl">Auto-end test after N warnings (0 = only record)</label><input class="in" type="number" id="s_vio" min="0" max="50" value="${s.max_violations}"></div>
    <div><label class="lbl">Show result to student after test</label><select class="in" id="s_show"><option value="1" ${s.show_result ? 'selected' : ''}>Yes (score report)</option><option value="0" ${!s.show_result ? 'selected' : ''}>No (admin only)</option></select></div>
   </div>
   <label class="lbl">Centre name (printed on reports)</label><input class="in" id="s_center" value="${esc(s.center)}">
   <p class="fine">A time change applies to students who start after you save. Students already running keep the time they started with.</p>
   <div class="arow"><button class="btn" id="s_save">Save Settings</button></div><div id="s_msg" class="msg"></div>
  </div>
  <div class="box"><h3>Change Admin Password</h3>
   <div class="row2"><div><label class="lbl">Current password</label><input class="in" type="password" id="p_cur"></div><div><label class="lbl">New password (min 8 characters)</label><input class="in" type="password" id="p_new"></div></div>
   <div class="arow"><button class="btn" id="p_save">Change Password</button></div><div id="p_msg" class="msg"></div>
  </div>`;
  $('s_save').onclick = async () => {
    try {
      SET = await api('/api/admin/settings', { duration_min: $('s_dur').value, unlock_min: $('s_unl').value, pass_pct: $('s_pass').value, entry_window_min: $('s_ent').value, max_violations: $('s_vio').value, show_result: $('s_show').value === '1', center: $('s_center').value });
      msg($('s_msg'), 'Settings saved.', 'g'); viewSet(); $('s_msg').textContent = 'Settings saved.'; $('s_msg').className = 'msg g';
    } catch (e) { msg($('s_msg'), e.message, 'e'); }
  };
  $('p_save').onclick = async () => {
    try { await api('/api/admin/password', { current: $('p_cur').value, next: $('p_new').value }); msg($('p_msg'), 'Password changed.', 'g'); $('p_cur').value = ''; $('p_new').value = ''; }
    catch (e) { msg($('p_msg'), e.message, 'e'); }
  };
}

init();
})();
