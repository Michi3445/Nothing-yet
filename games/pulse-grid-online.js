/* Pulse Grid · online versus over Firebase Realtime Database.
   Loaded after the game script; talks to it through the globals it defines
   (G, M, S, LIB, sel, startGame, toMenu, renderTrack, ...). Firebase itself is
   only downloaded when someone opens the online screen. */
(() => {
  'use strict';
  const SDK = 'https://www.gstatic.com/firebasejs/10.14.1/';
  const CODE_CH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const MAXP = 8, LEAD = 5, START_DELAY = 4000;
  const MOD_KEYS = ['nofail', 'ghost', 'mirrorx', 'mirrory', 'hardrock', 'chaos', 'speed'];
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const N = { fb: null, db: null, uid: null, offset: 0, code: null, ref: null, room: null, host: false,
    round: 0, inMatch: false, choosing: false, modsBackup: null, prepKey: null, liveTimer: 0, lastLive: '', startTimer: 0, cdTimer: 0 };
  const serverNow = () => Date.now() + N.offset;

  /* ---------- UI ---------- */
  const css = document.createElement('style');
  css.textContent = `
#onlineBtn{font-family:var(--f-display);font-weight:800;font-style:italic;font-size:22px;letter-spacing:.03em;padding:8px 22px;background:transparent;color:var(--cyan);border:1.5px solid var(--cyan);border-radius:10px;cursor:pointer;box-shadow:0 0 18px rgba(61,225,255,.25)}
#onlineBtn:hover{background:rgba(61,225,255,.1)}
.playin .pbtns{display:flex;gap:10px;align-items:center}
@media (max-width:640px){.playin .pbtns{flex:1 1 100%}.playin .pbtns #play{flex:1}}
#net{z-index:8}
#net .card{width:min(520px,100%)}
#net label{font:600 11px var(--f-mono);letter-spacing:.14em;text-transform:uppercase;color:var(--dim)}
#net input[type=text]{font:600 16px var(--f-mono);background:var(--raise);color:var(--fg);border:1px solid var(--line);border-radius:9px;padding:10px 12px;width:100%;box-sizing:border-box}
#net .code-in{text-transform:uppercase;letter-spacing:.4em;text-align:center;font-size:22px}
#net .or{display:flex;align-items:center;gap:10px;color:var(--faint);font:600 11px var(--f-mono);letter-spacing:.2em}
#net .or::before,#net .or::after{content:"";flex:1;height:1px;background:var(--line)}
#net .roomcode{font:800 44px var(--f-mono);letter-spacing:.25em;color:var(--cyan);text-shadow:0 0 18px rgba(61,225,255,.5);line-height:1}
#net .meta{font:500 12px var(--f-mono);color:var(--dim)}
#net .trk{border:1px solid var(--line);border-radius:11px;padding:10px 12px;display:flex;flex-direction:column;gap:3px}
#net .trk b{font-family:var(--f-display);font-weight:800;font-size:22px;line-height:1.1}
.plist{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none}
.plist li{display:flex;justify-content:space-between;gap:10px;border:1px solid var(--line);border-radius:9px;padding:8px 10px;font:600 13px var(--f-mono)}
.plist li.me{border-color:var(--pink)}
.plist .st{color:var(--dim);font-weight:500}
.plist .st.ok{color:var(--ok)}
#net .cd{font:italic 800 34px var(--f-display);color:var(--gold);text-align:center;min-height:1em}
#netHud{position:fixed;left:16px;top:calc(env(safe-area-inset-top,0px) + 74px);z-index:4;display:flex;flex-direction:column;gap:5px;pointer-events:none;font:600 12px var(--f-mono);min-width:170px}
#netHud .r{background:rgba(10,8,22,.62);border:1px solid var(--line);border-radius:8px;padding:5px 8px;display:grid;grid-template-columns:auto 1fr auto;gap:2px 8px;align-items:center}
#netHud .r.me{border-color:rgba(255,61,127,.7)}
#netHud .r .n{max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#netHud .r .s{text-align:right;font-variant-numeric:tabular-nums}
#netHud .r .hp{grid-column:1/-1;height:3px;background:rgba(255,255,255,.1);border-radius:2px;overflow:hidden}
#netHud .r .hp i{display:block;height:100%;background:var(--ok)}
#netHud .r.out{opacity:.55}
#netRes{display:flex;flex-direction:column;gap:6px}
#netRes h4{margin:0;font:600 12px var(--f-mono);letter-spacing:.16em;text-transform:uppercase;color:var(--dim)}
`;
  document.head.appendChild(css);

  const playBtn = document.getElementById('play');
  const pbtns = document.createElement('div'); pbtns.className = 'pbtns';
  playBtn.parentNode.insertBefore(pbtns, playBtn);
  const onlineBtn = document.createElement('button');
  onlineBtn.id = 'onlineBtn'; onlineBtn.type = 'button'; onlineBtn.textContent = 'ONLINE';
  pbtns.append(onlineBtn, playBtn);

  const screen = document.createElement('div');
  screen.id = 'net'; screen.className = 'screen center'; screen.hidden = true;
  screen.innerHTML = `<div class="card" role="dialog" aria-labelledby="netTitle">
  <div id="netJoin" style="display:flex;flex-direction:column;gap:12px">
    <h3 id="netTitle">Online</h3>
    <span class="meta">Play the same track against friends. Everyone starts together and sees the others' score live.</span>
    <label for="netName">Your name</label>
    <input type="text" id="netName" maxlength="16" autocomplete="nickname" spellcheck="false">
    <button class="btn primary" id="netCreate" type="button">Create room</button>
    <div class="or">OR JOIN</div>
    <input type="text" id="netCode" class="code-in" maxlength="4" placeholder="CODE" autocomplete="off" spellcheck="false" aria-label="Room code">
    <button class="btn" id="netJoinBtn" type="button">Join room</button>
    <span class="meta" id="netMsg" role="status"></span>
    <div class="btns"><button class="btn" id="netBack" type="button">Back</button></div>
  </div>
  <div id="netLobby" hidden style="display:flex;flex-direction:column;gap:12px">
    <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:10px;flex-wrap:wrap">
      <div><label>Room code</label><div class="roomcode" id="netRoomCode">----</div></div>
      <button class="btn" id="netCopy" type="button" style="padding:6px 12px;font-size:12px">Copy invite link</button>
    </div>
    <div class="trk"><label>Track</label><b id="netTrk">—</b><span class="meta" id="netTrkMeta"></span></div>
    <label>Players</label>
    <ul class="plist" id="netPlayers"></ul>
    <div class="cd" id="netCd" aria-live="polite"></div>
    <span class="meta" id="netHint"></span>
    <div class="btns">
      <button class="btn" id="netTrack" type="button">Change track</button>
      <button class="btn primary" id="netStart" type="button">START</button>
    </div>
    <div class="btns"><button class="btn" id="netLeave" type="button">Leave room</button></div>
  </div>
</div>`;
  document.body.appendChild(screen);
  const hud = document.createElement('div'); hud.id = 'netHud'; hud.hidden = true; hud.setAttribute('aria-hidden', 'true');
  document.body.appendChild(hud);
  const resBox = document.createElement('div'); resBox.id = 'netRes'; resBox.hidden = true;
  const resCard = document.querySelector('#results .card');
  resCard.insertBefore(resBox, resCard.querySelector('.btns'));

  const el = id => document.getElementById(id);
  el('netName').value = store.get('pg.netName', '') || ('Player' + Math.floor(100 + Math.random() * 900));
  const msg = t => { el('netMsg').textContent = t || ''; };
  const myName = () => (el('netName').value.trim().replace(/\s+/g, ' ').slice(0, 16) || 'Player');

  function showJoin() { hideAll(); screen.hidden = false; el('netJoin').hidden = false; el('netLobby').hidden = true; msg(''); }
  function showLobby() { hideAll(); screen.hidden = false; el('netJoin').hidden = true; el('netLobby').hidden = false; renderLobby(); }

  /* ---------- Firebase ---------- */
  function loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src)); document.head.appendChild(s); });
  }
  let fbReady = null;
  function initFirebase() {
    if (fbReady) return fbReady;
    fbReady = (async () => {
      if (!window.FIREBASE_CONFIG) await loadScript('../firebase-config.js');
      if (!window.firebase) { await loadScript(SDK + 'firebase-app-compat.js'); }
      await loadScript(SDK + 'firebase-auth-compat.js');
      await loadScript(SDK + 'firebase-database-compat.js');
      const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(window.FIREBASE_CONFIG);
      const auth = app.auth(), db = app.database();
      if (/[?&]emu\b/.test(location.search)) { auth.useEmulator('http://127.0.0.1:9099', { disableWarnings: true }); db.useEmulator('127.0.0.1', 9000); }
      const cred = await auth.signInAnonymously();
      N.uid = cred.user.uid; N.db = db;
      db.ref('.info/serverTimeOffset').on('value', s => { N.offset = s.val() || 0; });
      return db;
    })();
    fbReady.catch(() => { fbReady = null; });
    return fbReady;
  }
  function errText(e) {
    const m = (e && (e.code || e.message)) || String(e);
    if (/admin-restricted|operation-not-allowed/.test(m)) return 'Anonymous sign-in is turned off in Firebase.';
    if (/unauthorized-domain/.test(m)) return 'This website is not an authorized domain in Firebase.';
    if (/permission/i.test(m)) return 'The database refused access (check the rules).';
    if (/Could not load|network/i.test(m)) return 'No connection to Firebase.';
    return m;
  }

  /* ---------- rooms ---------- */
  function currentSongForRoom() {
    let e = curEntry();
    if (e.kind !== 'builtin') e = LIB.find(x => x.kind === 'builtin');
    const di = Math.min(sel.di, e.diffs.length - 1);
    const mods = {}; for (const k of MOD_KEYS) mods[k] = k === 'speed' ? +M.speed : !!M[k];
    return { song: e.id, di, mods };
  }
  function playerNode() { return { name: myName(), joined: firebase.database.ServerValue.TIMESTAMP, where: 'lobby', ready: '' }; }

  async function createRoom() {
    msg('Connecting…');
    try {
      const db = await initFirebase();
      store.set('pg.netName', myName());
      for (let tries = 0; tries < 8; tries++) {
        let code = ''; for (let i = 0; i < 4; i++) code += CODE_CH[Math.floor(Math.random() * CODE_CH.length)];
        const ref = db.ref('pg/rooms/' + code);
        const room = Object.assign({ host: N.uid, created: Date.now() + N.offset, state: 'lobby', round: 0, players: { [N.uid]: playerNode() } }, currentSongForRoom());
        const r = await ref.transaction(cur => cur === null ? room : undefined, undefined, false);
        if (r.committed) { await enterRoom(code, true); return; }
      }
      msg('Could not find a free room code, try again.');
    } catch (e) { console.error(e); msg(errText(e)); }
  }
  async function joinRoom(code) {
    code = (code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 4) { msg('Room codes have 4 characters.'); return; }
    msg('Connecting…');
    try {
      const db = await initFirebase();
      store.set('pg.netName', myName());
      const snap = await db.ref('pg/rooms/' + code).get();
      const room = snap.val();
      if (!room) { msg('There is no room ' + code + '.'); return; }
      const n = Object.keys(room.players || {}).length;
      if (n >= MAXP && !(room.players || {})[N.uid]) { msg('That room is full.'); return; }
      await db.ref('pg/rooms/' + code + '/players/' + N.uid).set(playerNode());
      await enterRoom(code, room.host === N.uid);
    } catch (e) { console.error(e); msg(errText(e)); }
  }
  async function enterRoom(code, host) {
    N.code = code; N.host = host; N.ref = N.db.ref('pg/rooms/' + code); N.round = 0; N.prepKey = null; N.room = null;
    N.modsBackup = Object.assign({}, M);
    const me = N.ref.child('players/' + N.uid);
    if (host) N.ref.onDisconnect().remove(); else me.onDisconnect().remove();
    let first = true;
    N.ref.on('value', s => {
      const room = s.val();
      if (!room || !room.players || !room.players[N.uid]) {
        if (N.code === code) leave(first ? '' : room ? 'You are no longer in the room.' : 'The host closed the room.');
        return;
      }
      if (first) { N.round = room.round || 0; first = false; }
      N.room = room;
      onRoom(room);
    }, e => { console.error(e); leave(errText(e)); });
    try { history.replaceState(null, '', location.pathname + '?room=' + code); } catch (e) { }
    showLobby();
  }
  function leave(why) {
    const ref = N.ref, code = N.code, wasHost = N.host;
    N.code = null;
    clearTimeout(N.startTimer); clearInterval(N.cdTimer); clearInterval(N.liveTimer); N.liveTimer = 0;
    if (ref) {
      ref.off();
      if (wasHost) { ref.remove().catch(() => { }); ref.onDisconnect().cancel(); }
      else { ref.child('players/' + N.uid).remove().catch(() => { }); ref.child('players/' + N.uid).onDisconnect().cancel(); }
    }
    N.ref = null; N.room = null; N.host = false; N.choosing = false;
    const wasMatch = N.inMatch; N.inMatch = false;
    if (N.modsBackup) { for (const k of Object.keys(N.modsBackup)) M[k] = N.modsBackup[k]; N.modsBackup = null; renderMods(); }
    playBtn.textContent = 'PLAY';
    hud.hidden = true; resBox.hidden = true; setResultButtons(false);
    try { history.replaceState(null, '', location.pathname); } catch (e) { }
    if (code !== null) {
      if (wasMatch && ['playing', 'paused', 'countdown', 'failing'].includes(G.state)) { /* let the run finish offline */ }
      else { screen.hidden = true; toMenu(); }
      if (why) toast(why);
    }
  }

  /* ---------- lobby ---------- */
  const keyOf = room => room.song + '|' + room.di;
  function entryOf(room) { return LIB.find(e => e.id === room.song && e.kind === 'builtin'); }
  function onRoom(room) {
    // get the track ready (rendered) so everyone can start at the same moment
    const key = keyOf(room);
    if (N.prepKey !== key) { N.prepKey = key; prepare(room, key); }
    // new round started by the host
    if ((room.round || 0) > N.round && room.state === 'playing' && room.startAt) {
      N.round = room.round;
      const me = room.players[N.uid];
      if (me.ready === key) scheduleStart(room);
      else toast('Your track was not ready yet, you sit this round out.');
    }
    if (!screen.hidden) renderLobby();
    if (!resBox.hidden) renderResults();
    if (!hud.hidden) renderHud();
  }
  async function prepare(room, key) {
    const e = entryOf(room);
    const me = N.ref.child('players/' + N.uid);
    if (!e) { me.update({ ready: '' }); return; }
    if (!e.buffer) {
      me.update({ ready: '' });
      try { ensureAudio(); e.buffer = await renderTrack(e.track, () => { }); }
      catch (err) { console.error(err); toast('Could not render the track: ' + err.message); return; }
    }
    if (N.prepKey === key && N.ref) me.update({ ready: key });
  }
  function modText(m) {
    if (!m) return 'No mods';
    const l = []; if (m.speed && m.speed !== 1) l.push((+m.speed).toFixed(2) + '×');
    for (const d of MODS) if (m[d.k] && d.k !== 'auto') l.push(d.label);
    return l.join(' · ') || 'No mods';
  }
  function playerList(room) {
    return Object.entries(room.players || {}).map(([uid, p]) => Object.assign({ uid }, p)).sort((a, b) => (a.joined || 0) - (b.joined || 0));
  }
  function renderLobby() {
    const room = N.room; if (!room) return;
    el('netRoomCode').textContent = N.code;
    const e = entryOf(room);
    el('netTrk').textContent = e ? e.title : 'Unknown track';
    el('netTrkMeta').textContent = e ? `${e.artist} · ${e.diffs[room.di].name} · ${modText(room.mods)}` : '';
    const key = keyOf(room), ps = playerList(room);
    el('netPlayers').innerHTML = ps.map(p => {
      const st = p.where === 'playing' ? 'playing' : p.where === 'results' ? 'on results' : p.ready === key ? 'ready' : 'loading track…';
      return `<li class="${p.uid === N.uid ? 'me' : ''}"><span>${p.uid === room.host ? '★ ' : ''}${esc(p.name)}${p.uid === N.uid ? ' (you)' : ''}</span><span class="st ${st === 'ready' ? 'ok' : ''}">${st}</span></li>`;
    }).join('');
    const allReady = ps.every(p => p.ready === key && p.where !== 'playing');
    const counting = room.state === 'playing' && room.startAt && serverNow() < room.startAt;
    el('netTrack').hidden = !N.host; el('netStart').hidden = !N.host;
    el('netStart').disabled = !allReady || counting;
    el('netTrack').disabled = counting;
    el('netHint').textContent = counting ? '' : N.host
      ? (ps.length < 2 ? 'Share the code. You can also start alone.' : allReady ? 'Everyone is ready.' : 'Waiting until everyone has the track ready…')
      : room.state === 'playing' ? 'A round is running. You join the next one.' : 'Waiting for the host to start…';
  }

  /* ---------- match ---------- */
  function scheduleStart(room) {
    clearTimeout(N.startTimer); clearInterval(N.cdTimer);
    const at = room.startAt;
    const tick = () => { const left = Math.ceil((at - serverNow()) / 1000); el('netCd').textContent = left > 0 ? 'Starting in ' + left + '…' : ''; };
    tick(); N.cdTimer = setInterval(tick, 200);
    if (!screen.hidden) renderLobby(); else if (G.state === 'results' || G.state === 'menu') showLobby();
    N.startTimer = setTimeout(() => { clearInterval(N.cdTimer); el('netCd').textContent = ''; begin(room); }, Math.max(0, at - serverNow()));
  }
  function begin(room) {
    if (!N.code) return;
    const e = entryOf(room); if (!e || !e.buffer) return;
    const di = Math.min(room.di, e.diffs.length - 1);
    for (const k of MOD_KEYS) M[k] = room.mods && room.mods[k] !== undefined ? room.mods[k] : (k === 'speed' ? 1 : false);
    M.auto = false;
    const notes = e.diffs[di].notes, firstT = notes.length ? notes[0].t : 0;
    const speed = M.speed || 1;
    const late = Math.max(0, (serverNow() - room.startAt) / 1000);
    const startT = Math.min(0, firstT - LEAD * speed) + late * speed;
    screen.hidden = true; resBox.hidden = true;
    N.inMatch = true; N.lastLive = '';
    setResultButtons(true);
    ensureAudio();
    N.ref.child('players/' + N.uid).update({ where: 'playing', live: null, res: null });
    startGame(e, di, { startT });
    hud.hidden = false; renderHud();
    clearInterval(N.liveTimer); N.liveTimer = setInterval(sendLive, 250);
    if (!isTouch && S.mode === 'lock' && !document.pointerLockElement) toast('Click the field to capture the mouse.');
  }
  function sendLive() {
    if (!N.inMatch || !N.ref) return;
    if (!['playing', 'paused', 'countdown', 'failing'].includes(G.state)) return;
    const total = G.hits + G.misses;
    const live = { r: N.round, s: G.score, c: G.combo, a: total ? Math.round(G.hits / total * 10000) / 10000 : 1,
      hp: Math.round(G.energy / G.maxE * 100) / 100, p: Math.round(Math.max(0, G.t) / Math.max(1, G.endT) * 1000) / 1000 };
    const sig = JSON.stringify(live); if (sig === N.lastLive) return; N.lastLive = sig;
    N.ref.child('players/' + N.uid + '/live').set(live);
    renderHud();
  }
  function scoreOf(p, mine) {
    if (mine && N.inMatch && G.state !== 'results') { const t = G.hits + G.misses; return { s: G.score, a: t ? G.hits / t : 1, hp: G.energy / G.maxE, out: G.state === 'failing' }; }
    if (p.res && p.res.r === N.round) return { s: p.res.s, a: p.res.a, hp: p.res.f ? 0 : 1, out: !!p.res.f, done: true };
    if (p.live && p.live.r === N.round) return { s: p.live.s, a: p.live.a, hp: p.live.hp, out: false };
    return null;
  }
  function renderHud() {
    if (!N.room) return;
    const rows = playerList(N.room).map(p => ({ p, sc: scoreOf(p, p.uid === N.uid) })).filter(x => x.sc).sort((a, b) => b.sc.s - a.sc.s);
    hud.innerHTML = rows.map(({ p, sc }, i) => `<div class="r ${p.uid === N.uid ? 'me' : ''} ${sc.out ? 'out' : ''}"><span>${i + 1}.</span><span class="n">${esc(p.name)}</span><span class="s">${sc.s.toLocaleString('en-US')}</span><span class="hp"><i style="width:${Math.round(Math.max(0, Math.min(1, sc.hp)) * 100)}%;${sc.hp <= 0.3 ? 'background:var(--bad)' : ''}"></i></span></div>`).join('');
  }
  function renderResults() {
    if (!N.room) return;
    const rows = playerList(N.room).map(p => ({ p, sc: scoreOf(p, false) })).filter(x => x.sc).sort((a, b) => b.sc.s - a.sc.s);
    resBox.innerHTML = '<h4>Room ' + N.code + '</h4><ul class="plist">' + rows.map(({ p, sc }, i) => {
      const grade = p.res && p.res.r === N.round ? p.res.g : '';
      const st = sc.done ? `${grade} · ${(sc.a * 100).toFixed(2)}%` : 'still playing…';
      return `<li class="${p.uid === N.uid ? 'me' : ''}"><span>${i + 1}. ${esc(p.name)}</span><span class="st">${sc.s.toLocaleString('en-US')} · ${st}</span></li>`;
    }).join('') + '</ul>';
  }
  function setResultButtons(online) {
    el('btnRetry2').hidden = online; el('btnRetry').hidden = online;
    el('btnMenu').textContent = online ? 'Back to lobby' : 'Back to tracks';
    el('btnQuit').textContent = online ? 'Give up' : 'Quit';
  }

  /* ---------- hooks called by the game ---------- */
  window.PGNet = {
    active: () => !!N.code && N.inMatch,
    inRoom: () => !!N.code,
    onResults(failed, acc, grade) {
      hud.hidden = true; clearInterval(N.liveTimer); N.liveTimer = 0;
      if (!N.code || !N.inMatch) { if (!N.code) setResultButtons(false); return; }
      N.inMatch = false;
      N.ref.child('players/' + N.uid).update({ where: 'results', live: null, res: { r: N.round, s: G.score, a: Math.round(acc * 10000) / 10000, g: grade, mc: G.maxCombo, f: !!failed } });
      resBox.hidden = false; renderResults();
    },
    onMenu() {
      if (!N.code) { setResultButtons(false); return; }
      if (N.inMatch) {   // gave up mid-run
        N.inMatch = false; clearInterval(N.liveTimer); hud.hidden = true;
        const t = G.hits + G.misses;
        N.ref.child('players/' + N.uid).update({ where: 'lobby', live: null, res: { r: N.round, s: G.score, a: t ? Math.round(G.hits / t * 10000) / 10000 : 0, g: 'F', mc: G.maxCombo || 0, f: true } });
      } else N.ref.child('players/' + N.uid).update({ where: 'lobby' });
      if (N.host && N.room && N.room.state === 'playing') N.ref.update({ state: 'lobby' });
      if (N.modsBackup) { for (const k of MOD_KEYS) M[k] = N.modsBackup[k]; M.auto = false; }
      resBox.hidden = true;
      showLobby();
    },
    onPlay(e, di) {
      if (!N.code) return false;
      if (N.host && N.choosing) {
        if (e.kind !== 'builtin') { toast('Only the built-in tracks work online. Your own songs exist only on your device.'); return true; }
        N.choosing = false; playBtn.textContent = 'PLAY';
        const mods = {}; for (const k of MOD_KEYS) mods[k] = k === 'speed' ? +M.speed : !!M[k];
        N.modsBackup = Object.assign({}, M);
        N.ref.update({ song: e.id, di, mods });
        showLobby();
      }
      return true;
    }
  };

  /* ---------- buttons ---------- */
  onlineBtn.addEventListener('click', () => { ensureAudio(); actx.resume(); if (N.code) showLobby(); else showJoin(); });
  el('netBack').addEventListener('click', () => { screen.hidden = true; toMenu(); });
  el('netCreate').addEventListener('click', () => { ensureAudio(); actx.resume(); createRoom(); });
  el('netJoinBtn').addEventListener('click', () => { ensureAudio(); actx.resume(); joinRoom(el('netCode').value); });
  el('netCode').addEventListener('keydown', e => { if (e.key === 'Enter') el('netJoinBtn').click(); });
  el('netLeave').addEventListener('click', () => leave(''));
  el('netTrack').addEventListener('click', () => {
    N.choosing = true; screen.hidden = true; $('#menu').hidden = false; playBtn.textContent = 'USE TRACK';
    toast('Pick a track, difficulty and mods, then press USE TRACK.');
  });
  el('netStart').addEventListener('click', () => {
    if (!N.host || !N.room) return;
    ensureAudio(); actx.resume();
    N.ref.update({ state: 'playing', round: (N.room.round || 0) + 1, startAt: serverNow() + START_DELAY });
  });
  el('netCopy').addEventListener('click', async () => {
    const url = location.origin + location.pathname + '?room=' + N.code;
    try { await navigator.clipboard.writeText(url); toast('Invite link copied.'); } catch (e) { toast(url, 8000); }
  });
  addEventListener('beforeunload', () => { if (N.code && N.ref) { if (N.host) N.ref.remove(); else N.ref.child('players/' + N.uid).remove(); } });

  // invite link: ?room=CODE opens the join screen with the code filled in
  const inv = new URLSearchParams(location.search).get('room');
  if (inv) { el('netCode').value = inv.toUpperCase().slice(0, 4); showJoin(); msg('Enter your name and press Join room.'); }
})();
