// The dashboard page. One file, no build step, no external scripts.
export const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Chief of Staff</title>
<style>
  :root { --bg:#0b0b0f; --panel:#15151d; --line:#272733; --txt:#e8e8f0; --dim:#8b8ba3;
          --t3:#e5484d; --t2:#f5a524; --t1:#3fb950; --link:#7cc4ff; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--txt);
         font:14px/1.5 ui-sans-serif,system-ui,-apple-system,sans-serif; }
  header { padding:16px; border-bottom:1px solid var(--line); display:flex;
           justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; }
  h1 { font-size:18px; margin:0; }
  .meta { color:var(--dim); font-size:12px; }
  main { padding:16px; max-width:1100px; margin:0 auto; }
  .cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(120px,1fr)); gap:10px; margin-bottom:12px; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:12px; }
  .card .n { font-size:26px; font-weight:600; }
  .card .l { color:var(--dim); font-size:11px; text-transform:uppercase; letter-spacing:.06em; }
  .t3 .n { color:var(--t3); } .t2 .n { color:var(--t2); } .t1 .n { color:var(--t1); }
  section { margin:22px 0; }
  h2 { font-size:13px; text-transform:uppercase; letter-spacing:.06em; color:var(--dim); margin:0 0 8px; }
  .wrap { overflow-x:auto; border:1px solid var(--line); border-radius:10px; }
  table { width:100%; border-collapse:collapse; background:var(--panel); }
  th { text-align:left; font-size:11px; text-transform:uppercase; color:var(--dim);
       padding:8px 10px; border-bottom:1px solid var(--line); white-space:nowrap; }
  td { padding:8px 10px; border-bottom:1px solid var(--line); vertical-align:top; }
  tr:last-child td { border-bottom:none; }
  .pill { display:inline-block; padding:1px 7px; border-radius:20px; font-size:11px; font-weight:600; white-space:nowrap; }
  .p3 { background:rgba(229,72,77,.15); color:var(--t3); }
  .p2 { background:rgba(245,165,36,.15); color:var(--t2); }
  .p1 { background:rgba(63,185,80,.15); color:var(--t1); }
  .over { color:var(--t3); font-weight:600; }
  .empty { color:var(--dim); padding:14px; background:var(--panel); border:1px solid var(--line);
           border-radius:10px; font-style:italic; }
  .ok { color:var(--t1); } .bad { color:var(--t3); } .warn { color:var(--t2); }
  code { font:12px ui-monospace,monospace; color:var(--dim); }
  a { color:var(--link); }
  button { font:inherit; border-radius:8px; border:1px solid var(--line); background:#1e1e29;
           color:var(--txt); padding:5px 12px; cursor:pointer; }
  button.approve { border-color:rgba(63,185,80,.5); color:var(--t1); }
  button.reject { border-color:rgba(229,72,77,.5); color:var(--t3); }
  button:disabled { opacity:.5; cursor:default; }
  .btns { display:flex; gap:6px; flex-wrap:wrap; }
  .tabs { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:8px; }
  .tabs button.on { background:#2a2a3a; border-color:var(--dim); }
  details { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:10px 12px; }
  details h2 { margin-top:14px; }
  /* Phones: stack rows as cards so actions are never scrolled off-screen. */
  @media (max-width: 640px) {
    #t3 thead, #open thead, #sources thead { display:none; }
    #t3 tr, #open tr, #sources tr { display:block; border-bottom:1px solid var(--line); padding:6px 0; }
    #t3 tr:last-child, #open tr:last-child, #sources tr:last-child { border-bottom:none; }
    #t3 td, #open td, #sources td { display:block; border:none; padding:2px 12px; }
    #t3 .btns { margin-top:6px; }
    #t3 button { padding:8px 18px; }
  }
  #toast { position:fixed; bottom:16px; left:50%; transform:translateX(-50%); background:#2a2a3a;
           padding:8px 14px; border-radius:8px; display:none; max-width:90vw; }
</style>
</head>
<body>
<header>
  <h1>Chief of Staff</h1>
  <div class="btns"><span class="meta" id="meta">loading…</span><button id="sync">Sync now</button></div>
</header>
<main>
  <div class="cards" id="cards"></div>
  <div class="cards" id="orgcards"></div>

  <section><h2>Needs your decision</h2><div id="t3"></div></section>
  <section><h2>Open work</h2><div class="tabs" id="tabs"></div><div id="open"></div></section>
  <section><h2>Today's sources</h2><div id="sources"></div></section>
  <section><h2>Last 14 days</h2><div id="history"></div></section>
  <section><details><summary>System (ledger, roles, policy)</summary><div id="system"></div></details></section>
</main>
<div id="toast"></div>
<script>
const ORGS = { proofstream: 'ProofStream', earnheart: 'Earnheart', pantheon: 'Pantheon', other: 'Other' };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const empty = m => '<div class="empty">' + m + '</div>';
const table = (cols, rows, render) => !rows.length ? null :
  '<div class="wrap"><table><thead><tr>' + cols.map(c => '<th>' + c + '</th>').join('') +
  '</tr></thead><tbody>' + rows.map(render).join('') + '</tbody></table></div>';
const link = (u, t) => u && /^https:\\/\\//.test(u)
  ? '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(t) + '</a>' : esc(t);
const due = q => q.overdue ? '<span class="over">OVERDUE</span>' : (q.hoursLeft ?? '—') + 'h';
const tierPill = t => '<span class="pill p' + t + '">T' + t + '</span>';
let data = null, orgFilter = 'all';

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.style.display = 'block';
  clearTimeout(toast.h); toast.h = setTimeout(() => t.style.display = 'none', 4000);
}

async function post(path, body) {
  const r = await fetch(path, { method: 'POST', credentials: 'same-origin',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
  return j;
}

async function decide(btn, id, decision) {
  let note = null;
  if (decision === 'reject') {
    note = prompt('Reason for rejecting (optional):');
    if (note === null) return;
  } else if (!confirm('Approve this item?')) return;
  btn.parentElement.querySelectorAll('button').forEach(b => b.disabled = true);
  try {
    await post('/api/decide', { item_id: id, decision, note: note || null });
    toast(decision === 'approve' ? 'Approved' : 'Rejected');
    load();
  } catch (e) {
    toast('Failed: ' + e.message);
    btn.parentElement.querySelectorAll('button').forEach(b => b.disabled = false);
  }
}

function renderOpen() {
  const rows = data.items.filter(q => q.tier < 3 && (orgFilter === 'all' || q.org === orgFilter));
  document.getElementById('tabs').innerHTML = ['all', 'proofstream', 'earnheart', 'pantheon', 'other']
    .map(o => '<button data-org="' + o + '" class="' + (o === orgFilter ? 'on' : '') + '">' +
      (o === 'all' ? 'All' : ORGS[o]) + '</button>').join('');
  document.getElementById('open').innerHTML =
    table(['', 'Task', 'Org', 'Source', 'Due'], rows, q =>
      '<tr><td>' + tierPill(q.tier) + '</td><td>' + esc(q.task) + '</td><td>' + esc(ORGS[q.org]) +
      '</td><td>' + link(q.ref_url, q.source || q.domain) + '</td><td>' + due(q) + '</td></tr>')
    || empty('Nothing open here.');
}

function renderSources(s) {
  if (!s) return empty('No sync has run yet. Press "Sync now".');
  const st = x => x.ok ? '<span class="ok">ok</span>'
    : x.skipped ? '<span class="warn">not set up</span>' : '<span class="bad">failed</span>';
  const rows = [];
  for (const h of (s.health?.results || [])) {
    const cls = h.verdict === 'pass' ? 'ok' : h.verdict === 'warn' ? 'warn' : 'bad';
    rows.push(['Site', ORGS[h.org], link(h.url, new URL(h.url).host),
      '<span class="' + cls + '">' + esc(h.verdict) + '</span> ' +
      esc((h.status ?? '—') + ' · ' + h.ms + 'ms' + (h.note ? ' · ' + h.note : ''))]);
  }
  if (s.health && !s.health.ok) rows.push(['Sites', '—', '', st(s.health) + ' ' + esc(s.health.reason)]);
  const b = s.brief || {};
  rows.push(['Morning Brief', 'All', b.page_url ? link(b.page_url, 'today\\'s page') : '',
    st(b) + ' ' + esc(b.ok ? (b.items + ' items · ' + b.opened + ' new · ' + b.resolved +
      ' closed · ' + (b.meetings ?? 0) + ' meetings · ' + (b.needs_reply ?? 0) + ' need reply')
      : b.reason)]);
  const j = s.jira || {};
  rows.push(['Jira', 'All', '', st(j) + ' ' + esc(j.ok ? (j.items + ' open · ' + j.opened + ' new · ' +
    j.resolved + ' closed') : j.reason)]);
  const errs = [...(s.health?.errors || []), ...(b.errors || []), ...(j.errors || [])];
  if (errs.length) rows.push(['Errors', '', '', '<span class="bad">' + errs.length + '</span> <code>' +
    esc(errs.slice(0, 3).map(e => e.item_id + ': ' + e.error).join(' | ')) + '</code>']);
  return '<div class="meta" style="margin-bottom:6px">Last sync ' +
    esc(new Date(s.ts).toLocaleString('en-US', { timeZone: data.tz })) + ' (' + esc(s.trigger) + ')</div>' +
    table(['Source', 'Org', 'Link', 'Result'], rows, r => '<tr>' + r.map(c => '<td>' + c + '</td>').join('') + '</tr>');
}

async function load() {
  const r = await fetch('/api/summary', { credentials: 'same-origin' });
  if (!r.ok) { document.getElementById('meta').textContent = 'auth failed'; return; }
  data = await r.json();
  const v = await (await fetch('/api/verify', { credentials: 'same-origin' })).json();
  document.getElementById('meta').innerHTML =
    esc(new Date(data.generated_at).toLocaleString('en-US', { timeZone: data.tz })) + ' · chain ' +
    (v.ok ? '<span class="ok">verified</span>' : '<span class="bad">BROKEN at seq ' + esc(v.broken_at_seq) + '</span>');

  const c = data.counts;
  document.getElementById('cards').innerHTML = [
    ['t3', c.tier3, 'Your decision'], ['t2', c.tier2, 'Attention'],
    ['t1', c.tier1, 'Routine'], ['', c.overdue, 'Overdue'],
  ].map(([k, n, l]) => '<div class="card ' + k + '"><div class="n">' + n + '</div><div class="l">' + l + '</div></div>').join('');
  const byOrg = {};
  for (const q of data.items) byOrg[q.org] = (byOrg[q.org] || 0) + 1;
  document.getElementById('orgcards').innerHTML = ['proofstream', 'earnheart', 'pantheon'].map(o =>
    '<div class="card"><div class="n">' + (byOrg[o] || 0) + '</div><div class="l">' + ORGS[o] + ' open</div></div>').join('');

  const t3 = data.items.filter(q => q.tier === 3);
  document.getElementById('t3').innerHTML =
    table(['Task', 'Org', 'Source', 'Due', ''], t3, q =>
      '<tr><td>' + esc(q.task) + '<br><code>' + esc(q.tier_reason) + '</code>' +
      (q.quarantined ? '<br><span class="bad">quarantined: reject only</span>' : '') + '</td>' +
      '<td>' + esc(ORGS[q.org]) + '</td><td>' + link(q.ref_url, q.source || q.domain) + '</td>' +
      '<td>' + due(q) + '</td><td><div class="btns">' +
      (q.quarantined ? '' : '<button class="approve" data-id="' + esc(q.item_id) + '" data-d="approve">Approve</button>') +
      '<button class="reject" data-id="' + esc(q.item_id) + '" data-d="reject">Reject</button></div></td></tr>')
    || empty('Nothing waiting on you.');

  renderOpen();
  document.getElementById('sources').innerHTML = renderSources(data.latest_sync);

  document.getElementById('history').innerHTML =
    table(['Date', 'Open', 'ProofStream', 'Earnheart', 'Pantheon', 'Sites up', 'Brief items'], data.history, h => {
      const res = h.health?.results || [];
      const up = res.filter(x => x.verdict === 'pass').length;
      const o = h.counts?.by_org || {};
      return '<tr><td>' + esc(h.date) + '</td><td>' + esc(h.counts?.open_total ?? '—') + '</td><td>' +
        esc(o.proofstream ?? 0) + '</td><td>' + esc(o.earnheart ?? 0) + '</td><td>' + esc(o.pantheon ?? 0) +
        '</td><td class="' + (up === res.length ? 'ok' : 'bad') + '">' + up + '/' + res.length + '</td><td>' +
        (h.brief?.ok ? esc(h.brief.items) : '<span class="meta">' + esc(h.brief?.skipped ? 'not set up' : 'none') + '</span>') +
        '</td></tr>';
    }) || empty('History starts after the first sync.');

  const s = data.system;
  document.getElementById('system').innerHTML =
    '<h2>Recent ledger (' + s.ledger_total + ' rows)</h2>' +
    (table(['Seq', 'Time', 'Event', 'Subject', 'Actor'], s.ledger, l =>
      '<tr><td>' + esc(l.seq) + '</td><td>' + esc(l.ts) + '</td><td>' + esc(l.event_type) + '</td><td><code>' +
      esc(l.subject_id) + '</code></td><td>' + esc(l.actor_identity) + '</td></tr>') || empty('Empty.')) +
    '<h2>Quarantine</h2>' + (table(['Subject', 'Reason', 'Since'], s.quarantine, x =>
      '<tr><td><code>' + esc(x.subject_id) + '</code></td><td>' + esc(x.reason) + '</td><td>' + esc(x.entered_at) +
      '</td></tr>') || empty('Nothing quarantined.')) +
    '<h2>Roles</h2>' + (table(['Role', 'Holder', 'Alternate'], s.roles, x =>
      '<tr><td>' + esc(x.role_id) + '</td><td>' + esc(x.holder_identity) + '</td><td>' +
      esc(x.alternate_identity || '—') + '</td></tr>') || empty('No roles.')) +
    '<h2>Locked policy</h2>' + (table(['Key', 'Version'], s.locked, k =>
      '<tr><td><code>' + esc(k.key) + '</code></td><td>v' + esc(k.version) + '</td></tr>') || empty('None.'));
}

document.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.d) decide(b, b.dataset.id, b.dataset.d);
  else if (b.dataset.org) { orgFilter = b.dataset.org; renderOpen(); }
  else if (b.id === 'sync') {
    b.disabled = true; toast('Syncing…');
    post('/api/sync').then(() => { toast('Sync done'); load(); })
      .catch(err => toast('Sync failed: ' + err.message)).finally(() => b.disabled = false);
  }
});
load();
setInterval(load, 60000);
<\/script>
</body>
</html>`;
