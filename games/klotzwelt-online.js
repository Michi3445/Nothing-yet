/* Klotzwelt · gemeinsame Online-Welten über Firebase Realtime Database.
   Wird nach dem Spiel-Script geladen und hängt sich an dessen Globals (G, World, Play,
   UI, Inv, R, Aud …). Firebase wird erst geladen, wenn jemand „Online spielen“ öffnet.

   Datenbank:
     kw/codes/CODE            → { wid, owner }
     kw/worlds/WID            → { owner, name, seed, type, mode, created, code }
     kw/edits/WID/x_y_z       → "id,meta"   (nur Blöcke, die Spieler verändert haben)
     kw/players/WID/UID       → { name, x, y, z, yaw, pitch, t }   (wer gerade drin ist)
     kw/saves/WID/UID         → Position, Leben, Inventar, Bett des Spielers
     kw/chat/WID/PUSHID       → { u, n, t, ts }                                        */
(() => {
  'use strict';
  const SDK = 'https://www.gstatic.com/firebasejs/10.14.1/';
  const CODE_CH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const DAY_MS = 12 * 60 * 1000;
  const N = { db: null, uid: null, offset: 0, wid: null, code: null, doc: null, name: '',
    edits: new Map(), byChunk: new Map(), mine: new Map(), out: new Map(), cap: 0,
    players: new Map(), avatars: new Map(), refs: [], joinedAt: 0, lastPos: '', posT: 0, flushT: 0,
    be: new Map(), beByChunk: new Map(), beSent: new Map(), locks: new Map(), open: null, items: new Map(), remote: false, wxo: null,
    tgts: new Map(), proxies: new Map(), claims: new Map(), mobSig: '', mobT: 0 };
  const serverNow = () => Date.now() + N.offset;
  const on = () => !!N.wid && !!G.meta && G.meta.net === N.wid;
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
  };

  /* ---------- Firebase ---------- */
  function loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Konnte ' + src + ' nicht laden')); document.head.appendChild(s); });
  }
  let fbReady = null;
  function initFirebase() {
    if (fbReady) return fbReady;
    fbReady = (async () => {
      if (!window.FIREBASE_CONFIG) await loadScript('../firebase-config.js');
      if (!window.firebase) await loadScript(SDK + 'firebase-app-compat.js');
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
    if (/admin-restricted|operation-not-allowed/.test(m)) return 'Anonyme Anmeldung ist in Firebase ausgeschaltet.';
    if (/unauthorized-domain/.test(m)) return 'Diese Website ist in Firebase nicht als Domain erlaubt.';
    if (/permission/i.test(m)) return 'Die Datenbank hat den Zugriff verweigert (Regeln prüfen).';
    if (/nicht laden|network/i.test(m)) return 'Keine Verbindung zu Firebase.';
    return m;
  }
  const kw = p => N.db.ref('kw/' + p);

  /* ---------- block edits ---------- */
  const keyOf = (x, y, z) => x + '_' + y + '_' + z;
  function remember(k, x, y, z, id, m) {
    N.edits.set(k, [x, y, z, id, m]);
    const ck = CKEY(x >> 4, z >> 4); let s = N.byChunk.get(ck); if (!s) { s = new Set(); N.byChunk.set(ck, s); } s.add(k);
  }
  const oSet = World.prototype.setBlock, oMeta = World.prototype.setMeta, oGen = World.prototype.genChunk;
  function record(w, x, y, z) {
    if (y < 0 || y >= WH) return;
    const id = w.get(x, y, z), m = w.getM(x, y, z), k = keyOf(x, y, z);
    N.out.set(k, id + ',' + m); remember(k, x, y, z, id, m); beCheck(w, x, y, z, id);
  }
  World.prototype.setBlock = function (x, y, z, id, m, fl) {
    const r = oSet.call(this, x, y, z, id, m, fl);
    if (r && N.cap > 0 && this === G.world && on()) record(this, x, y, z);
    return r;
  };
  World.prototype.setMeta = function (x, y, z, m, urgent) {
    const r = oMeta.call(this, x, y, z, m, urgent);
    if (N.cap > 0 && this === G.world && on()) record(this, x, y, z);
    return r;
  };
  // freshly generated (or reloaded) chunks get every stored change of that area
  World.prototype.genChunk = function (cx, cz) {
    const r = oGen.apply(this, arguments);
    if (this === G.world && on()) {
      const s = N.byChunk.get(CKEY(cx, cz));
      if (s) for (const k of s) { const e = N.edits.get(k); if (e) oSet.call(this, e[0], e[1], e[2], e[3], e[4], LIQ[e[3]] ? 2 : 0); }
      const b = N.beByChunk.get(CKEY(cx, cz));
      if (b) for (const k of b) { const e = N.be.get(k); if (e) beApply(this, e[0], e[1], e[2], e[3]); }
    }
    return r;
  };
  // only what a player does on purpose is shared; water, plants and falling sand run on every computer
  const capture = (obj, name) => { const f = obj[name]; if (typeof f !== 'function') return; obj[name] = function () { N.cap++; try { return f.apply(this, arguments); } finally { N.cap--; } }; };
  for (const k of ['breakBlock', 'useItem', 'placeBlock', 'placeDoor', 'placeBed', 'bucketPick', 'bucketPour', 'hoe', 'plantSeed', 'igniteTNT']) capture(Play, k);
  capture(World.prototype, 'explode');

  function applyRemote(k, val) {
    const p = k.split('_'), x = +p[0], y = +p[1], z = +p[2];
    const q = String(val).split(','), id = +q[0] | 0, m = +q[1] | 0;
    remember(k, x, y, z, id, m);
    if (N.mine.get(k) === val) { N.mine.delete(k); return; }   // our own change coming back
    const w = G.world; if (!w || !on()) return;
    const c = w.chunkAt(x, z); if (!c || c.state < 1) return;
    const old = w.get(x, y, z), om = w.getM(x, y, z);
    if (old === id && om === m) return;
    oSet.call(w, x, y, z, id, m, 3 | 4);
    try {
      if (!id && old) w.hooks.blockBroken(x, y, z, old, om);
      else if (id && id !== old && BD[id] && BD[id].snd) Aud.play('place', .7, x + .5, y + .5, z + .5, BD[id].snd);
    } catch (e) { }
  }
  function flush() {
    if (!N.out.size || !on()) { N.out.clear(); return; }
    const obj = {};
    for (const [k, v] of N.out) { obj[k] = v; N.mine.set(k, v); }
    N.out.clear();
    kw('edits/' + N.wid).update(obj).catch(e => { console.error(e); UI.msg('Änderung konnte nicht gespeichert werden: ' + errText(e), '#ff7a6a'); });
  }

  /* ---------- chests & furnaces ---------- */
  // kw/be/WID/x_y_z → JSON string; kw/locks/WID/x_y_z → { u, n, t } while someone has it open
  const BE_IDS = () => [B.chest, B.furnace, B.furnace_lit];
  const st2a = s => s ? [s.id, s.n, s.d || 0] : 0;
  const a2st = a => Array.isArray(a) && a[1] > 0 ? { id: a[0] | 0, n: a[1] | 0, d: a[2] | 0 } : null;
  function beSer(o, full) {
    if (o.t === 'chest') return JSON.stringify({ t: 'c', i: o.items.map(st2a) });
    const r = { t: 'f', a: st2a(o.in), b: st2a(o.fuel), c: st2a(o.out), by: o.by || N.uid };
    if (full) { r.bu = o.burn | 0; r.bm = o.burnMax | 0; r.ck = o.cook | 0; }
    return JSON.stringify(r);
  }
  function beRemember(k, x, y, z, obj) {
    if (obj) N.be.set(k, [x, y, z, obj]); else N.be.delete(k);
    const ck = CKEY(x >> 4, z >> 4); let s = N.beByChunk.get(ck);
    if (obj) { if (!s) { s = new Set(); N.beByChunk.set(ck, s); } s.add(k); } else if (s) s.delete(k);
  }
  // copy a stored record into the world (in place, so an open chest window updates live)
  function beApply(w, x, y, z, obj) {
    const c = w.chunkAt(x, z); if (!c || c.state < 1) return;
    const id = w.get(x, y, z);
    if (obj.t === 'c') {
      if (id !== B.chest) return;
      let be = w.beAt(x, y, z); if (!be || be.t !== 'chest') { be = { t: 'chest', items: new Array(27).fill(null) }; w.setBE(x, y, z, be); }
      for (let i = 0; i < 27; i++) be.items[i] = a2st(obj.i && obj.i[i]);
      return be;
    }
    if (id !== B.furnace && id !== B.furnace_lit) return;
    let be = w.beAt(x, y, z); if (!be || be.t !== 'furnace') { be = { t: 'furnace', in: null, fuel: null, out: null, burn: 0, burnMax: 0, cook: 0 }; w.setBE(x, y, z, be); }
    be.in = a2st(obj.a); be.fuel = a2st(obj.b); be.out = a2st(obj.c); be.by = obj.by || null;
    if (obj.bu !== undefined) { be.burn = obj.bu | 0; be.burnMax = obj.bm | 0; be.cook = obj.ck | 0; }
    const lit = be.burn > 0, want = lit ? B.furnace_lit : B.furnace;
    if (id !== want) { const m = w.getM(x, y, z); oSet.call(w, x, y, z, want, m, 1 | 4); w.setBE(x, y, z, be); }
    return be;
  }
  function beRemote(k, val) {
    const p = k.split('_'), x = +p[0], y = +p[1], z = +p[2];
    if (val === null) { beRemember(k, x, y, z, null); N.beSent.delete(k); return; }
    let obj; try { obj = JSON.parse(val); } catch (e) { return; }
    beRemember(k, x, y, z, obj);
    if (N.beSent.get(k) === val) return;   // our own write coming back
    N.beSent.set(k, val);
    const w = G.world; if (w && on()) beApply(w, x, y, z, obj);
  }
  function bePush(o, full) {
    if (!on()) return;
    const k = keyOf(o.x, o.y, o.z), s = beSer(o, full);
    if (N.beSent.get(k) === s) return;
    N.beSent.set(k, s);
    kw('be/' + N.wid + '/' + k).set(s).catch(e => { console.error(e); UI.msg('Truhe/Ofen konnte nicht gespeichert werden: ' + errText(e), '#ff7a6a'); });
  }
  // a furnace runs on exactly one computer: whoever used it last, or (if they left) the first player by id
  function runsHere(o) {
    if (!o.by || o.by === N.uid) return true;
    if (N.players.has(o.by)) return false;
    let first = N.uid; for (const u of N.players.keys()) if (u < first) first = u;
    return first === N.uid;
  }
  const oFurn = World.prototype.furnaceTick;
  World.prototype.furnaceTick = function (o) {
    if (this !== G.world || !on()) return oFurn.call(this, o);
    if (!runsHere(o)) return;
    const before = beSer(o);
    oFurn.call(this, o);
    const be = this.beAt(o.x, o.y, o.z) || o;
    if (o.by && o.by !== N.uid) be.by = N.uid;    // taking over from someone who left
    const now = performance.now(), changed = beSer(be) !== before;
    if (changed || (be.burn > 0 && now - (be._pt || 0) > 2000)) { be._pt = now; bePush(be, true); }
  };
  // block placed/broken: a chest or furnace that is gone loses its record
  function beCheck(w, x, y, z, id) {
    const k = keyOf(x, y, z);
    if (N.be.has(k) && BE_IDS().indexOf(id) < 0) { beRemember(k, x, y, z, null); N.beSent.delete(k); kw('be/' + N.wid + '/' + k).remove().catch(() => { }); }
  }
  // opening: one player per chest/furnace at a time, so nothing gets duplicated
  const oShow = UI.show;
  UI.show = function (name, data) {
    if (!on() || (name !== 'chest' && name !== 'furnace') || !data || !data.be) return oShow.apply(this, arguments);
    const be = data.be, k = keyOf(be.x, be.y, be.z), lk = N.locks.get(k);
    if (lk && lk.u !== N.uid && N.players.has(lk.u)) {
      UI.msg((lk.n || 'Jemand') + ' benutzt gerade ' + (name === 'chest' ? 'diese Truhe.' : 'diesen Ofen.'), '#ffe9a8');
      return;
    }
    if (name === 'furnace') be.by = N.uid;
    const ref = kw('locks/' + N.wid + '/' + k);
    ref.set({ u: N.uid, n: N.name, t: firebase.database.ServerValue.TIMESTAMP }).catch(() => { });
    ref.onDisconnect().remove();
    const r = oShow.apply(this, arguments);
    const cur = UI.cur;
    if (cur && cur.name === name) {
      N.open = be;
      const oTick = cur.tick, oClose = cur.close;
      cur.tick = function (dt) { if (oTick) oTick.call(this, dt); bePush(be, name === 'furnace'); };
      cur.close = function () {
        const res = oClose.apply(this, arguments);
        bePush(be, name === 'furnace'); N.open = null;
        ref.remove().catch(() => { }); ref.onDisconnect().cancel();
        return res;
      };
    }
    return r;
  };

  /* ---------- dropped items ---------- */
  // kw/items/WID/PUSHID → { x, y, z, id, n, d, vx, vy, vz, p, ts }; picking up = deleting it first
  const ITEM_LIFE = 300;
  const oSpawn = Ents.spawnItem;
  Ents.spawnItem = function () {
    const e = oSpawn.apply(this, arguments);
    if (e && on() && G.world) {
      e.mergeT = 1e9;    // stacks don't merge online, every item is its own record
      if (N.cap > 0 && !N.remote) Promise.resolve().then(() => shareItem(e));   // after the caller set .pick
    }
    return e;
  };
  for (const k of ['dropHeld']) capture(Play, k);
  capture(G, 'onDeath');
  if (typeof window.dropStack === 'function') { const f = window.dropStack; window.dropStack = function () { N.cap++; try { return f.apply(this, arguments); } finally { N.cap--; } }; }
  const r2 = v => Math.round(v * 100) / 100;
  function shareItem(e) {
    if (e.dead || e.nid || !on()) return;
    const ref = kw('items/' + N.wid).push();
    e.nid = ref.key; N.items.set(ref.key, e);
    ref.set({ x: r2(e.x), y: r2(e.y), z: r2(e.z), id: e.stack.id, n: e.stack.n, d: e.stack.d || 0, vx: r2(e.vx), vy: r2(e.vy), vz: r2(e.vz), p: r2(Math.max(0, e.pick)), ts: firebase.database.ServerValue.TIMESTAMP })
      .catch(err => { console.error(err); });
  }
  function itemRemote(key, v) {
    if (!v || N.items.has(key)) return;
    const age = v.ts ? (serverNow() - v.ts) / 1000 : 0;
    if (age > ITEM_LIFE - 1) { kw('items/' + N.wid + '/' + key).remove().catch(() => { }); return; }
    if (!G.world || !on()) return;
    N.remote = true;
    let e; try { e = oSpawn.call(Ents, +v.x, +v.y, +v.z, { id: v.id | 0, n: v.n | 0, d: v.d | 0 }, +v.vx || 0, +v.vy || 0, +v.vz || 0); } finally { N.remote = false; }
    if (!e) return;
    e.nid = key; e.mergeT = 1e9; e.pick = Math.max(0, (+v.p || 0) - age); e.life = ITEM_LIFE - age;
    N.items.set(key, e);
  }
  function itemGone(key) {
    const e = N.items.get(key); N.items.delete(key);
    if (e && !e.dead) e.dead = true;
  }
  const oItemUpd = ItemEnt.prototype.update;
  ItemEnt.prototype.update = function (dt, w, P) {
    if (!this.nid || !on()) return oItemUpd.call(this, dt, w, P);
    if (this.claiming) return;
    const inv = Inv, oAdd = inv.add; let want = false;
    inv.add = function (st) { want = true; return st.n; };   // pretend it didn't fit; the database decides
    try { oItemUpd.call(this, dt, w, P); } finally { inv.add = oAdd; }
    if (this.dead) { if (N.items.get(this.nid) === this) { N.items.delete(this.nid); kw('items/' + N.wid + '/' + this.nid).remove().catch(() => { }); } return; }
    if (want) claimItem(this);
  };
  function claimItem(e) {
    e.claiming = true;
    const key = e.nid, wid = N.wid;
    kw('items/' + wid + '/' + key).transaction(cur => cur === null ? undefined : null, (err, ok) => {
      e.claiming = false;
      if (err) { console.error(err); return; }
      N.items.delete(key);
      if (!ok || N.wid !== wid) { e.dead = true; return; }
      const left = Inv.add(e.stack);
      if (left < e.stack.n) { G.sfx('pop', .5, e.x, e.y, e.z); G.onPickup && G.onPickup(e.stack.id); }
      e.dead = true;
      if (left > 0) { N.cap++; try { Ents.spawnItem(G.player.x, G.player.y + .5, G.player.z, { id: e.stack.id, n: left, d: e.stack.d || 0 }, 0, 1, 0); } finally { N.cap--; } }
    }, false);
  }

  /* ---------- weather ---------- */
  // the same sky for everybody: rain and thunder follow server time, /weather overrides it for 10 minutes
  const WX_SLOT = 6 * 60 * 1000;
  function netWeather() {
    const now = serverNow(), o = N.wxo;
    if (o && now < o.until) return [o.rain ? 1 : 0, o.th ? 1 : 0];
    const r = hash(N.doc.seed | 0, Math.floor(now / WX_SLOT), 77, 3) / 4294967296;
    return [r < .25 ? 1 : 0, r < .08 ? 1 : 0];
  }
  if (typeof CMD === 'object' && CMD.weather) {
    const oW = CMD.weather;
    CMD.weather = function (a) {
      const r = oW.apply(this, arguments);
      if (on()) kw('wx/' + N.wid).set({ rain: G.wx.target ? 1 : 0, th: G.wx.thTarget ? 1 : 0, until: Math.round(serverNow() + 10 * 60 * 1000) }).catch(e => UI.msg('Wetter nicht geteilt: ' + errText(e), '#ff7a6a'));
      return r;
    };
  }

  /* ---------- animals & monsters ---------- */
  // whoever spawns a mob runs its AI and sends its state (kw/mobs/WID/UID → { mid: "type,x,y,z,yaw,flags,fuse" });
  // everybody else shows a copy that only follows those updates. Hits on a copy go to the owner (kw/mhits),
  // hits by a monster on another player go to that player (kw/phits), explosions and skeleton arrows to all (kw/fx).
  let midN = 0;
  const r1 = v => Math.round(v * 100) / 100;
  // remote players as targets for our own monsters
  function targetOf(uid) {
    let t = N.tgts.get(uid);
    if (!t) {
      t = { uid, hw: .3, h: 1.8, vx: 0, vy: 0, vz: 0, onGround: true, remote: true,
        hurt(d, kind, sx, sz) { if (!on() || this.dead) return; kw('phits/' + N.wid + '/' + uid).push({ d: r1(d), k: String(kind || 'mob').slice(0, 12), x: r1(sx || 0), z: r1(sz || 0), ts: firebase.database.ServerValue.TIMESTAMP }).catch(() => { }); } };
      N.tgts.set(uid, t);
    }
    return t;
  }
  function proxyUpdate(m, dt) {
    m.age += dt; if (m.hurtT > 0) m.hurtT -= dt;
    if (m.dead) { m.deathT += dt; return; }
    const k = Math.min(1, dt * 9), ox = m.x, oz = m.z;
    m.x += (m.tx - m.x) * k; m.y += (m.ty - m.y) * k; m.z += (m.tz - m.z) * k;
    let df = m.tyaw - m.yaw; while (df > Math.PI) df -= TAU; while (df < -Math.PI) df += TAU; m.yaw += df * k;
    m.onGround = Math.abs(m.ty - m.y) < .08;
    const sp = Math.hypot(m.x - ox, m.z - oz) / Math.max(dt, 1e-3);
    m.wa += (Math.min(1, sp / (m.D.spd * 1.3 + .001)) - m.wa) * Math.min(1, 8 * dt);
    m.wp += sp * dt * (m.D.kind === 'spider' ? 2.2 : m.D.kind === 'bird' ? 3.2 : 2.6);
    if (m.burn > 0 && Math.random() < dt * 14) G.part(m.x + (Math.random() - .5) * .5, m.y + Math.random() * m.h, m.z + (Math.random() - .5) * .5, 'flame');
  }
  const oMobUpd = Mob.prototype.update, oMobHurt = Mob.prototype.hurt, oMobHurt0 = Mob.prototype.hurt0, oMobDie = Mob.prototype.die;
  Mob.prototype.update = function (dt, w, P) {
    if (!on()) return oMobUpd.call(this, dt, w, P);
    if (this.proxy) return proxyUpdate(this, dt);
    if (!this.mid) this.mid = (++midN).toString(36);
    // monsters go for the closest player, not only the one whose computer runs them
    if (this.D.hostile && N.tgts.size && !this.dead) {
      const ok = p => !p.dead && !p.creative;
      let best = P, bd = ok(P) ? (P.x - this.x) ** 2 + (P.z - this.z) ** 2 : 1e12;
      for (const t of N.tgts.values()) { if (!N.players.has(t.uid) || !ok(t)) continue; const d = (t.x - this.x) ** 2 + (t.z - this.z) ** 2; if (d < bd) { bd = d; best = t; } }
      return oMobUpd.call(this, dt, w, best);
    }
    return oMobUpd.call(this, dt, w, P);
  };
  Mob.prototype.hurt = function (dmg, sx, sz, byPlayer) {
    if (!this.proxy) return oMobHurt.apply(this, arguments);
    if (this.dead || this.hurtT > 0) return false;
    this.hurtT = .4; G.sfx('hurt_' + this.type, 1, this.x, this.y, this.z); G.part(this.x, this.y + this.h * .6, this.z, 'hit');
    if (byPlayer && on()) kw('mhits/' + N.wid + '/' + this.owner).push({ m: this.mid, d: r1(dmg), x: r1(sx), z: r1(sz), ts: firebase.database.ServerValue.TIMESTAMP }).catch(() => { });
    return true;
  };
  Mob.prototype.hurt0 = function () { if (!this.proxy) return oMobHurt0.apply(this, arguments); };
  // a copy never dies on its own (its owner says when); loot of our own mobs is shared
  Mob.prototype.die = function () {
    if (this.proxy) return;
    if (!on()) return oMobDie.apply(this, arguments);
    N.cap++; try { return oMobDie.apply(this, arguments); } finally { N.cap--; }
  };
  // copies are not despawned by distance here, and animals of an area are spawned only once for everybody
  const oDesp = Ents.despawn;
  Ents.despawn = function () {
    if (!on()) return oDesp.apply(this, arguments);
    const all = this.mobs; this.mobs = all.filter(m => !m.proxy);
    try { return oDesp.apply(this, arguments); } finally { this.mobs = all; }
  };
  const oAnimals = Ents.spawnAnimals;
  Ents.spawnAnimals = function (ch) {
    if (!on()) return oAnimals.apply(this, arguments);
    const key = String(CKEY(ch.cx, ch.cz));
    for (const [uid, set] of N.claims) if (uid !== N.uid && N.players.has(uid) && set[key]) { this.animalChunks.add(+key); return; }
    if (!this.animalChunks.has(+key)) kw('achunks/' + N.wid + '/' + N.uid + '/' + key).set(1).catch(() => { });
    return oAnimals.apply(this, arguments);
  };
  // skeleton arrows fly on every computer, so they can hit everybody
  const oArrow = Ents.spawnArrow;
  Ents.spawnArrow = function (x, y, z, vx, vy, vz, dmg, owner) {
    const a = oArrow.apply(this, arguments);
    if (on() && !N.remote && owner instanceof Mob && !owner.proxy) sendFx({ t: 'arrow', x: r1(x), y: r1(y), z: r1(z), vx: r1(vx), vy: r1(vy), vz: r1(vz), d: r1(dmg), m: owner.mid || '' });
    return a;
  };
  // explosions (creeper, TNT) hurt and shake everybody nearby
  const oExplode = World.prototype.explode;
  World.prototype.explode = function (x, y, z, R0) {
    if (this === G.world && on() && !N.remote) sendFx({ t: 'boom', x: r1(x), y: r1(y), z: r1(z), r: r1(R0) });
    return oExplode.apply(this, arguments);
  };
  function sendFx(o) {
    o.u = N.uid; o.ts = firebase.database.ServerValue.TIMESTAMP;
    const ref = kw('fx/' + N.wid).push(); ref.set(o).catch(() => { });
    setTimeout(() => ref.remove().catch(() => { }), 5000);
  }
  function onFx(v) {
    if (!v || v.u === N.uid || !G.world || !on()) return;
    if (v.ts && serverNow() - v.ts > 4000) return;
    N.remote = true;
    try {
      if (v.t === 'boom') G.world.hooks.explosion(+v.x, +v.y, +v.z, +v.r || 3);
      else if (v.t === 'arrow') {
        const src = N.proxies.get(v.u + '/' + v.m) || {};
        oArrow.call(Ents, +v.x, +v.y, +v.z, +v.vx, +v.vy, +v.vz, +v.d || 2, src);
        G.sfx('bow', .8, +v.x, +v.y, +v.z);
      }
    } catch (e) { console.error(e); } finally { N.remote = false; }
  }
  // snapshots from other players
  function onMobs(uid, val) {
    if (uid === N.uid || !G.world || !on() || !G.player) return;
    const seen = new Set(), P = G.player;
    for (const mid in (val || {})) {
      const q = String(val[mid]).split(','); const type = q[0];
      if (!MOBDEF[type]) continue;
      const x = +q[1], y = +q[2], z = +q[3], yaw = +q[4], fl = +q[5] | 0, fuse = +q[6] || 0;
      const key = uid + '/' + mid; seen.add(key);
      let m = N.proxies.get(key);
      if (m && !m.dead && Ents.mobs.indexOf(m) < 0) { N.proxies.delete(key); m = null; }   // dropped for being far away
      if (!m) {
        if (fl & 1) continue;
        if ((x - P.x) ** 2 + (z - P.z) ** 2 > 80 * 80) continue;
        m = new Mob(type, x, y, z); m.proxy = true; m.owner = uid; m.mid = mid; m.yaw = yaw; m.tx = x; m.ty = y; m.tz = z; m.tyaw = yaw;
        Ents.add(m); N.proxies.set(key, m);
      }
      if (m.dead && m.deathT > 5) { N.proxies.delete(key); continue; }
      m.tx = x; m.ty = y; m.tz = z; m.tyaw = yaw; m.fuse = fuse;
      m.aim = (fl & 4) ? .5 : 0; if ((fl & 8) && !m.swing) m.swing = 1; m.burn = (fl & 16) ? 1 : 0;
      if ((fl & 2) && m.hurtT <= 0) m.hurtT = .4;
      if ((fl & 1) && !m.dead) { m.dead = true; m.deathT = 0; G.sfx('death_' + m.type, 1, m.x, m.y, m.z); }
    }
    for (const [key, m] of N.proxies) if (m.owner === uid && !seen.has(key)) { if (!m.dead) { m.dead = true; m.deathT = 9; } N.proxies.delete(key); }
  }
  function dropProxies(uid) {
    for (const [key, m] of N.proxies) if (!uid || m.owner === uid) { if (!m.dead) { m.dead = true; m.deathT = 9; } N.proxies.delete(key); }
  }
  function sendMobs() {
    const out = {};
    for (const m of Ents.mobs) {
      if (m.proxy || !m.mid) continue;
      if (m.dead && m.deathT > .5) continue;
      const fl = (m.dead ? 1 : 0) | (m.hurtT > 0 ? 2 : 0) | (m.aim > 0 ? 4 : 0) | (m.swing > .5 ? 8 : 0) | (m.burn > 0 ? 16 : 0);
      out[m.mid] = m.type + ',' + r1(m.x) + ',' + r1(m.y) + ',' + r1(m.z) + ',' + r1(m.yaw) + ',' + fl + ',' + r1(m.fuse || 0);
    }
    const s = JSON.stringify(out);
    if (s === N.mobSig) return;
    N.mobSig = s;
    kw('mobs/' + N.wid + '/' + N.uid).set(Object.keys(out).length ? out : null).catch(() => { });
  }
  // hits that other players landed on our mobs, and hits our monsters landed on us
  function onMobHit(s) {
    const v = s.val(); s.ref.remove().catch(() => { });
    if (!v || !on()) return;
    const m = Ents.mobs.find(e => !e.proxy && e.mid === v.m);
    if (m) m.hurt(+v.d || 1, +v.x, +v.z, false);
  }
  function onPlayerHit(s) {
    const v = s.val(); s.ref.remove().catch(() => { });
    if (!v || !on() || !G.player || G.player.dead) return;
    if (v.ts && serverNow() - v.ts > 4000) return;
    G.player.hurt(+v.d || 1, v.k || 'mob', +v.x, +v.z);
  }

  /* ---------- other players ---------- */
  function hashCol(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return new THREE.Color().setHSL(((h >>> 0) % 360) / 360, .55, .5); }
  function nameSprite(name) {
    const c = document.createElement('canvas'), g = c.getContext('2d'); g.font = 'bold 28px monospace';
    const w = Math.ceil(g.measureText(name).width) + 20; c.width = w; c.height = 40;
    g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(0, 0, w, 40); g.font = 'bold 28px monospace'; g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.fillText(name, 10, 21);
    const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true, fog: false }));
    s.scale.set(w / 100, .4, 1); s.renderOrder = 10; return s;
  }
  function makeAvatar(uid, name) {
    const g = new THREE.Group(), col = hashCol(uid), skin = new THREE.Color(0xe0b48c), dark = col.clone().multiplyScalar(.55);
    const mats = [];
    const box = (w, h, d, c, x, y, z, pivotTop) => {
      const m = new THREE.MeshBasicMaterial({ color: c.clone() }); m.userData.base = c.clone(); mats.push(m);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      if (pivotTop) { const p = new THREE.Group(); p.position.set(x, y, z); mesh.position.y = -h / 2; p.add(mesh); g.add(p); return p; }
      mesh.position.set(x, y, z); g.add(mesh); return mesh;
    };
    const head = box(.5, .5, .5, skin, 0, 1.55, 0);
    const eyes = new THREE.Mesh(new THREE.BoxGeometry(.3, .06, .02), new THREE.MeshBasicMaterial({ color: 0x222222 })); eyes.position.set(0, 1.6, -.26); g.add(eyes);
    box(.5, .7, .26, col, 0, .97, 0);
    const armL = box(.2, .7, .2, col, -.36, 1.3, 0, true), armR = box(.2, .7, .2, col, .36, 1.3, 0, true);
    const legL = box(.22, .62, .22, dark, -.12, .62, 0, true), legR = box(.22, .62, .22, dark, .12, .62, 0, true);
    const tag = nameSprite(name); tag.position.y = 2.15; g.add(tag);
    R.scene.add(g);
    return { g, head, armL, armR, legL, legR, tag, mats, name, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, tx: 0, ty: 0, tz: 0, tyaw: 0, tpitch: 0, phase: 0, fresh: true };
  }
  function dropAvatar(uid) {
    const a = N.avatars.get(uid); if (!a) return;
    R.scene.remove(a.g); a.g.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } });
    N.avatars.delete(uid);
  }
  function onPlayer(uid, p, isNew) {
    if (uid === N.uid || !p) return;
    const known = N.players.has(uid);
    N.players.set(uid, p);
    let a = N.avatars.get(uid);
    if (!a || a.name !== p.name) { dropAvatar(uid); a = makeAvatar(uid, p.name || '?'); N.avatars.set(uid, a); }
    const tg = targetOf(uid); tg.x = +p.x || 0; tg.y = +p.y || 0; tg.z = +p.z || 0; tg.eye = tg.y + 1.62; tg.dead = !!p.dd || tg.y < -50; tg.creative = !!p.cr;
    a.tx = +p.x || 0; a.ty = +p.y || 0; a.tz = +p.z || 0; a.tyaw = +p.yaw || 0; a.tpitch = +p.pitch || 0;
    if (a.fresh) { a.x = a.tx; a.y = a.ty; a.z = a.tz; a.yaw = a.tyaw; a.fresh = false; }
    if (isNew && !known) UI.msg((p.name || 'Jemand') + ' ist der Welt beigetreten.', '#ffe9a8');
  }
  function lerpAngle(a, b, t) { let d = ((b - a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI; return a + d * t; }
  let lastT = performance.now();
  function tick(now) {
    requestAnimationFrame(tick);
    const dt = Math.min(.1, (now - lastT) / 1000); lastT = now;
    if (!N.wid) return;
    const playing = on() && (G.state === 'play' || G.state === 'dead');
    const light = .25 + .75 * ((G.env && G.env.dayF) || 1);
    for (const a of N.avatars.values()) {
      a.g.visible = playing;
      if (!playing) continue;
      const k = Math.min(1, dt * 10), ox = a.x, oz = a.z;
      a.x += (a.tx - a.x) * k; a.y += (a.ty - a.y) * k; a.z += (a.tz - a.z) * k;
      a.yaw = lerpAngle(a.yaw, a.tyaw, k); a.pitch += (a.tpitch - a.pitch) * k;
      const sp = Math.hypot(a.x - ox, a.z - oz) / Math.max(dt, 1e-3);
      a.phase += dt * Math.min(sp, 6) * 2.2;
      const sw = Math.sin(a.phase) * Math.min(1, sp / 3) * .8;
      a.g.position.set(a.x, a.y, a.z); a.g.rotation.y = a.yaw;
      a.head.rotation.x = a.pitch * .8;
      a.legL.rotation.x = sw; a.legR.rotation.x = -sw; a.armL.rotation.x = -sw * .8; a.armR.rotation.x = sw * .8;
      for (const m of a.mats) m.color.copy(m.userData.base).multiplyScalar(light);
    }
    if (!on()) return;
    // send our own position ~8×/s while it changes
    N.posT -= dt; N.flushT -= dt;
    if (N.flushT <= 0) { N.flushT = .12; flush(); }
    N.mobT -= dt; if (N.mobT <= 0) { N.mobT = .2; sendMobs(); }
    const P = G.player;
    if (P && N.posT <= 0) {
      N.posT = .125;
      const pos = { x: Math.round(P.x * 100) / 100, y: Math.round(P.y * 100) / 100, z: Math.round(P.z * 100) / 100, yaw: Math.round(P.yaw * 100) / 100, pitch: Math.round(P.pitch * 100) / 100, dd: P.dead ? 1 : 0, cr: P.creative ? 1 : 0 };
      const sig = JSON.stringify(pos);
      if (sig !== N.lastPos) { N.lastPos = sig; kw('players/' + N.wid + '/' + N.uid).update(Object.assign(pos, { t: firebase.database.ServerValue.TIMESTAMP })); }
    }
  }
  requestAnimationFrame(tick);

  /* ---------- game hooks ---------- */
  const oSave = G.saveNow, oAdvance = G.advanceTime, oToTitle = G.toTitle, oChat = G.chatSubmit, oSleep = Play.trySleep;
  G.saveNow = async function () {
    if (!on()) return oSave.apply(this, arguments);
    const P = this.player, m = this.meta; if (!P || !m) return false;
    flush();
    const save = { p: { x: P.x, y: P.y, z: P.z, yaw: P.yaw, pitch: P.pitch, hp: P.dead ? 20 : P.hp, food: P.dead ? 20 : P.food, sat: P.sat, air: P.air, flying: !!P.flying },
      inv: JSON.stringify(Inv.ser()), bed: m.bed || null, stats: JSON.stringify(this.stats || {}), ach: JSON.stringify(m.ach || {}), t: firebase.database.ServerValue.TIMESTAMP };
    try { await kw('saves/' + N.wid + '/' + N.uid).set(save); return true; } catch (e) { console.error(e); return false; }
  };
  // one clock for everybody: the time of day follows the server time
  G.advanceTime = function (dt, noWeather) {
    if (on() && N.doc) { const [rn, th] = netWeather(), wx = this.wx; wx.target = rn; wx.thTarget = th; wx.t = 1e9; }
    oAdvance.call(this, dt, noWeather);
    if (on() && N.doc) this.tod = ((serverNow() - N.doc.created) / DAY_MS + .04) % 1;
  };
  Play.trySleep = function (x, y, z) {
    if (!on()) return oSleep.apply(this, arguments);
    const m = G.meta; const had = m.bed && m.bed.x === x && m.bed.y === y && m.bed.z === z; m.bed = { x, y, z };
    UI.msg(had ? 'Online kann man nicht schlafen – die Zeit läuft für alle gleich.' : 'Spawnpunkt gesetzt. (Online kann man nicht schlafen.)', '#bfe6ff');
  };
  G.chatSubmit = function (t) {
    if (!on() || t[0] === '/') return oChat.apply(this, arguments);
    kw('chat/' + N.wid).push({ u: N.uid, n: N.name, t: t.slice(0, 200), ts: firebase.database.ServerValue.TIMESTAMP }).catch(e => UI.msg('Nachricht nicht gesendet: ' + errText(e), '#ff7a6a'));
  };
  G.toTitle = async function () {
    const wasOnline = on();
    const r = await oToTitle.apply(this, arguments);
    if (wasOnline || N.wid) disconnect();
    return r;
  };

  /* ---------- entering / leaving ---------- */
  function listen(ref, ev, fn) { ref.on(ev, fn, e => { console.error(e); }); N.refs.push([ref, ev, fn]); }
  async function enter(wid) {
    const db = await initFirebase();
    const [docS, editS, saveS, beS, wxS] = await Promise.all([kw('worlds/' + wid).get(), kw('edits/' + wid).get(), kw('saves/' + wid + '/' + N.uid).get(),
      kw('be/' + wid).get(), kw('wx/' + wid).get()]);
    const doc = docS.val(); if (!doc) throw new Error('Diese Welt gibt es nicht mehr.');
    N.wid = wid; N.doc = doc; N.code = doc.code; N.edits.clear(); N.byChunk.clear(); N.mine.clear(); N.out.clear(); N.players.clear(); N.lastPos = '';
    N.be.clear(); N.beByChunk.clear(); N.beSent.clear(); N.locks.clear(); N.items.clear(); N.open = null; N.wxo = wxS.val() || null;
    const bes = beS.val() || {};
    for (const k in bes) { const p = k.split('_'); try { const o = JSON.parse(bes[k]); N.beSent.set(k, bes[k]); beRemember(k, +p[0], +p[1], +p[2], o); } catch (e) { } }
    const ed = editS.val() || {};
    for (const k in ed) { const p = k.split('_'), q = String(ed[k]).split(','); remember(k, +p[0], +p[1], +p[2], +q[0] | 0, +q[1] | 0); }
    const sv = saveS.val();
    let mine = store.get('klotzwelt.netWorlds', []).filter(w => w.wid !== wid);
    mine.unshift({ wid, code: doc.code, name: doc.name, mode: doc.mode, owner: doc.owner === N.uid, t: Date.now() });
    store.set('klotzwelt.netWorlds', mine.slice(0, 20));
    const parse = (s, d) => { try { return s ? JSON.parse(s) : d; } catch (e) { return d; } };
    const meta = { id: 'net-' + wid, net: wid, name: doc.name, seed: doc.seed, type: doc.type || 'normal', mode: doc.mode || 'survival', diff: 1, created: doc.created, played: Date.now(), v: 1,
      tod: ((serverNow() - doc.created) / DAY_MS + .04) % 1, ach: sv ? parse(sv.ach, {}) : {}, stats: sv ? parse(sv.stats, {}) : { time: 0, mined: 0, kills: 0 } };
    if (sv && sv.p) { meta.player = sv.p; meta.inv = parse(sv.inv, null); meta.bed = sv.bed || null; }
    // presence
    const me = kw('players/' + wid + '/' + N.uid);
    await me.set({ name: N.name, x: 0, y: -100, z: 0, yaw: 0, pitch: 0, t: firebase.database.ServerValue.TIMESTAMP });
    me.onDisconnect().remove();
    N.joinedAt = serverNow();
    await G.startWorld(meta, !sv);
    if (!on()) { disconnect(); return; }
    listen(kw('edits/' + wid), 'child_added', s => applyRemote(s.key, s.val()));
    listen(kw('edits/' + wid), 'child_changed', s => applyRemote(s.key, s.val()));
    listen(kw('be/' + wid), 'child_added', s => beRemote(s.key, s.val()));
    listen(kw('be/' + wid), 'child_changed', s => beRemote(s.key, s.val()));
    listen(kw('be/' + wid), 'child_removed', s => beRemote(s.key, null));
    listen(kw('locks/' + wid), 'child_added', s => N.locks.set(s.key, s.val()));
    listen(kw('locks/' + wid), 'child_changed', s => N.locks.set(s.key, s.val()));
    listen(kw('locks/' + wid), 'child_removed', s => N.locks.delete(s.key));
    listen(kw('items/' + wid), 'child_added', s => itemRemote(s.key, s.val()));
    listen(kw('items/' + wid), 'child_removed', s => itemGone(s.key));
    listen(kw('wx/' + wid), 'value', s => { N.wxo = s.val() || null; });
    N.tgts.clear(); N.proxies.clear(); N.claims.clear(); N.mobSig = '';
    kw('mobs/' + wid + '/' + N.uid).onDisconnect().remove();
    kw('achunks/' + wid + '/' + N.uid).onDisconnect().remove();
    listen(kw('mobs/' + wid), 'child_added', s => onMobs(s.key, s.val()));
    listen(kw('mobs/' + wid), 'child_changed', s => onMobs(s.key, s.val()));
    listen(kw('mobs/' + wid), 'child_removed', s => dropProxies(s.key));
    listen(kw('achunks/' + wid), 'child_added', s => N.claims.set(s.key, s.val() || {}));
    listen(kw('achunks/' + wid), 'child_changed', s => N.claims.set(s.key, s.val() || {}));
    listen(kw('achunks/' + wid), 'child_removed', s => N.claims.delete(s.key));
    listen(kw('mhits/' + wid + '/' + N.uid), 'child_added', onMobHit);
    listen(kw('phits/' + wid + '/' + N.uid), 'child_added', onPlayerHit);
    listen(kw('fx/' + wid).limitToLast(20), 'child_added', s => onFx(s.val()));
    const pl = kw('players/' + wid);
    // whoever is already here gets no "joined" message
    const here = (await pl.get()).val() || {};
    for (const uid in here) onPlayer(uid, here[uid], false);
    listen(pl, 'child_added', s => onPlayer(s.key, s.val(), true));
    listen(pl, 'child_changed', s => onPlayer(s.key, s.val(), false));
    listen(pl, 'child_removed', s => { const p = N.players.get(s.key); N.players.delete(s.key); N.tgts.delete(s.key); dropAvatar(s.key); if (p && s.key !== N.uid) UI.msg((p.name || 'Jemand') + ' hat die Welt verlassen.', '#ffe9a8'); });
    listen(kw('chat/' + wid).limitToLast(30), 'child_added', s => { const c = s.val(); if (!c || (c.ts && c.ts < N.joinedAt - 60000)) return; UI.msg('<' + (c.u === N.uid ? 'Du' : c.n) + '> ' + c.t, c.u === N.uid ? '#ffffff' : '#bfe6ff'); });
    UI.msg('Online-Welt · Code ' + N.code + ' · Lade Freunde über Pause → „Einladen“ ein.', '#ffe9a8');
    try { history.replaceState(null, '', location.pathname + '?welt=' + N.code); } catch (e) { }
  }
  function disconnect() {
    for (const [ref, ev, fn] of N.refs) ref.off(ev, fn);
    N.refs = [];
    if (N.wid && N.db) { const me = kw('players/' + N.wid + '/' + N.uid); me.remove().catch(() => { }); me.onDisconnect().cancel();
      for (const p of ['mobs/', 'achunks/']) { const r = kw(p + N.wid + '/' + N.uid); r.remove().catch(() => { }); r.onDisconnect().cancel(); } }
    dropProxies(); N.tgts.clear(); N.claims.clear();
    for (const uid of [...N.avatars.keys()]) dropAvatar(uid);
    N.wid = null; N.doc = null; N.code = null; N.players.clear(); N.out.clear(); N.items.clear(); N.locks.clear(); N.open = null;
    try { history.replaceState(null, '', location.pathname); } catch (e) { }
  }
  addEventListener('beforeunload', () => { if (on()) { try { G.saveNow(); } catch (e) { } } });

  async function createWorld(o) {
    const db = await initFirebase();
    const s = (o.seed || '').trim();
    const seed = !s ? (Math.random() * 2147483647) | 0 : /^-?\d+$/.test(s) ? parseInt(s, 10) | 0 : strSeed(s);
    const wid = kw('worlds').push().key;
    let code = null;
    for (let tries = 0; tries < 10 && !code; tries++) {
      let c = ''; for (let i = 0; i < 4; i++) c += CODE_CH[Math.floor(Math.random() * CODE_CH.length)];
      const r = await kw('codes/' + c).transaction(cur => cur === null ? { wid, owner: N.uid } : undefined, undefined, false);
      if (r.committed) code = c;
    }
    if (!code) throw new Error('Kein freier Code gefunden, bitte nochmal versuchen.');
    await kw('worlds/' + wid).set({ owner: N.uid, name: (o.name || 'Online-Welt').slice(0, 30), seed, type: o.type || 'normal', mode: o.mode || 'survival', created: Math.round(serverNow()), code });
    return wid;
  }
  async function widOf(code) {
    await initFirebase();
    const s = await kw('codes/' + code).get(); const v = s.val();
    if (!v || !v.wid) throw new Error('Es gibt keine Welt mit dem Code ' + code + '.');
    return v.wid;
  }
  async function go(fn, status) {
    status('Verbinde …');
    try {
      await initFirebase();
      const wid = await fn();
      status('Welt wird geladen …');
      await enter(wid);
    } catch (e) { console.error(e); disconnect(); if (G.state !== 'play') { UI.show('online'); } UI.toast('Online nicht möglich', errText(e), 0, '#ff7a6a'); }
  }

  /* ---------- menus ---------- */
  const stop = i => { for (const ev of ['keydown', 'keyup', 'keypress']) i.addEventListener(ev, e => e.stopPropagation()); return i; };
  const nameIn = () => stop(h('input', { type: 'text', class: 'txt', maxlength: '16', value: store.get('klotzwelt.netName', '') || ('Spieler' + Math.floor(100 + Math.random() * 900)) }));
  const getName = i => { const n = i.value.trim().replace(/\s+/g, ' ').slice(0, 16) || 'Spieler'; store.set('klotzwelt.netName', n); N.name = n; return n; };

  UI.def('online', (el, data) => {
    const name = nameIn();
    const code = stop(h('input', { type: 'text', class: 'txt', maxlength: '4', placeholder: 'CODE', style: 'text-transform:uppercase;letter-spacing:.3em;text-align:center' }));
    if (data.code) code.value = data.code;
    const status = h('div', { class: 'wempty' }, '');
    const setS = t => { status.textContent = t; };
    const list = h('div', { class: 'wlist' });
    const mine = store.get('klotzwelt.netWorlds', []);
    if (!mine.length) list.append(h('div', { class: 'wempty' }, 'Noch keine Online-Welten. Erstelle eine oder tritt mit einem Code bei.'));
    for (const w of mine) {
      list.append(h('div', { class: 'wrow' }, h('img', { src: iconURL(w.mode === 'creative' ? B.grass : B.stone), alt: '' }),
        h('div', { class: 'winfo' }, h('b', null, w.name), h('span', null, 'Code ' + w.code + ' · ' + (w.mode === 'creative' ? 'Kreativ' : 'Überleben') + (w.owner ? ' · deine Welt' : ''))),
        UI.btn('Spielen', () => { getName(name); go(() => widOf(w.code), setS); }, 'sm')));
    }
    const join = () => { const c = code.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); if (c.length !== 4) { setS('Ein Code hat 4 Zeichen.'); return; } getName(name); go(() => widOf(c), setS); };
    code.addEventListener('keydown', e => { if (e.key === 'Enter') join(); });
    el.append(h('h2', null, 'Online spielen'),
      h('div', { class: 'form' }, h('label', null, 'Dein Name', name),
        h('label', null, 'Code einer Welt', code), UI.btn('Beitreten', join, 'go')),
      status, list,
      h('div', { class: 'row3' }, UI.btn('Neue Online-Welt', () => { getName(name); UI.show('netnew'); }), UI.btn('Zurück', () => G.toTitle())));
    return { overlay: false };
  });
  UI.def('netnew', (el) => {
    const name = stop(h('input', { type: 'text', value: 'Online-Welt', maxlength: '30', class: 'txt' }));
    const seed = stop(h('input', { type: 'text', placeholder: 'leer = zufällig', maxlength: '20', class: 'txt' }));
    const st = { mode: 'survival', type: 'normal' };
    const cyc = (lbl, vals, key, fmt) => { const b = UI.btn('', () => { st[key] = vals[(vals.indexOf(st[key]) + 1) % vals.length]; upd(); }, 'wide'); const upd = () => { b.textContent = lbl + ': ' + fmt(st[key]); }; upd(); return b; };
    const status = h('div', { class: 'wempty' }, 'Jeder mit dem Code kann mitspielen. Die Welt bleibt gespeichert, auch wenn alle offline sind.');
    el.append(h('h2', null, 'Neue Online-Welt'),
      h('div', { class: 'form' }, h('label', null, 'Name', name), h('label', null, 'Seed', seed),
        cyc('Spielmodus', ['survival', 'creative'], 'mode', v => v === 'survival' ? 'Überleben' : 'Kreativ'),
        cyc('Weltentyp', ['normal', 'flat'], 'type', v => v === 'normal' ? 'Normal' : 'Superflach')),
      status,
      h('div', { class: 'row3' }, UI.btn('Welt erstellen', () => go(() => createWorld({ name: name.value.trim(), seed: seed.value, mode: st.mode, type: st.type }), t => { status.textContent = t; }), 'go'),
        UI.btn('Abbrechen', () => UI.show('online'))));
    setTimeout(() => name.select(), 50);
    return { overlay: false };
  });
  const oTitle = UI.screens.title;
  UI.def('title', (el, data) => {
    const r = oTitle(el, data);
    const col = el.querySelector('.menucol');
    if (col) col.insertBefore(UI.btn('Online spielen', () => UI.show('online')), col.children[1] || null);
    return r;
  });
  const oPause = UI.screens.pause;
  UI.def('pause', (el, data) => {
    const r = oPause(el, data);
    if (on()) {
      const n = N.players.size + 1;
      const inv = UI.btn('Einladen (Code ' + N.code + ')', async () => {
        const url = location.origin + location.pathname + '?welt=' + N.code;
        try { await navigator.clipboard.writeText(url); UI.toast('Einladung kopiert', 'Schick den Link oder den Code ' + N.code + ' an deine Freunde.', 0, '#7fcb52'); }
        catch (e) { UI.toast('Code: ' + N.code, url, 0, '#7fcb52'); }
      });
      const info = h('div', { class: 'wempty' }, 'Online · ' + n + (n === 1 ? ' Spieler' : ' Spieler') + ' · ' + [N.name, ...[...N.players.values()].map(p => p.name)].join(', '));
      const col = el.querySelector('.menucol');
      if (col) { col.insertBefore(inv, col.children[1] || null); col.insertBefore(info, inv); }
      const exp = [...el.querySelectorAll('button')].find(b => /Datei sichern/.test(b.textContent)); if (exp) exp.remove();
      const quit = [...el.querySelectorAll('button')].find(b => /zum Titel/.test(b.textContent)); if (quit) quit.textContent = 'Welt verlassen';
    }
    return r;
  });

  // the title screen may already be up (the game boots before this script runs)
  if (UI.cur && UI.cur.name === 'title') UI.show('title');

  // invite link: ?welt=CODE opens the online screen with the code filled in
  const inv = new URLSearchParams(location.search).get('welt');
  if (inv) { const t0 = Date.now(); const wait = () => { if (G.state === 'title') UI.show('online', { code: inv.toUpperCase().slice(0, 4) }); else if (Date.now() - t0 < 20000) setTimeout(wait, 200); }; wait(); }

  window.KWNet = { N, on };
})();
