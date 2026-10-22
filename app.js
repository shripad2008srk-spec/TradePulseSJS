'use strict';

/* =====================================================
   Trade Pulse – demo app
   - Login/registration with salted PBKDF2 hashes, session expiry and lockout
   - Group deals with tiered pricing inside a 50 km corridor
   - Simulated escrow: funds locked, then released on delivery
   All data lives in this browser's localStorage (demo only).
   ===================================================== */

/* ---------- Config ---------- */
const CORRIDOR_KM = 50;
const CFG = window.TRADEPULSE_CONFIG || window.CLUSTERBUY_CONFIG || {};
const GOOGLE_CLIENT_ID = String(CFG.googleClientId || '').trim();
const MAPS_KEY = String(CFG.googleMapsApiKey || '').trim();
const HUB = Object.assign({ name: 'Factory hub', lat: 18.5204, lng: 73.8567 }, CFG.hub || {});
const SESSION_MS = 30 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const LOCK_MS = 30 * 1000;
const K = { users: 'tp_users', session: 'tp_session', deals: 'tp_deals', orders: 'tp_orders', lock: 'tp_lock' };

const PEERS = [
  { name: 'Omkar Tooling', km: 6, a: 20 },
  { name: 'Patil Castings', km: 11, a: 75 },
  { name: 'Gajanan Forgings', km: 17, a: 140 },
  { name: 'Sai Powder Coaters', km: 23, a: 200 },
  { name: 'Mehta Packaging', km: 29, a: 255 },
  { name: 'Jadhav Machining', km: 34, a: 300 },
  { name: 'Kulkarni Fabricators', km: 41, a: 340 },
  { name: 'Deshmukh Wire Works', km: 47, a: 50 }
];

function seedDeals() {
  const deal = (id, category, title, supplier, note, unit, base, minQty, tiers, pool, buyers, daysLeft) =>
    ({ id, category, title, supplier, note, unit, base, minQty, tiers: tiers.map(([qty, price]) => ({ qty, price })), pool, buyers, daysLeft, status: 'open' });
  // Sample products, suppliers and prices for the demo.
  return [
    deal('d4', 'Packaging', 'Kraft paper carry bags (medium)', 'Shivam Paper Products',
      '12 × 15 in, 100 GSM, flat handle. Bundle of 50.', 'pcs', 6, 500, [[5000, 5], [10000, 4.5], [25000, 4]], 2100, 7, 5),
    deal('d5', 'Stationery', 'Thermal receipt rolls (79 mm × 50 m)', 'Rupa Thermal Papers',
      'For billing printers. Pack of 50 rolls.', 'rolls', 48, 50, [[1000, 40], [3000, 37], [6000, 34]], 620, 5, 8),
    deal('d6', 'Packaging', 'Clear packing tape (48 mm × 65 m)', 'Nirmal Adhesive Tapes',
      'BOPP tape. Carton of 72 rolls.', 'rolls', 32, 24, [[1200, 27], [3600, 25], [7200, 23]], 900, 6, 6),
    deal('d3', 'Packaging', '5-ply corrugated cartons (18 × 12 × 10 in)', 'Kalyan Packaging',
      'Ships flat. Holds a 10 kg parcel.', 'pcs', 38, 100, [[1000, 32], [3000, 29], [6000, 26.5]], 1450, 9, 3),
    deal('d9', 'Electricals', 'LED bulb 9 W (B22, BIS marked)', 'Lumina Electricals',
      '6500 K cool white, 1-year replacement. Box of 100.', 'pcs', 52, 100, [[2000, 41], [5000, 37], [10000, 34]], 2300, 8, 4),
    deal('d10', 'Electricals', 'Extension board, 4 sockets with switch', 'Volt Plastics',
      '1.5 m cord, surge guard, 5 A.', 'pcs', 185, 20, [[500, 158], [1200, 148], [2500, 138]], 380, 4, 9),
    deal('d7', 'Household', 'Floor cleaner, pine (5 L can)', 'Sunrise Chemicals',
      'Concentrated, 5 litre can. Carton of 4.', 'cans', 165, 8, [[400, 140], [1000, 128], [2000, 118]], 260, 4, 7),
    deal('d8', 'Household', 'Steel storage containers (set of 3)', 'Jai Ambe Steelware',
      'Stainless steel with airtight lids.', 'sets', 420, 12, [[300, 365], [800, 340], [1500, 318]], 210, 3, 10),
    deal('d11', 'Food staples', 'Refined sunflower oil (15 L tin)', 'Annapurna Oil Mills',
      'Packed at the mill, 15 litre tin.', 'tins', 1950, 5, [[100, 1860], [250, 1820], [500, 1780]], 62, 5, 4),
    deal('d12', 'Food staples', 'Chakki atta (50 kg bag)', 'Ganga Flour Mills',
      'Whole wheat, milled in the corridor.', 'bags', 1850, 5, [[200, 1760], [500, 1725], [1000, 1690]], 130, 6, 5),
    deal('d13', 'Stationery', 'A4 ruled notebooks (172 pages)', 'Gyan Paper Mills',
      'Bundle of 12, 70 GSM pages.', 'pcs', 44, 120, [[2000, 36], [5000, 33], [10000, 30]], 2600, 11, 6),
    deal('d1', 'Hardware', 'HT bolts M8 × 40 (grade 8.8)', 'Apex Fasteners',
      'Zinc plated. Box of 100.', 'pcs', 6.5, 500, [[5000, 5.2], [10000, 4.7], [20000, 4.25]], 3200, 6, 6),
    deal('d2', 'Hardware', 'MS sheet 2 mm (IS 2062)', 'Bharat Steel Rollers',
      'Cut sheets with mill test certificate.', 'kg', 68, 200, [[2000, 61], [5000, 57.5], [10000, 54]], 1350, 4, 9)
  ];
}

/* ---------- Helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = v => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = n => '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const num = n => Number(n).toLocaleString('en-IN');
const read = (k, fallback) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? fallback; } catch { return fallback; } };
const write = (k, v) => localStorage.setItem(k, JSON.stringify(v));
const toHex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const randomHex = (n = 16) => toHex(crypto.getRandomValues(new Uint8Array(n)));

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3600);
}

/* ---------- Password hashing ---------- */
async function hashPassword(password, salt) {
  const enc = new TextEncoder();
  if (window.crypto && crypto.subtle) {
    const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256' }, key, 256);
    return toHex(bits);
  }
  // Fallback for non-secure contexts (weak, demo only)
  let h = 5381;
  for (const b of enc.encode(salt + ':' + password)) h = ((h << 5) + h + b) >>> 0;
  return 'fallback-' + h.toString(16);
}

/* ---------- Seed + session ---------- */
async function seed() {
  if (!read(K.users)) {
    const salt = randomHex();
    write(K.users, [{
      email: 'demo@msme.in', biz: 'Shree Engineering Works', km: 18,
      salt, hash: await hashPassword('Demo@1234', salt)
    }]);
  }
  // Add any new catalogue deals to data saved by an earlier version
  const merged = read(K.deals, []);
  seedDeals().forEach(sd => {
    const cur = merged.find(d => d.id === sd.id);
    if (!cur) merged.push(sd);
    else { cur.category = sd.category; cur.note = sd.note; }
  });
  write(K.deals, merged);
  if (!read(K.orders)) write(K.orders, []);
}

const session = () => { const s = read(K.session); return s && s.exp > Date.now() ? s : null; };
const me = () => { const s = session(); return s ? read(K.users, []).find(u => u.email === s.email) : null; };

function startSession(email) {
  write(K.session, { email, exp: Date.now() + SESSION_MS });
  showApp();
}
function logout(message) {
  localStorage.removeItem(K.session);
  if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect();
  showAuth();
  if (message) toast(message);
}

/* ---------- View switching ---------- */
function showAuth() {
  $('#appView').hidden = true;
  $('#authView').hidden = false;
  $('#heroMap').innerHTML = corridorSVG(PEERS.map(p => ({ ...p })), false);
  ['loginPassword', 'regPassword'].forEach(id => { $('#' + id).value = ''; });
  $('#loginError').textContent = '';
  $('#registerError').textContent = '';
}
function showApp() {
  const u = me();
  if (!u) return logout();
  $('#authView').hidden = true;
  $('#appView').hidden = false;
  gmap = null;
  $('#userName').textContent = u.biz;
  $('#userKm').textContent = u.km + ' km from the factory hub';
  const pic = $('#userPic');
  if (u.picture && /^https:\/\//.test(u.picture)) { pic.src = u.picture; pic.hidden = false; }
  else { pic.hidden = true; pic.removeAttribute('src'); }
  renderAll();
}
function switchAuth(which) {
  const login = which === 'login';
  $('#loginForm').hidden = !login;
  $('#registerForm').hidden = login;
  $('#tabLogin').classList.toggle('active', login);
  $('#tabRegister').classList.toggle('active', !login);
  $('#tabLogin').setAttribute('aria-selected', login);
  $('#tabRegister').setAttribute('aria-selected', !login);
}
function switchTab(name) {
  $$('.app-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  $$('.panel').forEach(p => { p.hidden = p.id !== 'panel-' + name; });
  if (name === 'corridor') initCorridorMap();
}

/* ---------- Auth: login ---------- */
async function onLogin(e) {
  e.preventDefault();
  const err = $('#loginError');
  err.textContent = '';

  const lock = read(K.lock, { n: 0, until: 0 });
  if (Date.now() < lock.until) {
    err.textContent = `Too many attempts. Try again in ${Math.ceil((lock.until - Date.now()) / 1000)} seconds.`;
    return;
  }

  const email = $('#loginEmail').value.trim().toLowerCase();
  const password = $('#loginPassword').value;
  if (!email || !password) { err.textContent = 'Enter your email and password.'; return; }

  const btn = $('#loginBtn');
  btn.disabled = true;
  btn.textContent = 'Logging in…';

  const user = read(K.users, []).find(u => u.email === email);
  const hash = await hashPassword(password, user ? user.salt : 'no-such-user');
  const ok = user && user.hash && hash === user.hash;

  btn.disabled = false;
  btn.textContent = 'Log in';

  if (!ok) {
    lock.n += 1;
    if (lock.n >= MAX_ATTEMPTS) { lock.until = Date.now() + LOCK_MS; lock.n = 0; }
    write(K.lock, lock);
    err.textContent = 'Email or password is incorrect.';
    return;
  }
  write(K.lock, { n: 0, until: 0 });
  startSession(user.email);
}

/* ---------- Auth: register ---------- */
async function onRegister(e) {
  e.preventDefault();
  const err = $('#registerError');
  err.textContent = '';

  const biz = $('#regBiz').value.trim();
  const email = $('#regEmail').value.trim().toLowerCase();
  const password = $('#regPassword').value;
  const km = Number($('#regKm').value);

  if (biz.length < 2) return void (err.textContent = 'Enter your business name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return void (err.textContent = 'Enter a valid email address.');
  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password))
    return void (err.textContent = 'Password needs at least 8 characters, with a letter and a number.');
  if (!Number.isFinite(km) || km < 1) return void (err.textContent = 'Enter your distance from the factory hub in km.');
  if (km > CORRIDOR_KM) return void (err.textContent = `You are ${km} km away. Only businesses within ${CORRIDOR_KM} km can join this corridor.`);

  const users = read(K.users, []);
  if (users.some(u => u.email === email)) return void (err.textContent = 'An account with this email already exists. Log in instead.');

  const btn = $('#registerBtn');
  btn.disabled = true;
  btn.textContent = 'Creating account…';
  const salt = randomHex();
  users.push({ email, biz, km, salt, hash: await hashPassword(password, salt) });
  write(K.users, users);
  btn.disabled = false;
  btn.textContent = 'Create account';
  startSession(email);
  toast('Account created. Welcome to the corridor.');
}

/* ---------- Google sign-in ---------- */
let pendingGoogle = null;

function decodeJwt(token) {
  const part = token.split('.')[1];
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))));
}

// Google returns a signed ID token. Here we only sanity-check it in the browser.
// A production app must verify the token signature on a server before trusting it.
function onGoogleCredential(resp) {
  let p;
  try { p = decodeJwt(resp.credential); } catch { return toast('Google sign-in failed. Try again.'); }
  const issOk = p.iss === 'https://accounts.google.com' || p.iss === 'accounts.google.com';
  if (!issOk || p.aud !== GOOGLE_CLIENT_ID || p.exp * 1000 < Date.now() || p.email_verified !== true || !p.email)
    return toast('Google sign-in could not be verified.');

  const email = String(p.email).toLowerCase();
  const users = read(K.users, []);
  const user = users.find(u => u.email === email);
  if (user) {
    if (p.picture) { user.picture = p.picture; write(K.users, users); }
    return startSession(email);
  }
  pendingGoogle = { email, name: p.name || '', picture: p.picture || '' };
  $('#profileSub').textContent = `Signed in with Google as ${email}. Tell us about your business to join the corridor.`;
  $('#profBiz').value = pendingGoogle.name;
  $('#profKm').value = '';
  $('#profileError').textContent = '';
  $('#profileModal').showModal();
}

function onProfileSubmit(e) {
  e.preventDefault();
  const err = $('#profileError');
  err.textContent = '';
  const biz = $('#profBiz').value.trim();
  const km = Number($('#profKm').value);
  if (!pendingGoogle) return void (err.textContent = 'Your Google session ended. Close this and sign in again.');
  if (biz.length < 2) return void (err.textContent = 'Enter your business name.');
  if (!Number.isFinite(km) || km < 1) return void (err.textContent = 'Enter your distance from the factory hub in km.');
  if (km > CORRIDOR_KM) return void (err.textContent = `You are ${km} km away. Only businesses within ${CORRIDOR_KM} km can join this corridor.`);

  const users = read(K.users, []);
  if (!users.some(u => u.email === pendingGoogle.email))
    users.push({ email: pendingGoogle.email, biz, km, provider: 'google', picture: pendingGoogle.picture });
  write(K.users, users);
  const email = pendingGoogle.email;
  pendingGoogle = null;
  $('#profileModal').close();
  startSession(email);
  toast('Account created with Google. Welcome to the corridor.');
}

const G_LOGO = '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.5 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.5-4.1 7-10.2 7-17.6z"/><path fill="#FBBC05" d="M10.5 28.7c-.5-1.5-.8-3-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C1 16.4 0 20.1 0 24s1 7.6 2.6 10.8l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.6-4-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>';

function setupGoogle(tries = 0) {
  const note = $('#googleNote'), box = $('#googleBtn');
  if (!GOOGLE_CLIENT_ID) {
    box.innerHTML = `<button type="button" class="btn ghost block gbtn" id="googleSetup">${G_LOGO}<span>Continue with Google</span></button>`;
    note.textContent = 'Google sign-in is not switched on yet. Add your Google client ID in config.js (see the README).';
    $('#googleSetup').addEventListener('click', () => toast('Add your Google client ID in config.js first. Steps are in the README.'));
    return;
  }
  if (location.protocol === 'file:') {
    note.textContent = 'Google sign-in does not work from a file. Run a local server and open http://localhost:8000 (see the README).';
    return;
  }
  if (window.google && google.accounts && google.accounts.id) {
    google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: onGoogleCredential, auto_select: false });
    const w = Math.max(200, Math.min(360, Math.round(box.clientWidth) || 320));
    google.accounts.id.renderButton(box, { theme: 'outline', size: 'large', text: 'continue_with', shape: 'rectangular', logo_alignment: 'left', width: w });
    return;
  }
  if (tries < 40) setTimeout(() => setupGoogle(tries + 1), 250);
  else note.textContent = 'Could not load Google sign-in. Check your internet connection and refresh the page.';
}

/* ---------- Google Maps (corridor) ---------- */
let mapsPromise = null;
let gmap = null;

const toRad = d => d * Math.PI / 180;
function kmBetween(a, b) {
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}
function offsetPoint(km, angleDeg) {
  const a = toRad(angleDeg);
  return {
    lat: HUB.lat + (km / 111.32) * Math.sin(a),
    lng: HUB.lng + (km / (111.32 * Math.cos(toRad(HUB.lat)))) * Math.cos(a)
  };
}
const emailAngle = email => [...email].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
const userPoint = u => (u.lat != null && u.lng != null) ? { lat: u.lat, lng: u.lng } : offsetPoint(u.km, emailAngle(u.email));
const latLngOf = pos => ({ lat: typeof pos.lat === 'function' ? pos.lat() : pos.lat, lng: typeof pos.lng === 'function' ? pos.lng() : pos.lng });

function loadGoogleMaps() {
  if (mapsPromise) return mapsPromise;
  mapsPromise = new Promise((resolve, reject) => {
    window.__tpMapsReady = resolve;
    window.gm_authFailure = () => {
      $('#mapNote').textContent = 'Google Maps rejected the API key. Check the key, its allowed websites and that Maps JavaScript API is enabled (see the README).';
    };
    const sc = document.createElement('script');
    sc.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(MAPS_KEY)}&v=weekly&loading=async&callback=__tpMapsReady`;
    sc.async = true;
    sc.onerror = () => { mapsPromise = null; reject(new Error('Maps script failed to load')); };
    document.head.appendChild(sc);
  });
  return mapsPromise;
}

async function initCorridorMap() {
  const note = $('#mapNote');
  if (gmap) return;
  if (!MAPS_KEY) {
    note.textContent = 'Showing a simple diagram. Add a Google Maps API key in config.js to see the live map (see the README).';
    return;
  }
  if (location.protocol === 'file:') {
    note.textContent = 'Google Maps needs a web address. Run a local server and open http://localhost:8000 (see the README).';
    return;
  }
  note.textContent = 'Loading the map…';
  try { await loadGoogleMaps(); }
  catch { note.textContent = 'Could not load Google Maps. Check your internet connection and refresh the page.'; return; }

  const u = me();
  if (!u || gmap) return;
  const { Map, Circle, InfoWindow } = await google.maps.importLibrary('maps');
  const { AdvancedMarkerElement, PinElement } = await google.maps.importLibrary('marker');

  const box = $('#corridorMap');
  box.innerHTML = '<div id="gmap" class="gmap"></div>';
  const map = new Map($('#gmap'), {
    center: { lat: HUB.lat, lng: HUB.lng }, zoom: 9, mapId: 'DEMO_MAP_ID',
    mapTypeControl: false, streetViewControl: false, fullscreenControl: true
  });
  gmap = map;

  const ring = new Circle({
    map, center: { lat: HUB.lat, lng: HUB.lng }, radius: CORRIDOR_KM * 1000, clickable: false,
    strokeColor: '#1f4fd8', strokeOpacity: 0.9, strokeWeight: 2, fillColor: '#1f4fd8', fillOpacity: 0.07
  });
  map.fitBounds(ring.getBounds());

  const info = new InfoWindow();
  const tip = (marker, name, km) => marker.addListener('click', () => {
    info.setContent(`<strong>${esc(name)}</strong><br>${esc(km)} km from the hub`);
    info.open({ map, anchor: marker });
  });

  const hubPin = new PinElement({ background: '#16202b', borderColor: '#f2c200', glyphColor: '#f2c200' });
  const hubMarker = new AdvancedMarkerElement({ map, position: { lat: HUB.lat, lng: HUB.lng }, title: HUB.name, content: hubPin.element });
  tip(hubMarker, HUB.name, 0);

  PEERS.forEach(p => {
    const pin = new PinElement({ background: '#1f4fd8', borderColor: '#ffffff', glyphColor: '#ffffff', scale: 0.8 });
    const m = new AdvancedMarkerElement({ map, position: offsetPoint(p.km, p.a), title: p.name, content: pin.element });
    tip(m, p.name, p.km);
  });

  const youPin = new PinElement({ background: '#f2c200', borderColor: '#16202b', glyphColor: '#16202b' });
  const you = new AdvancedMarkerElement({ map, position: userPoint(u), title: u.biz + ' (you)', content: youPin.element, gmpDraggable: true });
  tip(you, u.biz + ' (you)', u.km);
  you.addListener('dragend', () => {
    const cur = me();
    if (!cur) return;
    const p = latLngOf(you.position);
    const km = kmBetween(HUB, p);
    if (km > CORRIDOR_KM) {
      you.position = userPoint(cur);
      toast(`That spot is ${Math.round(km)} km from the hub. Your business must stay within ${CORRIDOR_KM} km.`);
      return;
    }
    const users = read(K.users, []);
    const rec = users.find(x => x.email === cur.email);
    rec.km = Math.max(1, Math.round(km));
    rec.lat = p.lat;
    rec.lng = p.lng;
    write(K.users, users);
    $('#userKm').textContent = rec.km + ' km from the factory hub';
    renderCorridorList();
    toast(`Location saved: ${rec.km} km from the hub.`);
  });
  note.textContent = 'Drag the yellow pin to set where your business is. Click any pin for details.';
}

/* ---------- Pricing helpers ---------- */
function priceFor(d, qty = d.pool) {
  let p = d.base;
  for (const t of d.tiers) if (qty >= t.qty) p = t.price;
  return p;
}
function tierIdx(d, qty = d.pool) {
  let i = -1;
  d.tiers.forEach((t, k) => { if (qty >= t.qty) i = k; });
  return i;
}

/* ---------- Corridor SVG ---------- */
function corridorSVG(points, labels = true) {
  const cx = 150, cy = 150, R = 128;
  const dots = points.map(p => {
    const r = Math.min(p.km, CORRIDOR_KM) / CORRIDOR_KM * R;
    const rad = p.a * Math.PI / 180;
    const x = (cx + r * Math.cos(rad)).toFixed(1), y = (cy + r * Math.sin(rad)).toFixed(1);
    return `<circle class="${p.you ? 'you' : 'peer'}" cx="${x}" cy="${y}" r="${p.you ? 8 : 5}"><title>${esc(p.name)} · ${p.km} km</title></circle>`;
  }).join('');
  return `<div class="map"><svg viewBox="0 0 300 300" role="img" aria-label="Map of businesses within ${CORRIDOR_KM} km of the factory hub">
    <circle class="ring" cx="${cx}" cy="${cy}" r="${R / 2}"/>
    <circle class="ring outer" cx="${cx}" cy="${cy}" r="${R}"/>
    ${labels ? `<text class="ring-label" x="${cx + 4}" y="${cy - R / 2 - 3}">25 km</text><text class="ring-label" x="${cx + 4}" y="${cy - R - 4}">50 km</text>` : ''}
    ${dots}
    <rect class="hub" x="${cx - 7}" y="${cy - 7}" width="14" height="14" transform="rotate(45 ${cx} ${cy})"><title>Factory hub</title></rect>
  </svg></div>`;
}

/* ---------- Render: deals ---------- */
const CATEGORIES = ['All', 'Packaging', 'Stationery', 'Household', 'Electricals', 'Food staples', 'Hardware'];
const dealFilter = { cat: 'All', q: '', sort: 'discount' };
const topOff = d => Math.round((1 - d.tiers[d.tiers.length - 1].price / d.base) * 100);

function renderChips() {
  $('#catChips').innerHTML = CATEGORIES.map(c =>
    `<button type="button" class="catbtn ${dealFilter.cat === c ? 'active' : ''}" data-act="cat" data-cat="${esc(c)}">${esc(c)}</button>`).join('');
}

function renderDeals() {
  const q = dealFilter.q.trim().toLowerCase();
  const sorters = {
    discount: (a, b) => topOff(b) - topOff(a),
    closing: (a, b) => (a.status === 'open' ? a.daysLeft : 999) - (b.status === 'open' ? b.daysLeft : 999),
    buyers: (a, b) => b.buyers - a.buyers
  };
  const deals = read(K.deals, [])
    .filter(d => (dealFilter.cat === 'All' || d.category === dealFilter.cat) &&
      (!q || [d.title, d.supplier, d.category, d.note || ''].join(' ').toLowerCase().includes(q)))
    .sort(sorters[dealFilter.sort] || sorters.discount);

  $('#dealCount').textContent = deals.length ? `${deals.length} ${deals.length === 1 ? 'deal' : 'deals'}` : '';
  if (!deals.length) {
    $('#dealGrid').innerHTML = '<div class="empty" style="grid-column:1/-1">No deals match your search. Try another category or a shorter search.</div>';
    return;
  }

  $('#dealGrid').innerHTML = deals.map(d => {
    const max = d.tiers[d.tiers.length - 1].qty;
    const pct = Math.min(100, d.pool / max * 100);
    const idx = tierIdx(d);
    const t1 = d.tiers[0];
    const cur = d.status === 'closed' ? d.finalPrice : priceFor(d);
    const off = Math.round((1 - cur / d.base) * 100);
    const next = d.tiers[idx + 1];
    const open = d.status === 'open';

    let badge;
    if (d.status === 'failed') badge = '<span class="badge bad">MOQ missed · refunded</span>';
    else if (d.status === 'closed') badge = '<span class="badge info">Closed · price locked</span>';
    else if (idx < 0) badge = `<span class="badge warn">${num(t1.qty - d.pool)} ${esc(d.unit)} to Tier 1</span>`;
    else badge = `<span class="badge ok">Tier ${idx + 1} unlocked</span>`;

    const marks = d.tiers.map((t, k) =>
      `<span class="mark ${d.pool >= t.qty ? 'hit' : ''}" style="left:${t.qty / max * 100}%"><i></i>Tier ${k + 1}</span>`).join('');
    const tiers = d.tiers.map((t, k) => {
      const o = Math.round((1 - t.price / d.base) * 100);
      return `<li class="${d.pool >= t.qty ? 'hit' : ''}"><span>Tier ${k + 1} · ${num(t.qty)}+ ${esc(d.unit)}</span><span>${inr(t.price)} <em>${o}% off</em></span></li>`;
    }).join('');

    // Savings example for one buyer ordering the minimum quantity
    const alone = d.minQty * d.base, grp = d.minQty * t1.price, saved = alone - grp;
    const example = `<div class="save-example">Order ${num(d.minQty)} ${esc(d.unit)}: <b>${inr(alone)}</b> alone, <b>${inr(grp)}</b> with the group at Tier 1. You save <b>${inr(saved)}</b>.</div>`;

    return `
    <article class="deal">
      <div class="deal-top">
        <div><span class="cat">${esc(d.category || 'General')}</span><h3>${esc(d.title)}</h3><p class="supplier">${esc(d.supplier)}</p>${d.note ? `<p class="spec">${esc(d.note)}</p>` : ''}</div>
        ${badge}
      </div>
      <div class="price-row">
        <span class="price">${inr(cur)}<small> per ${esc(d.unit)}</small></span>
        ${off > 0 ? `<span class="strike">${inr(d.base)}</span><span class="chip">${off}% off</span>` : `<span class="strike-note">Buying alone: ${inr(d.base)}</span>`}
      </div>
      ${idx < 0 && open ? `<div class="group-hint">Join the group to pay <b>${inr(t1.price)}</b> (${Math.round((1 - t1.price / d.base) * 100)}% off) once the pool reaches ${num(t1.qty)} ${esc(d.unit)}. Up to <b>${topOff(d)}% off</b> at the top tier.</div>` : ''}
      <div>
        <div class="progress">
          <div class="track"><div class="fill" style="width:${pct}%"></div></div>
          ${marks}
        </div>
        <div class="pool-line">
          <span>Pooled: <b>${num(d.pool)} ${esc(d.unit)}</b></span>
          <span>${next && open ? `${num(next.qty - d.pool)} ${esc(d.unit)} to Tier ${idx + 2}` : (open ? 'Top tier reached' : '')}</span>
        </div>
      </div>
      <ul class="tiers">${tiers}</ul>
      ${example}
      <div class="deal-meta">
        <span>${d.buyers} businesses in the pool</span>
        ${open ? `<span>${d.daysLeft} days left</span>` : ''}
        <span>Min. ${num(d.minQty)} ${esc(d.unit)} each</span>
      </div>
      <div class="deal-actions">
        ${open ? `<button class="btn primary" data-act="join" data-id="${d.id}">Join this deal</button>` : '<button class="btn ghost" disabled>Deal closed</button>'}
      </div>
      ${open ? `<div class="demo-row">Demo controls:
        <button class="btn ghost small" data-act="neighbours" data-id="${d.id}">Neighbours join</button>
        <button class="btn ghost small" data-act="close" data-id="${d.id}">Deadline passes</button>
      </div>` : ''}
    </article>`;
  }).join('');
}

/* ---------- Join modal ---------- */
function joinSummary(d, qty, fee = 0) {
  const pool = d.pool + qty;
  const p = priceFor(d, pool);
  const locked = qty * d.base + fee;
  const charge = qty * p + fee;
  return { p, fee, locked, charge, back: locked - charge, idx: tierIdx(d, pool) };
}
// Shared-truck delivery: priced by distance, split with neighbours on the same route
const deliveryFee = (u, mode) => mode === 'DELIVERY' ? Math.max(150, Math.round(u.km * 6)) : 0;
const dateStr = offset => { const t = new Date(Date.now() + offset * 864e5); return t.toISOString().slice(0, 10); };
const prettyDate = iso => new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

function openJoin(id) {
  const d = read(K.deals, []).find(x => x.id === id);
  if (!d || d.status !== 'open') return;
  const u = me();
  const fee = deliveryFee(u, 'DELIVERY');
  $('#joinBody').innerHTML = `
    <h3>Join: ${esc(d.title)}</h3>
    <p class="sub">${esc(d.supplier)} · standard price ${inr(d.base)} per ${esc(d.unit)}</p>
    <label>Quantity (${esc(d.unit)})
      <input type="number" id="joinQty" min="${d.minQty}" step="1" value="${d.minQty}" required>
      <small>Minimum ${num(d.minQty)} ${esc(d.unit)} per business.</small>
    </label>

    <fieldset class="opts">
      <legend>How do you want to receive it?</legend>
      <label class="opt"><input type="radio" name="joinMode" value="DELIVERY" checked>
        <span><b>Delivery to my address</b><small>Shared corridor truck. ${inr(fee)} freight, split with neighbours on the same route.</small></span></label>
      <label class="opt"><input type="radio" name="joinMode" value="PICKUP">
        <span><b>Collect from the factory</b><small>No freight. You get a pickup code when the order is ready.</small></span></label>
    </fieldset>
    <div id="deliveryFields">
      <label>Delivery address
        <textarea id="joinAddress" rows="2" maxlength="200" placeholder="Unit, street, area, pincode"></textarea>
      </label>
      <label>Preferred delivery date
        <input type="date" id="joinDate" min="${dateStr(3)}" value="${dateStr(7)}">
        <small>The factory confirms the final slot when it dispatches.</small>
      </label>
    </div>

    <div class="calc" id="joinCalc"></div>
    <label>Pay with
      <select id="joinMethod"><option>UPI</option><option>Net banking</option><option>RTGS / NEFT</option></select>
    </label>
    <label class="check"><input type="checkbox" id="joinAgree"> I understand my payment is held in escrow and released only after I confirm delivery or pickup.</label>
    <p class="error" id="joinError" role="alert"></p>
    <div class="modal-actions">
      <button type="button" class="btn ghost" id="joinCancel">Cancel</button>
      <button type="submit" class="btn primary" id="joinPay">Pay into escrow</button>
    </div>`;
  const mode = () => $('input[name=joinMode]:checked').value;
  const update = () => {
    const qty = Math.floor(Number($('#joinQty').value)) || 0;
    const m = mode();
    $('#deliveryFields').hidden = m !== 'DELIVERY';
    const s = joinSummary(d, qty, deliveryFee(u, m));
    const tierText = s.idx < 0 ? 'Below Tier 1 (standard price)' : `Tier ${s.idx + 1} price`;
    $('#joinCalc').innerHTML = `
      <div><span>${tierText} with your quantity</span><strong>${inr(s.p)} per ${esc(d.unit)}</strong></div>
      <div><span>${m === 'DELIVERY' ? 'Delivery freight' : 'Pickup from factory'}</span><strong>${s.fee ? inr(s.fee) : 'Free'}</strong></div>
      <div><span>Locked in escrow now (standard price + freight)</span><strong>${inr(s.locked)}</strong></div>
      <div class="good"><span>Returned to you if the deal closes at this price</span><strong>${inr(s.back)}</strong></div>
      <div class="total"><span>Final cost to you</span><strong>${inr(s.charge)}</strong></div>`;
  };
  $('#joinQty').addEventListener('input', update);
  $$('input[name=joinMode]').forEach(r => r.addEventListener('change', update));
  $('#joinCancel').addEventListener('click', () => $('#joinModal').close());
  $('#joinForm').dataset.deal = id;
  update();
  $('#joinModal').showModal();
}

function onJoinSubmit(e) {
  e.preventDefault();
  const err = $('#joinError');
  err.textContent = '';
  const deals = read(K.deals, []);
  const d = deals.find(x => x.id === $('#joinForm').dataset.deal);
  const qty = Math.floor(Number($('#joinQty').value));
  const mode = $('input[name=joinMode]:checked').value;
  const address = $('#joinAddress').value.trim();
  const date = $('#joinDate').value;
  if (!d || d.status !== 'open') return void (err.textContent = 'This deal is no longer open.');
  if (!Number.isFinite(qty) || qty < d.minQty) return void (err.textContent = `Minimum quantity is ${num(d.minQty)} ${d.unit}.`);
  if (qty > 1000000) return void (err.textContent = 'Enter a smaller quantity.');
  if (mode === 'DELIVERY' && address.length < 10) return void (err.textContent = 'Enter your full delivery address.');
  if (mode === 'DELIVERY' && !date) return void (err.textContent = 'Choose a preferred delivery date.');
  if (!$('#joinAgree').checked) return void (err.textContent = 'Please accept the escrow terms to continue.');

  const u = me();
  const fee = deliveryFee(u, mode);
  const btn = $('#joinPay');
  btn.disabled = true;
  btn.textContent = 'Securing payment…';
  setTimeout(() => {
    const orders = read(K.orders, []);
    const locked = +(qty * d.base + fee).toFixed(2);
    orders.push({
      id: 'ORD-' + Math.floor(10000 + Math.random() * 90000),
      dealId: d.id, email: u.email, qty, fee, locked,
      mode, address: mode === 'DELIVERY' ? address : '', date: mode === 'DELIVERY' ? date : '',
      otp: String(Math.floor(1000 + Math.random() * 9000)),
      method: $('#joinMethod').value,
      status: 'HELD', at: Date.now()
    });
    d.pool += qty;
    d.buyers += 1;
    write(K.orders, orders);
    write(K.deals, deals);
    $('#joinModal').close();
    renderAll();
    toast(`${inr(locked)} is now held in escrow.`);
  }, 900);
}

/* ---------- Deal actions ---------- */
function neighboursJoin(id) {
  const deals = read(K.deals, []);
  const d = deals.find(x => x.id === id);
  if (!d || d.status !== 'open') return;
  d.pool += Math.round(d.tiers[0].qty * 0.4);
  d.buyers += 2;
  write(K.deals, deals);
  renderAll();
  toast('Two more businesses from the corridor joined the pool.');
}

function closeDeal(id) {
  const deals = read(K.deals, []);
  const d = deals.find(x => x.id === id);
  if (!d || d.status !== 'open') return;
  const orders = read(K.orders, []);
  const ok = d.pool >= d.tiers[0].qty;
  d.status = ok ? 'closed' : 'failed';
  d.finalPrice = ok ? priceFor(d) : null;
  d.daysLeft = 0;
  orders.filter(o => o.dealId === id && o.status === 'HELD').forEach(o => {
    if (ok) { o.status = 'CONFIRMED'; o.finalPrice = d.finalPrice; }
    else o.status = 'REFUNDED';
  });
  write(K.deals, deals);
  write(K.orders, orders);
  renderAll();
  toast(ok
    ? `Minimum quantity met. Price locked at ${inr(d.finalPrice)} per ${d.unit}.`
    : 'Minimum quantity not met. Every escrow payment was refunded in full.');
}

/* ---------- Render: orders ---------- */
const STATUS = {
  HELD: ['Paid into escrow', 'warn'],
  CONFIRMED: ['Order confirmed', 'info'],
  DISPATCHED: ['Dispatched', 'info'],
  RELEASED: ['Complete', 'ok'],
  DISPUTED: ['Disputed · funds frozen', 'bad'],
  REFUNDED: ['Refunded', 'bad'],
  CANCELLED: ['Cancelled · refunded', 'bad']
};
const STEP_INDEX = { HELD: 0, CONFIRMED: 1, DISPATCHED: 2, DISPUTED: 2, RELEASED: 3 };
const stepLabels = o => o.mode === 'PICKUP'
  ? ['Paid into escrow', 'Order confirmed', 'Ready for pickup', 'Collected, funds released']
  : ['Paid into escrow', 'Order confirmed', 'Dispatched', 'Delivered, funds released'];

function deliveryBlock(o, d, ended) {
  if (!o.mode) return '';
  if (o.mode === 'PICKUP') {
    return `<div class="delivery"><b>Collect from the factory</b>
      <span>${esc(d.supplier)} · show pickup code <b>${esc(o.otp)}</b> at the gate</span>
      ${o.track ? '<span class="good-text">Your order is ready for pickup.</span>' : '<span>You will be notified when it is ready.</span>'}</div>`;
  }
  const t = o.track;
  return `<div class="delivery"><b>Delivery to</b>
    <span>${esc(o.address)}</span>
    <span>Preferred date: ${esc(prettyDate(o.date))}</span>
    ${t ? `<span class="good-text">On the way · vehicle ${esc(t.vehicle)} · driver ${esc(t.driver)} · expected ${esc(prettyDate(t.eta))}</span>` : '<span>Tracking appears when the factory dispatches.</span>'}
    ${t && !ended ? `<span>Handover code: <b>${esc(o.otp)}</b>. Give it to the driver only when you have received the goods.</span>` : ''}</div>`;
}

function renderOrders() {
  const u = me();
  const deals = read(K.deals, []);
  const mine = read(K.orders, []).filter(o => o.email === u.email).sort((a, b) => b.at - a.at);
  $('#orderCount').textContent = mine.length;

  let held = 0, released = 0, refunded = 0, saved = 0;
  mine.forEach(o => {
    const d = deals.find(x => x.id === o.dealId);
    if (['HELD', 'CONFIRMED', 'DISPATCHED', 'DISPUTED'].includes(o.status)) held += o.locked;
    if (o.status === 'RELEASED') { released += o.paid; refunded += o.locked - o.paid; }
    if (['REFUNDED', 'CANCELLED'].includes(o.status)) refunded += o.locked;
    if (d && ['CONFIRMED', 'DISPATCHED', 'RELEASED'].includes(o.status)) saved += (d.base - o.finalPrice) * o.qty;
  });
  $('#escrowSummary').innerHTML = `
    <div class="stat locked"><span>Held in escrow</span><strong>${inr(held)}</strong></div>
    <div class="stat"><span>Released to factories</span><strong>${inr(released)}</strong></div>
    <div class="stat"><span>Refunded to you</span><strong>${inr(refunded)}</strong></div>
    <div class="stat saved"><span>Saved vs. standard price</span><strong>${inr(saved)}</strong></div>`;

  if (!mine.length) {
    $('#orderList').innerHTML = `<div class="empty">You have no orders yet.<br><button class="btn primary" data-act="goto-deals">Browse group deals</button></div>`;
    return;
  }

  $('#orderList').innerHTML = mine.map(o => {
    const d = deals.find(x => x.id === o.dealId);
    if (!d) return '';
    let [label, tone] = STATUS[o.status];
    const pickup = o.mode === 'PICKUP';
    if (pickup && o.status === 'DISPATCHED') label = 'Ready for pickup';
    const unit = o.finalPrice ?? priceFor(d);
    const fee = o.fee || 0;
    const charge = o.qty * unit + fee;
    const rebate = o.locked - charge;
    const settled = o.status === 'RELEASED';
    const ended = ['REFUNDED', 'CANCELLED'].includes(o.status);

    const stepper = ended ? '' : `<ol class="steps">${stepLabels(o).map((s, i) => {
      const at = STEP_INDEX[o.status];
      const cls = settled || i < at ? 'done' : i === at ? (o.status === 'DISPUTED' ? 'now frozen' : 'now') : '';
      return `<li class="${cls}">${s}</li>`;
    }).join('')}</ol>`;

    let note = '';
    if (o.status === 'HELD') note = `<div class="note">Waiting for the pool to reach Tier 1. If it does not by the deadline, you get a full refund. Price right now: ${inr(unit)} per ${esc(d.unit)}.</div>`;
    if (o.status === 'DISPUTED') note = '<div class="note bad">Escrow is frozen. The factory is not paid until the dispute is resolved.</div>';
    if (o.status === 'REFUNDED') note = `<div class="note bad">${inr(o.locked)} was returned to your account.</div>`;
    if (o.status === 'CANCELLED') note = `<div class="note bad">You cancelled before the deadline. ${inr(o.locked)} was returned to your account.</div>`;
    if (settled) note = `<div class="note">${inr(o.paid)} was paid to ${esc(d.supplier)}. ${inr(o.locked - o.paid)} was returned to you.</div>`;

    let actions = '';
    if (o.status === 'HELD') actions = `<button class="btn danger small" data-act="cancel" data-id="${o.id}">Cancel and get a refund</button>`;
    if (o.status === 'CONFIRMED') actions = `<button class="btn ghost small" data-act="dispatch" data-id="${o.id}">${pickup ? 'Demo: factory marks ready for pickup' : 'Demo: factory marks as dispatched'}</button>`;
    if (o.status === 'DISPATCHED') actions = `
      <button class="btn primary" data-act="confirm" data-id="${o.id}">${pickup ? 'Confirm pickup and release payment' : 'Confirm delivery and release payment'}</button>
      <button class="btn danger" data-act="dispute" data-id="${o.id}">Report a problem</button>`;
    if (o.status === 'DISPUTED') actions = `<button class="btn ghost small" data-act="resolve" data-id="${o.id}">Demo: arbitrator refunds me</button>`;

    return `
    <article class="order">
      <div class="order-head">
        <div><h3>${esc(d.title)}</h3><p>${esc(o.id)} · ${num(o.qty)} ${esc(d.unit)} · paid via ${esc(o.method)}</p></div>
        <span class="badge ${tone}">${label}</span>
      </div>
      ${stepper}
      ${deliveryBlock(o, d, ended)}
      <div class="order-money">
        <div><span>Locked in escrow</span><strong>${inr(o.locked)}</strong></div>
        ${o.mode ? `<div><span>${pickup ? 'Pickup' : 'Delivery freight'}</span><strong>${fee ? inr(fee) : 'Free'}</strong></div>` : ''}
        <div><span>${o.finalPrice != null ? 'Final price' : 'Price now'}</span><strong>${inr(unit)} per ${esc(d.unit)}</strong></div>
        ${ended ? '' : `<div><span>${settled ? 'Paid to factory' : 'Factory will receive'}</span><strong>${inr(charge)}</strong></div>
        <div><span>Comes back to you</span><strong>${inr(rebate)}</strong></div>`}
      </div>
      ${note}
      ${actions ? `<div class="order-actions">${actions}</div>` : ''}
    </article>`;
  }).join('');
}

/* ---------- Order actions ---------- */
function updateOrder(id, fn) {
  const orders = read(K.orders, []);
  const o = orders.find(x => x.id === id);
  if (!o) return;
  fn(o);
  write(K.orders, orders);
  renderAll();
}

function orderAction(act, id) {
  if (act === 'cancel') {
    const deals = read(K.deals, []);
    const o = read(K.orders, []).find(x => x.id === id);
    const d = o && deals.find(x => x.id === o.dealId);
    if (!o || o.status !== 'HELD' || !d || d.status !== 'open') return;
    d.pool = Math.max(0, d.pool - o.qty);
    d.buyers = Math.max(0, d.buyers - 1);
    write(K.deals, deals);
    updateOrder(id, x => { x.status = 'CANCELLED'; });
    toast('Order cancelled. Escrow refunded in full.');
  }
  if (act === 'dispatch') updateOrder(id, o => {
    o.status = 'DISPATCHED';
    if (o.mode === 'DELIVERY') {
      const drivers = ['Ramesh Yadav', 'Sanjay Pawar', 'Imran Shaikh', 'Vikas Jagtap'];
      o.track = {
        vehicle: 'MH 14 ' + String.fromCharCode(65 + Math.floor(Math.random() * 26)) + String.fromCharCode(65 + Math.floor(Math.random() * 26)) + ' ' + Math.floor(1000 + Math.random() * 9000),
        driver: drivers[Math.floor(Math.random() * drivers.length)],
        eta: o.date || dateStr(2)
      };
    } else o.track = { ready: true };
    toast(o.mode === 'DELIVERY' ? 'Dispatched. Tracking details added to your order.' : 'Your order is ready for pickup.');
  });
  if (act === 'confirm') {
    updateOrder(id, o => { o.status = 'RELEASED'; o.paid = +(o.qty * o.finalPrice + (o.fee || 0)).toFixed(2); });
    toast('Payment released. Your price difference was refunded.');
  }
  if (act === 'dispute') {
    updateOrder(id, o => { o.status = 'DISPUTED'; });
    toast('Escrow frozen while the problem is reviewed.');
  }
  if (act === 'resolve') {
    updateOrder(id, o => { o.status = 'REFUNDED'; });
    toast('Dispute resolved in your favour. Escrow refunded.');
  }
}

/* ---------- Render: corridor ---------- */
function corridorPoints() {
  const u = me();
  return [...PEERS.map(p => ({ ...p })), { name: u.biz, km: u.km, a: emailAngle(u.email), you: true }];
}
function renderCorridorList() {
  const pts = corridorPoints();
  const rows = [...pts].sort((a, b) => a.km - b.km).map(p =>
    `<li class="${p.you ? 'me' : ''}"><span>${esc(p.name)}${p.you ? ' (you)' : ''}</span><span>${p.km} km</span></li>`).join('');
  $('#corridorList').innerHTML = `<h3>${pts.length} businesses within ${CORRIDOR_KM} km</h3><ul>${rows}</ul>`;
}
function renderCorridor() {
  if (!gmap) $('#corridorMap').innerHTML = corridorSVG(corridorPoints(), true);
  renderCorridorList();
}

function renderAll() { renderChips(); renderDeals(); renderOrders(); renderCorridor(); }

/* ---------- Events ---------- */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-act], [data-auth], [data-tab]');
  if (!t) return;
  if (t.dataset.auth) return switchAuth(t.dataset.auth);
  if (t.dataset.tab) return switchTab(t.dataset.tab);
  const { act, id } = t.dataset;
  if (act === 'join') openJoin(id);
  else if (act === 'neighbours') neighboursJoin(id);
  else if (act === 'close') closeDeal(id);
  else if (act === 'goto-deals') switchTab('deals');
  else if (act === 'cat') { dealFilter.cat = t.dataset.cat; renderChips(); renderDeals(); }
  else orderAction(act, id);
});

$('#loginForm').addEventListener('submit', onLogin);
$('#registerForm').addEventListener('submit', onRegister);
$('#joinForm').addEventListener('submit', onJoinSubmit);
$('#logoutBtn').addEventListener('click', () => logout('You are logged out.'));
$('#fillDemo').addEventListener('click', () => {
  $('#loginEmail').value = 'demo@msme.in';
  $('#loginPassword').value = 'Demo@1234';
});
$('#resetDemo').addEventListener('click', () => {
  if (!confirm('Reset all deals and orders to the starting demo data?')) return;
  write(K.deals, seedDeals());
  write(K.orders, []);
  renderAll();
  toast('Demo data reset.');
});

$('#dealSearch').addEventListener('input', e => { dealFilter.q = e.target.value; renderDeals(); });
$('#dealSort').addEventListener('change', e => { dealFilter.sort = e.target.value; renderDeals(); });
$('#profileForm').addEventListener('submit', onProfileSubmit);
$('#profileCancel').addEventListener('click', () => { pendingGoogle = null; $('#profileModal').close(); });
$('#profileModal').addEventListener('close', () => { pendingGoogle = null; });

// Expire sessions automatically
setInterval(() => { if (!$('#appView').hidden && !session()) logout('Your session expired. Log in again.'); }, 15000);

/* ---------- Boot ---------- */
(async function boot() {
  await seed();
  session() ? showApp() : showAuth();
  setupGoogle();
})();
