/* Klotzwelt · Skins.
   Every skin is a 64×64 PNG in the usual block-figure layout (head 8×8×8, body 8×12×4, arms 4×12×4 or 3×12×4 for slim arms,
   legs 4×12×4, plus a second, slightly bigger "overlay" layer for hats, jackets and so on). Old 64×32 skins work too.
   The built-in skins are drawn here pixel by pixel; your own skin is stored in this browser and, online, sent to the others. */
(() => {
  'use strict';
  const KEY = 'klotzwelt.skin';
  const store = {
    get() { try { const v = localStorage.getItem(KEY); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
    set(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); return true; } catch (e) { return false; } }
  };

  /* ---------- layout ---------- */
  // [u, v, w, h, d] for each part, base layer and overlay layer
  const PARTS = {
    head: { base: [0, 0, 8, 8, 8], over: [32, 0, 8, 8, 8] },
    body: { base: [16, 16, 8, 12, 4], over: [16, 32, 8, 12, 4] },
    armR: { base: [40, 16, 4, 12, 4], over: [40, 32, 4, 12, 4] },
    armL: { base: [32, 48, 4, 12, 4], over: [48, 48, 4, 12, 4] },
    legR: { base: [0, 16, 4, 12, 4], over: [0, 32, 4, 12, 4] },
    legL: { base: [16, 48, 4, 12, 4], over: [0, 48, 4, 12, 4] }
  };
  // face rects of a box in the net: top, bottom, right, front, left, back
  function faces(u, v, w, h, d) {
    return { top: [u + d, v, w, d], bottom: [u + d + w, v, w, d], right: [u, v + d, d, h], front: [u + d, v + d, w, h], left: [u + d + w, v + d, d, h], back: [u + 2 * d + w, v + d, w, h] };
  }

  /* ---------- built-in skins (original designs, drawn here) ---------- */
  function paint(o) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    const R = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
    const box = (p, col, layer) => { const [u, v, w, h, d] = PARTS[p][layer || 'base'], f = faces(u, v, w, h, d); for (const k in f) R(...f[k], col); return f; };
    const shade = (p, layer) => { const [u, v, w, h, d] = PARTS[p][layer || 'base'], f = faces(u, v, w, h, d); g.fillStyle = 'rgba(0,0,0,.14)'; g.fillRect(...f.bottom); g.fillRect(...f.left); g.fillRect(...f.back); };
    // head
    const H = box('head', o.skin);
    R(H.top[0], H.top[1], 8, 8, o.hair);
    R(H.back[0], H.back[1], 8, o.long ? 7 : 3, o.hair); R(H.right[0], H.right[1], 8, o.long ? 6 : 2, o.hair); R(H.left[0], H.left[1], 8, o.long ? 6 : 2, o.hair);
    const F = H.front;
    R(F[0], F[1], 8, o.fringe || 2, o.hair);
    if (o.visor) { R(F[0] + 1, F[1] + 3, 6, 2, o.visor); R(F[0] + 1, F[1] + 3, 6, 1, o.visor2 || o.visor); }
    else {
      R(F[0] + 1, F[1] + 4, 2, 1, '#ffffff'); R(F[0] + 5, F[1] + 4, 2, 1, '#ffffff');
      R(F[0] + 2, F[1] + 4, 1, 1, o.eyes); R(F[0] + 5, F[1] + 4, 1, 1, o.eyes);
      R(F[0] + 3, F[1] + 6, 2, 1, o.mouth || '#9a5a4a');
    }
    shade('head');
    // body
    const Bd = box('body', o.shirt);
    if (o.stripe) { R(Bd.front[0], Bd.front[1] + 5, 8, 2, o.stripe); R(Bd.back[0], Bd.back[1] + 5, 8, 2, o.stripe); R(Bd.right[0], Bd.right[1] + 5, 4, 2, o.stripe); R(Bd.left[0], Bd.left[1] + 5, 4, 2, o.stripe); }
    if (o.belt) { for (const k of ['front', 'back', 'right', 'left']) R(Bd[k][0], Bd[k][1] + 11, Bd[k][2], 1, o.belt); }
    if (o.zip) R(Bd.front[0] + 3, Bd.front[1], 2, 12, o.zip);
    if (o.logo) { R(Bd.front[0] + 2, Bd.front[1] + 2, 4, 3, o.logo); R(Bd.front[0] + 3, Bd.front[1] + 3, 2, 1, o.shirt); }
    shade('body');
    // arms: sleeve on top, hand at the bottom
    for (const p of ['armR', 'armL']) {
      const A = box(p, o.sleeve || o.shirt);
      for (const k of ['front', 'back', 'right', 'left']) R(A[k][0], A[k][1] + (o.short ? 4 : 9), A[k][2], o.short ? 8 : 3, o.hand || o.skin);
      R(...A.bottom, o.hand || o.skin);
      if (o.cuff) for (const k of ['front', 'back', 'right', 'left']) R(A[k][0], A[k][1] + (o.short ? 3 : 8), A[k][2], 1, o.cuff);
      shade(p);
    }
    // legs: trousers and shoes
    for (const p of ['legR', 'legL']) {
      const L = box(p, o.pants);
      for (const k of ['front', 'back', 'right', 'left']) R(L[k][0], L[k][1] + 10, L[k][2], 2, o.shoes);
      R(...L.bottom, o.shoes);
      if (o.knee) R(L.front[0], L.front[1] + 5, 4, 1, o.knee);
      shade(p);
    }
    // overlay layer: hat / hood
    if (o.hat) {
      const T = box('head', 'rgba(0,0,0,0)', 'over');
      R(T.top[0], T.top[1], 8, 8, o.hat);
      for (const k of ['front', 'back', 'right', 'left']) R(T[k][0], T[k][1], T[k][2], o.hatH || 2, o.hat);
      if (o.hood) { R(T.back[0], T.back[1], 8, 8, o.hat); R(T.right[0], T.right[1], 8, 7, o.hat); R(T.left[0], T.left[1], 8, 7, o.hat); }
      if (o.hatBand) for (const k of ['front', 'back', 'right', 'left']) R(T[k][0], T[k][1] + (o.hatH || 2) - 1, T[k][2], 1, o.hatBand);
    }
    if (o.glow) { // little neon edge on the jacket overlay
      const J = faces(...PARTS.body.over);
      R(J.front[0], J.front[1], 1, 12, o.glow); R(J.front[0] + 7, J.front[1], 1, 12, o.glow);
    }
    return c;
  }
  const PRESETS = [
    { id: 'b0', name: 'Klotzi', o: { skin: '#d8a07a', hair: '#e2b84a', eyes: '#2a7a6a', shirt: '#2e9a7a', pants: '#4a3a6a', shoes: '#d0d0d4', stripe: '#f0a030', fringe: 3 } },
    { id: 'b1', name: 'Neon', o: { skin: '#f0c8a8', hair: '#ff3fa8', eyes: '#18c8e8', shirt: '#201a34', sleeve: '#201a34', pants: '#141020', shoes: '#ff3fa8', zip: '#18e8f0', cuff: '#18e8f0', glow: '#ff3fa8', long: 1, fringe: 3 } },
    { id: 'b2', name: 'Kassette', o: { skin: '#c89070', hair: '#1e1a18', eyes: '#2a2018', shirt: '#e2862e', pants: '#5a3a24', shoes: '#2a201a', logo: '#2a2a30', belt: '#2a201a', short: 1 } },
    { id: 'b3', name: 'Wanderin', o: { skin: '#e8bc98', hair: '#a8582a', eyes: '#2e7a3a', shirt: '#3a6a34', pants: '#5a4a30', shoes: '#4a3420', belt: '#8a6a3a', long: 1, hat: '#2e5a2a', hood: 1, hatH: 3 } },
    { id: 'b4', name: 'Robo', o: { skin: '#9aa0aa', hair: '#7a808a', eyes: '#000', visor: '#28e0ff', visor2: '#a8f4ff', shirt: '#6a707a', pants: '#4a505a', shoes: '#30343a', hand: '#b8bec8', stripe: '#ffb020', knee: '#ffb020', mouth: '#4a505a' } },
    { id: 'b5', name: 'Taucherin', o: { skin: '#8a5a3e', hair: '#1a1210', eyes: '#1a1210', shirt: '#1a5a8a', pants: '#1a5a8a', shoes: '#f0d040', stripe: '#f0d040', hat: '#f0d040', hatH: 2, hatBand: '#1a1a1a', long: 1 } },
    { id: 'b6', name: 'Koch', o: { skin: '#f2cca8', hair: '#d8c8a8', eyes: '#3a3a3a', shirt: '#f4f4f0', pants: '#2a2a2e', shoes: '#1a1a1a', zip: '#c03a32', hat: '#ffffff', hatH: 3 } },
    { id: 'b7', name: 'Nachtwache', o: { skin: '#d8a880', hair: '#2a2a32', eyes: '#c8a020', shirt: '#2a2a3a', sleeve: '#3a3a4e', pants: '#1e1e28', shoes: '#120e0e', belt: '#c8a020', cuff: '#c8a020', hat: '#1e1e28', hatH: 2, hatBand: '#c8a020' } }
  ];
  const presetCanvas = new Map();
  function preset(id) { const p = PRESETS.find(q => q.id === id) || PRESETS[0]; let c = presetCanvas.get(p.id); if (!c) { c = paint(p.o); presetCanvas.set(p.id, c); } return c; }

  /* ---------- loading your own ---------- */
  // turns any 64×64 / 64×32 image into a 64×64 canvas (old skins get their left arm and leg copied from the right ones)
  function normalize(img) {
    const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    if (w !== 64 || (h !== 64 && h !== 32)) throw new Error('Ein Skin muss 64×64 oder 64×32 Pixel groß sein (dieses Bild: ' + w + '×' + h + ').');
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
    g.drawImage(img, 0, 0);
    if (h === 32) { g.drawImage(img, 40, 16, 16, 16, 32, 48, 16, 16); g.drawImage(img, 0, 16, 16, 16, 16, 48, 16, 16); }
    return c;
  }
  // slim arms: in a 64×64 skin the right arm's front stops after 3 pixels (the 4th column is see-through)
  function looksSlim(c) { try { const d = c.getContext('2d').getImageData(54, 20, 1, 1).data; return d[3] === 0; } catch (e) { return false; } }
  function loadURL(url) {
    return new Promise((res, rej) => { const i = new Image(); i.onload = () => { try { res(normalize(i)); } catch (e) { rej(e); } }; i.onerror = () => rej(new Error('Das Bild konnte nicht gelesen werden.')); i.src = url; });
  }
  const urlCanvas = new Map();
  // a skin reference is "b3" (built-in) or a PNG data URL
  function canvasFor(ref) {
    if (!ref || typeof ref !== 'string') return Promise.resolve(preset('b0'));
    if (ref[0] === 'b' && ref.length <= 4) return Promise.resolve(preset(ref));
    if (!/^data:image\/png;base64,/.test(ref)) return Promise.resolve(preset('b0'));
    let p = urlCanvas.get(ref); if (!p) { p = loadURL(ref).catch(() => preset('b0')); urlCanvas.set(ref, p); if (urlCanvas.size > 40) urlCanvas.delete(urlCanvas.keys().next().value); }
    return p;
  }
  function mine() { const v = store.get(); return v && v.ref ? v : { ref: 'b0', slim: false }; }

  /* ---------- 3D model ---------- */
  const S = 1.8 / 32;   // one skin pixel in blocks (the figure is 32 pixels tall)
  function uvBox(w, h, d, u, v, inflate) {
    const k = inflate || 0, geo = new THREE.BoxGeometry((w + k) * S, (h + k) * S, (d + k) * S);
    const f = faces(u, v, w, h, d), uv = geo.attributes.uv;
    const set = (face, r, flipU, flipV) => {
      let [x, y, rw, rh] = r; let u0 = x / 64, u1 = (x + rw) / 64, v0 = 1 - y / 64, v1 = 1 - (y + rh) / 64;
      if (flipU) [u0, u1] = [u1, u0]; if (flipV) [v0, v1] = [v1, v0];
      const i = face * 4; uv.setXY(i, u0, v0); uv.setXY(i + 1, u1, v0); uv.setXY(i + 2, u0, v1); uv.setXY(i + 3, u1, v1);
    };
    // BoxGeometry face order: +x, -x, +y, -y, +z, -z. The figure looks towards -z, so its right side is +x.
    set(0, f.right); set(1, f.left); set(2, f.top, true, true); set(3, f.bottom, true, false); set(4, f.back); set(5, f.front);
    uv.needsUpdate = true;
    return geo;
  }
  function texOf(canvas) { const t = new THREE.CanvasTexture(canvas); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; return t; }
  // builds the figure into `root`; returns the moving parts. Feet at y = 0, looking towards -z.
  function buildFigure(root, canvas, slim) {
    const tex = texOf(canvas);
    const base = new THREE.MeshBasicMaterial({ map: tex, alphaTest: .5 }), over = new THREE.MeshBasicMaterial({ map: tex, alphaTest: .5, side: THREE.DoubleSide });
    base.userData.base = new THREE.Color(1, 1, 1); over.userData.base = new THREE.Color(1, 1, 1);
    const part = (name, px, py, pz, cx, cy, cz, aw) => {
      const pivot = new THREE.Group(); pivot.position.set(px * S, py * S, pz * S); root.add(pivot);
      const [u, v, w, h, d] = PARTS[name].base, [ou, ov] = PARTS[name].over, W = aw || w;
      const m = new THREE.Mesh(uvBox(W, h, d, u, v), base); m.position.set(cx * S, cy * S, cz * S); pivot.add(m);
      const o = new THREE.Mesh(uvBox(W, h, d, ou, ov, name === 'head' ? 1 : .5), over); o.position.copy(m.position); pivot.add(o);
      return pivot;
    };
    const aw = slim ? 3 : 4, ax = 4 + aw / 2;
    const P = {
      legR: part('legR', 2, 12, 0, 0, -6, 0), legL: part('legL', -2, 12, 0, 0, -6, 0),
      body: part('body', 0, 18, 0, 0, 0, 0),
      armR: part('armR', ax, 22, 0, 0, -4, 0, aw), armL: part('armL', -ax, 22, 0, 0, -4, 0, aw),
      head: part('head', 0, 24, 0, 0, 4, 0)
    };
    return { P, mats: [base, over], tex };
  }
  // a flat front view for menus
  function preview(canvas, slim, scale) {
    const k = scale || 4, c = document.createElement('canvas'); c.width = 16 * k; c.height = 32 * k; const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
    const blit = (part, layer, dx, dy, w) => { const [u, v, pw, h, d] = PARTS[part][layer]; const f = faces(u, v, w || pw, h, d).front; g.drawImage(canvas, f[0], f[1], f[2], f[3], dx * k, dy * k, f[2] * k, f[3] * k); };
    const aw = slim ? 3 : 4;
    for (const layer of ['base', 'over']) {
      blit('head', layer, 4, 0); blit('body', layer, 4, 8); blit('armR', layer, 4 - aw, 8, aw); blit('armL', layer, 12, 8, aw); blit('legR', layer, 4, 20); blit('legL', layer, 8, 20);
    }
    c.className = 'skinpv'; return c;
  }

  /* ---------- menu ---------- */
  const css = document.createElement('style');
  css.textContent = '.skingrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:8px;width:min(640px,92vw);box-sizing:border-box;max-height:40vh;overflow:auto;padding:4px;margin:8px 0}' +
    '.skincell{display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px 4px;background:rgba(0,0,0,.35);border:2px solid #555;cursor:pointer;color:#ddd;font-size:13px}' +
    '.skincell.on{border-color:#ffe9a8;background:rgba(255,233,168,.12);color:#fff}.skincell canvas{width:48px;height:96px;image-rendering:pixelated}' +
    '.skinrow{display:flex;gap:16px;align-items:center;justify-content:center;flex-wrap:wrap}.skinbig canvas{width:64px;height:128px;image-rendering:pixelated}';
  document.head.appendChild(css);

  UI.def('skins', (el, data) => {
    let cur = mine();
    const big = h('div', { class: 'skinbig' }), info = h('div', { class: 'wempty' }, '');
    const grid = h('div', { class: 'skingrid' });
    const show = async () => { const c = await canvasFor(cur.ref); big.replaceChildren(preview(c, cur.slim, 5)); };
    const choose = (ref, slim) => { cur = { ref, slim: !!slim }; store.set(cur); fill(); show(); slimBtn.textContent = 'Arme: ' + (cur.slim ? 'schmal' : 'normal'); if (window.KWNet && KWNet.skinChanged) KWNet.skinChanged(); };
    function fill() {
      grid.replaceChildren();
      for (const p of PRESETS) {
        const cell = h('div', { class: 'skincell' + (cur.ref === p.id ? ' on' : '') }, preview(preset(p.id), false, 2), h('span', null, p.name));
        cell.addEventListener('click', () => choose(p.id, false)); grid.append(cell);
      }
      const own = store.get() && store.get().own;
      if (own) {
        const cell = h('div', { class: 'skincell' + (cur.ref === own ? ' on' : '') }, h('span', null, 'Eigener'));
        canvasFor(own).then(c => cell.prepend(preview(c, cur.ref === own ? cur.slim : looksSlim(c), 2)));
        cell.addEventListener('click', () => { const s = store.get() || {}; choose(own, s.ownSlim); }); grid.append(cell);
      }
    }
    const file = h('input', { type: 'file', accept: 'image/png', style: 'display:none' });
    file.addEventListener('change', async () => {
      const f = file.files[0]; file.value = ''; if (!f) return;
      if (f.size > 64 * 1024) { info.textContent = 'Die Datei ist zu groß (höchstens 64 KB).'; return; }
      const url = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); });
      try {
        const c = await loadURL(url);
        const png = c.toDataURL('image/png');   // re-encoded: always 64×64, no extra data
        if (png.length > 20000) { info.textContent = 'Dieser Skin ist zu detailreich für das Online-Spiel (zu viele Daten).'; return; }
        const slim = looksSlim(c);
        const s = store.get() || {}; s.own = png; s.ownSlim = slim; store.set(s);
        urlCanvas.set(png, Promise.resolve(c));
        choose(png, slim);
        info.textContent = 'Skin geladen' + (slim ? ' (schmale Arme erkannt).' : '.');
      } catch (e) { info.textContent = e.message || String(e); }
    });
    const slimBtn = UI.btn('Arme: ' + (cur.slim ? 'schmal' : 'normal'), () => choose(cur.ref, !cur.slim));
    fill(); show();
    el.append(h('h2', null, 'Skin'),
      h('div', { class: 'skinrow' }, big, h('div', { class: 'wempty', style: 'max-width:320px;text-align:left' },
        'Wähle einen Skin oder lade deinen eigenen hoch: eine PNG-Datei mit 64×64 Pixeln im üblichen Skin-Layout (64×32 geht auch). Online sehen alle anderen deinen Skin.')),
      grid, info,
      h('div', { class: 'row3' }, UI.btn('Eigenen Skin hochladen', () => file.click(), 'go'), slimBtn, UI.btn('Fertig', () => { if (data && data.back) UI.show(data.back); else G.toTitle(); })),
      file);
    return { overlay: false };
  });
  // a "Skin" button on the title screen and in the pause menu
  const addBtn = (screen, back) => {
    const o = UI.screens[screen]; if (!o) return;
    UI.def(screen, (el, data) => { const r = o(el, data); const col = el.querySelector('.menucol'); if (col) col.insertBefore(UI.btn('Skin', () => UI.show('skins', { back })), col.children[back === 'pause' ? 2 : 1] || null); return r; });
  };
  addBtn('title', 'title'); addBtn('pause', 'pause');
  if (UI.cur && UI.cur.name === 'title') UI.show('title');

  window.KWSkin = { PRESETS, preset, canvasFor, mine, buildFigure, preview, looksSlim };
})();
