/* Klotzwelt · Minikarte (Taste N: klein → groß → aus) und Kompass-Nadel.
   The map is drawn from the chunks that are loaded anyway: one colour per column (top block, tinted like the biome),
   a little darker where the ground drops. Online, other players show up as coloured dots with their name. */
(() => {
  'use strict';
  const KEY = 'klotzwelt.map';
  let mode = 1; try { const v = +localStorage.getItem(KEY); if (v >= 0 && v <= 2 && localStorage.getItem(KEY) !== null) mode = v; } catch (e) { }
  const wrap = h('div', { style: 'position:fixed;top:10px;right:10px;z-index:20;pointer-events:none;display:none' });
  const cv = h('canvas', { width: 160, height: 160, style: 'display:block;image-rendering:pixelated;border:2px solid rgba(0,0,0,.6);background:#10131a' });
  const label = h('div', { style: 'font:12px monospace;color:#fff;text-shadow:1px 1px 0 #000;text-align:center;margin-top:2px' }, '');
  wrap.append(cv, label); document.body.append(wrap);
  const g = cv.getContext('2d');

  // average colour of a block's top texture
  const colC = new Map();
  function blockCol(id, bio) {
    const k = id * 32 + (bio | 0); let c = colC.get(k); if (c) return c;
    const d = BD[id]; let r = 0, gg = 0, b = 0, n = 0;
    if (id === B.water) c = [52, 92, 200];
    else if (id === B.lava) c = [230, 110, 20];
    else {
      let tile = 0; try { tile = d.texf ? faceTileOf(id, 2, 0)[0] : FTILE[id * 6 + 2]; } catch (e) { }
      const t = ATLAS.tiles[tile];
      if (t) for (let i = 0; i < 256; i++) { if (t.d[i * 4 + 3] < 60) continue; r += t.d[i * 4]; gg += t.d[i * 4 + 1]; b += t.d[i * 4 + 2]; n++; }
      c = n ? [r / n, gg / n, b / n] : [128, 128, 128];
      const tint = d.tint === 'grass' ? TG_RGB[bio] || TG_RGB[2] : d.tint === 'foliage' || d.leaf === 'oak' ? TF_RGB[bio] || TF_RGB[2] : null;
      if (tint) c = [c[0] * tint[0] / 200, c[1] * tint[1] / 200, c[2] * tint[2] / 200];
    }
    colC.set(k, c); return c;
  }
  // per-chunk 16×16 picture, refreshed now and then
  const cache = new Map();   // key → { img, t, cx, cz }
  function chunkImg(ch) {
    const img = new ImageData(16, 16), d = img.data, hs = new Int16Array(256);
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const col = (z << 4) | x; let y = Math.min(WH - 1, ch.maxY), id = 0;
      for (; y > 0; y--) { id = ch.b[(y << 8) | col]; if (id && (CLS[id] !== C_CROSS || LIQ[id]) && id !== B.snow && id !== B.tall_grass && id !== B.lily_pad && !(BD[id].plant && CLS[id] === C_CROSS)) break; }
      hs[col] = y;
      let c = blockCol(id, ch.biome[col]);
      if (id === B.water) { let dp = 0; while (dp < 8 && ch.b[((y - dp - 1) << 8) | col] === B.water) dp++; c = [c[0] * (1 - dp * .06), c[1] * (1 - dp * .05), c[2] * (1 - dp * .03)]; }
      const i = col * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
    }
    // relief: darker where the column to the north is higher
    for (let z = 1; z < 16; z++) for (let x = 0; x < 16; x++) { const a = hs[(z << 4) | x], n = hs[((z - 1) << 4) | x], i = ((z << 4) | x) * 4, f = a < n ? .82 : a > n ? 1.1 : 1; d[i] *= f; d[i + 1] *= f; d[i + 2] *= f; }
    const c = document.createElement('canvas'); c.width = c.height = 16; c.getContext('2d').putImageData(img, 0, 0);
    return c;
  }
  let budgetT = 0;
  function draw() {
    const w = G.world, P = G.player; if (!w || !P) return;
    const big = mode === 2, S = big ? 300 : 160, scale = big ? 2 : 1;
    if (cv.width !== S) { cv.width = cv.height = S; }
    g.imageSmoothingEnabled = false; g.fillStyle = '#10131a'; g.fillRect(0, 0, S, S);
    const half = S / 2 / scale, px = P.x, pz = P.z, now = performance.now();
    let built = 0;
    for (let cz = Math.floor((pz - half) / 16); cz <= Math.floor((pz + half) / 16); cz++) for (let cx = Math.floor((px - half) / 16); cx <= Math.floor((px + half) / 16); cx++) {
      const ch = w.chunks.get(CKEY(cx, cz)); if (!ch || ch.state < 1) continue;
      const k = CKEY(cx, cz); let e = cache.get(k);
      if ((!e || (now - e.t > 4000 && built < 1)) && built < 3) { e = { img: chunkImg(ch), t: now + Math.random() * 800 }; cache.set(k, e); built++; }
      if (!e) continue;
      g.drawImage(e.img, Math.round((cx * 16 - px + half) * scale), Math.round((cz * 16 - pz + half) * scale), 16 * scale, 16 * scale);
    }
    if (cache.size > 900) { for (const k of cache.keys()) { cache.delete(k); if (cache.size < 600) break; } }
    const dot = (x, z, col, r, txt) => {
      let sx = (x - px + half) * scale, sz = (z - pz + half) * scale; const edge = sx < 3 || sz < 3 || sx > S - 3 || sz > S - 3;
      sx = Math.max(3, Math.min(S - 3, sx)); sz = Math.max(3, Math.min(S - 3, sz));
      g.fillStyle = '#000'; g.fillRect(sx - r - 1, sz - r - 1, 2 * r + 2, 2 * r + 2); g.fillStyle = col; g.fillRect(sx - r, sz - r, 2 * r, 2 * r);
      if (txt && !edge) { g.font = '10px monospace'; g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 3; g.strokeText(txt, sx + 5, sz + 3); g.fillText(txt, sx + 5, sz + 3); }
    };
    const m = G.meta || {};
    if (m.bed) dot(m.bed.x + .5, m.bed.z + .5, '#e84a4a', 2, big ? 'Bett' : '');
    if (m.spawn) dot(m.spawn.x, m.spawn.z, '#ffe9a8', 2, big ? 'Spawn' : '');
    const net = window.KWNet;
    if (net && net.on()) for (const [uid, p] of net.N.players) { const a = net.N.avatars.get(uid); dot(a ? a.x : +p.x || 0, a ? a.z : +p.z || 0, '#' + ((Math.abs([...uid].reduce((q, c) => q * 31 + c.charCodeAt(0) | 0, 7)) % 0xaaaaaa) + 0x444444).toString(16).slice(-6), 3, p.name || '?'); }
    // you: an arrow pointing where you look
    const cx0 = S / 2, cz0 = S / 2, a = -P.yaw;
    g.save(); g.translate(cx0, cz0); g.rotate(a);
    g.beginPath(); g.moveTo(0, -7); g.lineTo(5, 5); g.lineTo(0, 2); g.lineTo(-5, 5); g.closePath(); g.fillStyle = '#fff'; g.fill(); g.lineWidth = 1.5; g.strokeStyle = '#000'; g.stroke();
    g.restore();
    g.font = 'bold 11px monospace'; g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 3; g.strokeText('N', S / 2 - 3, 11); g.fillText('N', S / 2 - 3, 11);
    label.textContent = Math.floor(P.x) + ' / ' + Math.floor(P.y) + ' / ' + Math.floor(P.z) + (w.biomeAt ? ' · ' + (BIO_NAMES[w.biomeAt(Math.floor(P.x), Math.floor(P.z))] || '') : '');
  }

  /* ---------- compass needle while a compass is held ---------- */
  const comp = h('canvas', { width: 64, height: 64, style: 'position:fixed;left:50%;bottom:128px;transform:translateX(-50%);z-index:20;pointer-events:none;display:none;image-rendering:pixelated;width:64px;height:64px' });
  const compTxt = h('div', { style: 'position:fixed;left:50%;bottom:112px;transform:translateX(-50%);z-index:20;pointer-events:none;display:none;font:12px monospace;color:#fff;text-shadow:1px 1px 0 #000' });
  document.body.append(comp, compTxt);
  const cg = comp.getContext('2d');
  function drawCompass() {
    const P = G.player, m = G.meta || {}, held = Inv.held();
    const show = G.state === 'play' && held && held.id === I.compass && !UI.isOpen();
    comp.style.display = compTxt.style.display = show ? 'block' : 'none'; if (!show) return;
    const t = m.bed ? { x: m.bed.x + .5, z: m.bed.z + .5, n: 'Bett' } : m.spawn ? { x: m.spawn.x, z: m.spawn.z, n: 'Spawn' } : { x: 0, z: 0, n: 'Spawn' };
    const dx = t.x - P.x, dz = t.z - P.z, dist = Math.hypot(dx, dz);
    // angle of the target relative to where you look (0 = straight ahead)
    const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw), rx = Math.cos(P.yaw), rz = -Math.sin(P.yaw);
    const rel = Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz);
    cg.clearRect(0, 0, 64, 64); cg.fillStyle = 'rgba(0,0,0,.45)'; cg.beginPath(); cg.arc(32, 32, 30, 0, 7); cg.fill();
    cg.strokeStyle = '#9aa0aa'; cg.lineWidth = 3; cg.beginPath(); cg.arc(32, 32, 28, 0, 7); cg.stroke();
    cg.save(); cg.translate(32, 32); cg.rotate(dist < 1.5 ? performance.now() / 300 : rel);
    cg.fillStyle = '#e03a3a'; cg.beginPath(); cg.moveTo(0, -22); cg.lineTo(5, 0); cg.lineTo(-5, 0); cg.fill();
    cg.fillStyle = '#e8e8e8'; cg.beginPath(); cg.moveTo(0, 22); cg.lineTo(5, 0); cg.lineTo(-5, 0); cg.fill();
    cg.restore();
    compTxt.textContent = t.n + ' · ' + Math.round(dist) + ' m';
  }

  addEventListener('keydown', e => {
    if (e.code !== 'KeyN' || e.repeat || (G.state !== 'play' && G.state !== 'dead') || G.chatOpen || UI.cur) return;
    mode = (mode + 1) % 3; try { localStorage.setItem(KEY, String(mode)); } catch (er) { }
    UI.msg(mode === 0 ? 'Karte aus (N)' : mode === 1 ? 'Minikarte (N)' : 'Große Karte (N)', '#bfe6ff');
  });
  let last = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    const vis = mode > 0 && (G.state === 'play' || G.state === 'dead') && !!G.world && UI.hudOn !== false;
    wrap.style.display = vis ? 'block' : 'none';
    if (G.state === 'title') cache.clear();
    if (vis && now - last > (mode === 2 ? 120 : 180)) { last = now; try { draw(); } catch (e) { console.error(e); } }
    try { drawCompass(); } catch (e) { }
  }
  requestAnimationFrame(loop);
  window.KWMap = { cache };
})();
