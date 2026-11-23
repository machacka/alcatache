'use strict';
/* =========================================================
   ALCATÂCHE — le pénitencier domestique
   Un seul code pour deux modes :
   - Gardien (parent) : dans l'APK Android (window.AlcaNative présent) ou ?mode=parent
   - Détenue (enfant) : appli web installée sur l'écran d'accueil de l'iPhone
   ========================================================= */

const CFG = self.ALCA_CONFIG;
const NATIVE = window.AlcaNative || null;
const QS = new URLSearchParams(location.search);
const MODE = (NATIVE || QS.get('mode') === 'parent') ? 'parent' : 'child';
const $app = document.getElementById('app');
const $modal = document.getElementById('modal');

const DEFAULTS = {
  childName: 'Détenue n°1',
  ptsPerTask: 10,       // points par tâche validée
  fastBonus: 20,        // bonus si toute la peine est purgée vite
  fastMinutes: 15,      // … en moins de X minutes
  graceMinutes: 20,     // délai avant que le compteur de détention coûte des points
  penaltyPerMin: 1,     // points perdus par minute au-delà du délai
  refusePenalty: 5,     // points perdus à chaque tâche refusée par le Gardien
  ptsPerEuro: 100,      // taux de change
  payoutDay: 25,        // la paie peut être demandée à partir de ce jour du mois
  intervalSec: 60,      // fréquence des relances
  customTasks: []
};

const CATALOG = [
  { cat: 'Hygiène', items: [
    ['dents', 'Se brosser les dents', '🪥'], ['douche', 'Prendre sa douche', '🚿'],
    ['mains', 'Se laver les mains', '🧼'], ['coiffer', 'Se coiffer', '💇'],
    ['linge', 'Mettre le linge sale au panier', '🧺', 1], ['wc', 'Laisser les toilettes propres', '🚽', 1]]},
  { cat: 'Chambre', items: [
    ['chambre', 'Ranger sa chambre', '🛏️', 1], ['lit', 'Faire son lit', '🛌', 1],
    ['vetements', 'Ranger ses vêtements', '👕', 1], ['bureau', 'Ranger son bureau', '🗄️', 1],
    ['salon', 'Ramasser ses affaires qui traînent', '🛋️', 1]]},
  { cat: 'École', items: [
    ['devoirs', 'Faire ses devoirs', '📚'], ['lecons', 'Apprendre ses leçons', '🧠'],
    ['cartable', 'Préparer son cartable', '🎒', 1], ['papiers', "Donner les papiers de l'école", '📄'],
    ['signer', 'Faire signer le carnet', '✍️']]},
  { cat: 'Repas', items: [
    ['table', 'Mettre la table', '🍽️'], ['debarrasser', 'Débarrasser la table', '🧽'],
    ['lv', 'Vider / remplir le lave-vaisselle', '🫧'], ['atable', 'Venir à table immédiatement', '⏰']]},
  { cat: 'Maison', items: [
    ['poubelle', 'Sortir la poubelle', '🗑️'], ['animal', "Nourrir l'animal", '🐾'],
    ['plier', 'Plier et ranger son linge', '👚', 1], ['entree', 'Ranger chaussures et manteau', '👟', 1],
    ['lumiere', 'Éteindre les lumières', '💡']]},
  { cat: 'Écrans & horaires', items: [
    ['ecran', 'Lâcher le téléphone / la tablette', '📵'], ['coucher', 'Aller se coucher', '🌙'],
    ['habiller', "S'habiller", '👖'], ['prete', 'Être prête à partir', '🚪']]}
];

const MOTIFS = [
  'Récidive caractérisée (3e rappel)', "Refus d'obtempérer", 'Désordre en bande organisée',
  'Hygiène douteuse', 'Retard chronique', "Abus d'écran aggravé", 'Outrage à parent',
  'Aucun motif : parce que je l\'ai dit'
];

const S = {
  fam: null, cell: null, cellId: null, ledger: [], requests: [], photos: {},
  tab: 'ecrouer', selected: [], motif: MOTIFS[0], motifFree: '', subs: {}, lastStatus: null,
  messagingOk: false, audioUnlocked: false
};
let db = null, famRef = null;
let fid = localStorage.getItem('alca_fid');

/* ---------- utilitaires ---------- */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const st = () => Object.assign({}, DEFAULTS, (S.fam && S.fam.settings) || {});
const euros = (p) => (Math.max(0, p) / st().ptsPerEuro).toFixed(2).replace('.', ',') + ' €';
const inc = (n) => firebase.firestore.FieldValue.increment(n);
const fmtDur = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
  return (h ? h + 'h' : '') + String(m).padStart(2, '0') + ':' + String(x).padStart(2, '0');
};
const fmtDate = (t) => new Date(t).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const monthKey = (d = new Date()) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
function toast(msg) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 3200);
}
function modal(html) { $modal.innerHTML = '<div class="box">' + html + '</div>'; $modal.hidden = false; }
function closeModal() { $modal.hidden = true; $modal.innerHTML = ''; }
$modal.addEventListener('click', (e) => { if (e.target === $modal) closeModal(); });
function allTasks() {
  const cats = CATALOG.map(c => ({ cat: c.cat, items: c.items.map(([id, label, icon, photo]) => ({ id, label, icon, photo: !!photo })) }));
  const custom = st().customTasks || [];
  if (custom.length) cats.push({ cat: 'Mes tâches', items: custom });
  return cats;
}
function randomId(n) {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; const r = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(r, x => a[x % a.length]).join('');
}
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
const isStandalone = window.navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;

/* ---------- démarrage ---------- */
async function init() {
  if (!CFG || !CFG.firebase || String(CFG.firebase.apiKey).startsWith('A_REMPLIR')) {
    $app.innerHTML = '<h1>ALCATÂCHE</h1><div class="card warn">Configuration Firebase manquante (firebase-config.js).</div>';
    return;
  }
  firebase.initializeApp(CFG.firebase);
  db = firebase.firestore();
  if (MODE === 'child') {
    try { S.messagingOk = await firebase.messaging.isSupported(); } catch (e) { S.messagingOk = false; }
  }
  if (fid) connect(); else render();
  setInterval(tick, 1000);
}

function connect() {
  famRef = db.collection('families').doc(fid);
  Object.values(S.subs).forEach(u => u && u()); S.subs = {};
  S.subs.fam = famRef.onSnapshot((d) => {
    if (!d.exists) {
      if (MODE === 'child') { toast('Code de prison inconnu.'); localStorage.removeItem('alca_fid'); fid = null; S.fam = null; render(); }
      return;
    }
    S.fam = d.data();
    watchCell(S.fam.activeCell || null);
    render();
  }, (err) => { toast('Erreur de connexion : ' + err.code); });
  S.subs.ledger = famRef.collection('ledger').orderBy('at', 'desc').limit(40)
    .onSnapshot(q => { S.ledger = q.docs.map(d => ({ id: d.id, ...d.data() })); render(); });
  S.subs.req = famRef.collection('requests').orderBy('at', 'desc').limit(20)
    .onSnapshot(q => { S.requests = q.docs.map(d => ({ id: d.id, ...d.data() })); render(); });
  if (MODE === 'child') refreshPushToken();
}

function watchCell(id) {
  if (id === S.cellId) return;
  if (S.subs.cell) S.subs.cell(); if (S.subs.photos) S.subs.photos();
  S.subs.cell = S.subs.photos = null; S.photos = {};
  const wasActive = S.cellId;
  S.cellId = id; S.cell = null;
  if (!id) {
    syncNative();
    if (wasActive && MODE === 'child') showLiberation(wasActive);
    render(); return;
  }
  const ref = famRef.collection('cells').doc(id);
  S.subs.cell = ref.onSnapshot(d => { S.cell = d.exists ? d.data() : null; syncNative(); render(); });
  if (MODE === 'parent') {
    S.subs.photos = ref.collection('photos').onSnapshot(q => {
      q.docs.forEach(d => S.photos[d.id] = d.data()); render();
    });
  }
}

async function showLiberation(cellId) {
  stopSiren();
  try {
    const d = await famRef.collection('cells').doc(cellId).get();
    const c = d.data() || {};
    const delta = c.delta || 0;
    modal(`<div class="ecrou"><div class="stamp green">LIBÉRÉE</div><div class="head">AVIS DE LIBÉRATION</div>
      <p>Durée de détention : <b>${fmtDur((c.releasedAt || Date.now()) - c.createdAt)}</b></p>
      <p>Solde de la peine : <b class="${delta >= 0 ? 'plus' : 'minus'}">${delta >= 0 ? '+' : ''}${delta} pts</b></p>
      <p class="small">${esc(c.releaseNote || '')}</p></div>
      <p></p><button class="big" data-a="close">Retourner en liberté</button>`);
  } catch (e) { /* rien */ }
}

/* ---------- pont natif (APK du Gardien) ---------- */
function syncNative() {
  if (MODE !== 'parent' || !NATIVE) return;
  try {
    if (S.cell && S.cell.status === 'active') {
      NATIVE.startSiren(JSON.stringify({
        projectId: CFG.firebase.projectId, apiKey: CFG.firebase.apiKey, fid, cellId: S.cellId,
        intervalSec: st().intervalSec, childName: st().childName,
        link: location.origin + location.pathname
      }));
    } else NATIVE.stopSiren();
  } catch (e) { console.warn(e); }
}
const nativeHasKey = () => { try { return NATIVE && NATIVE.hasServiceKey(); } catch (e) { return false; } };

/* ---------- logique de peine ---------- */
function computeRelease(cell, now) {
  const s = st();
  const tasks = cell.tasks || [];
  const validated = tasks.filter(t => t.status === 'validated').length;
  const all = validated === tasks.length && tasks.length > 0;
  const minutes = (now - cell.createdAt) / 60000;
  const base = validated * s.ptsPerTask;
  const bonus = all && minutes <= s.fastMinutes ? s.fastBonus : 0;
  const late = Math.max(0, Math.ceil(minutes - s.graceMinutes));
  const latePen = late * s.penaltyPerMin;
  const refusals = tasks.reduce((n, t) => n + (t.refused || 0), 0);
  const refPen = refusals * s.refusePenalty;
  const delta = base + bonus - latePen - refPen;
  const parts = [`${validated} tâche(s) : +${base}`];
  if (bonus) parts.push(`rapidité : +${bonus}`);
  if (latePen) parts.push(`${late} min de retard : −${latePen}`);
  if (refPen) parts.push(`${refusals} refus : −${refPen}`);
  return { delta, note: parts.join(' · '), minutes };
}

async function ecrouer() {
  if (!S.selected.length) return;
  const motif = (S.motifFree.trim() || S.motif);
  const now = Date.now();
  const newTasks = S.selected.map((t, i) => ({
    key: t.id + '_' + now.toString(36) + i, label: t.label, icon: t.icon, photo: !!t.photo, status: 'todo', addedAt: now
  }));
  if (S.cell && S.cell.status === 'active') {
    const ref = famRef.collection('cells').doc(S.cellId);
    await db.runTransaction(async tx => {
      const d = await tx.get(ref);
      tx.update(ref, { tasks: (d.data().tasks || []).concat(newTasks), motif, bumpedAt: now });
    });
    toast('Peine alourdie de ' + newTasks.length + ' tâche(s).');
  } else {
    const ref = famRef.collection('cells').doc();
    const batch = db.batch();
    batch.set(ref, { createdAt: now, motif, tasks: newTasks, status: 'active' });
    batch.update(famRef, { activeCell: ref.id });
    await batch.commit();
  }
  S.selected = []; S.motifFree = ''; S.tab = 'cellule';
  render();
  modal(`<h2>🔒 Écrouée !</h2><p>L'alerte part sur l'iPhone et sera relancée toutes les ${st().intervalSec} s jusqu'à votre validation.</p>
    ${nativeHasKey() ? '' : '<div class="card danger small">⚠️ Clé de service non importée : aucune alerte ne peut partir. Allez dans Réglages.</div>'}
    <button class="big" data-a="kids360">📵 Bloquer avec Kids 360</button><p></p>
    <button class="ghost" style="width:100%" data-a="close">Plus tard</button>`);
}

async function validate(idx, ok) {
  const ref = famRef.collection('cells').doc(S.cellId);
  let allDone = false;
  await db.runTransaction(async tx => {
    const d = await tx.get(ref); const tasks = d.data().tasks;
    const t = tasks[idx]; if (!t) return;
    if (ok) { t.status = 'validated'; t.validatedAt = Date.now(); }
    else { t.status = 'todo'; t.refused = (t.refused || 0) + 1; t.hasPhoto = false; }
    allDone = tasks.every(x => x.status === 'validated');
    tx.update(ref, { tasks });
  });
  toast(ok ? 'Tâche validée ✔' : 'Refusée : retour à la case cellule.');
  if (allDone) await release(false);
}

async function release(pardon) {
  const ref = famRef.collection('cells').doc(S.cellId);
  const d = await ref.get(); const cell = d.data();
  if (!cell || cell.status !== 'active') return;
  const now = Date.now();
  const r = computeRelease(cell, now);
  const batch = db.batch();
  const note = (pardon ? 'Grâce présidentielle. ' : '') + r.note;
  batch.update(ref, { status: 'released', releasedAt: now, delta: r.delta, releaseNote: note });
  batch.update(famRef, { activeCell: null, points: inc(r.delta) });
  batch.set(famRef.collection('ledger').doc(), { at: now, delta: r.delta, reason: (pardon ? 'Grâce' : 'Libération') + ' après ' + fmtDur(now - cell.createdAt) + ' — ' + r.note });
  await batch.commit();
  if (NATIVE) try { NATIVE.stopSiren(); } catch (e) {}
  modal(`<div class="ecrou"><div class="stamp green">LIBÉRÉE</div><div class="head">LEVÉE D'ÉCROU</div>
    <p>${esc(note)}</p><p>Total : <b>${r.delta >= 0 ? '+' : ''}${r.delta} pts</b></p></div><p></p>
    <button class="big" data-a="kids360">🔓 Débloquer dans Kids 360</button><p></p>
    <button class="ghost" style="width:100%" data-a="close">Fermer</button>`);
}

async function markDone(idx, photoData) {
  const ref = famRef.collection('cells').doc(S.cellId);
  const t = S.cell.tasks[idx];
  if (photoData) await ref.collection('photos').doc(t.key).set({ data: photoData, at: Date.now() });
  await db.runTransaction(async tx => {
    const d = await tx.get(ref); const tasks = d.data().tasks;
    if (!tasks[idx] || tasks[idx].key !== t.key) return;
    tasks[idx].status = 'done'; tasks[idx].doneAt = Date.now(); tasks[idx].hasPhoto = !!photoData;
    tx.update(ref, { tasks });
  });
  toast('Déclaré. Le Gardien inspecte…');
}

function compressPhoto(file) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const max = 900, r = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * r); c.height = Math.round(img.height * r);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src); res(c.toDataURL('image/jpeg', 0.6));
    };
    img.onerror = rej; img.src = URL.createObjectURL(file);
  });
}

async function adjustPoints(sign) {
  const amount = Math.abs(parseInt(document.getElementById('adjAmount').value, 10) || 0);
  const reason = document.getElementById('adjReason').value.trim() || (sign > 0 ? 'Bonne conduite' : 'Infraction au règlement');
  if (!amount) return toast('Indiquez un nombre de points.');
  const batch = db.batch();
  batch.update(famRef, { points: inc(sign * amount) });
  batch.set(famRef.collection('ledger').doc(), { at: Date.now(), delta: sign * amount, reason: (sign > 0 ? 'Bonus : ' : 'Sanction : ') + reason });
  await batch.commit(); toast(sign > 0 ? 'Bonus accordé.' : 'Sanction appliquée.');
}

async function requestPay() {
  const pts = S.fam.points || 0;
  const batch = db.batch();
  batch.set(famRef.collection('requests').doc(), { at: Date.now(), points: pts, euros: euros(pts), month: monthKey(), status: 'pending' });
  await batch.commit();
  toast('Demande de paie envoyée au Gardien.');
}

async function answerRequest(id, pay) {
  const r = S.requests.find(x => x.id === id); if (!r) return;
  const batch = db.batch();
  batch.update(famRef.collection('requests').doc(id), { status: pay ? 'paid' : 'refused', answeredAt: Date.now() });
  if (pay) {
    batch.update(famRef, { points: inc(-r.points) });
    batch.set(famRef.collection('ledger').doc(), { at: Date.now(), delta: -r.points, reason: 'Paie versée : ' + r.euros });
  }
  await batch.commit();
}

/* ---------- notifications (iPhone) ---------- */
async function enablePush() {
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return toast('Alertes refusées. Réglages iPhone → Notifications → Alcatâche.');
    await refreshPushToken(true);
    render();
  } catch (e) { toast('Impossible d\'activer les alertes : ' + e.message); }
}
async function refreshPushToken(loud) {
  if (!S.messagingOk || !('Notification' in window) || Notification.permission !== 'granted' || !famRef) return;
  try {
    const reg = await navigator.serviceWorker.register('firebase-messaging-sw.js');
    await navigator.serviceWorker.ready;
    const token = await firebase.messaging().getToken({ vapidKey: CFG.vapidKey, serviceWorkerRegistration: reg });
    if (token && token !== localStorage.getItem('alca_token')) {
      const old = localStorage.getItem('alca_token');
      const upd = { tokens: firebase.firestore.FieldValue.arrayUnion(token) };
      await famRef.update(upd);
      if (old) await famRef.update({ tokens: firebase.firestore.FieldValue.arrayRemove(old) });
      localStorage.setItem('alca_token', token);
    }
    if (loud) toast('Alertes activées. Bonne chance.');
  } catch (e) { if (loud) toast('Erreur alertes : ' + e.message); console.warn(e); }
}

/* ---------- sirène (écran de la détenue, quand l'appli est ouverte) ---------- */
let actx = null, sirenTimer = null, osc = null, gain = null;
function unlockAudio() {
  if (actx) return;
  try { actx = new (window.AudioContext || window.webkitAudioContext)(); S.audioUnlocked = true; } catch (e) {}
}
function startSiren() {
  if (!actx || sirenTimer) return;
  if (actx.state === 'suspended') actx.resume();
  osc = actx.createOscillator(); gain = actx.createGain();
  osc.type = 'square'; gain.gain.value = 0.12; // désagréable mais volume raisonnable
  osc.connect(gain).connect(actx.destination); osc.start();
  let hi = false;
  sirenTimer = setInterval(() => { hi = !hi; osc.frequency.setValueAtTime(hi ? 1250 : 820, actx.currentTime); }, 380);
}
function stopSiren() {
  if (sirenTimer) clearInterval(sirenTimer); sirenTimer = null;
  try { osc && osc.stop(); } catch (e) {} osc = null;
}
document.addEventListener('visibilitychange', () => { if (document.hidden) stopSiren(); else render(); });

/* ---------- horloge ---------- */
function tick() {
  document.querySelectorAll('[data-since]').forEach(el => { el.textContent = fmtDur(Date.now() - Number(el.dataset.since)); });
}

/* =========================================================
   RENDU
   ========================================================= */
function render() {
  const active = !!(S.cell && S.cell.status === 'active');
  document.body.classList.toggle('alarm', active);
  if (MODE === 'parent') renderParent(active); else renderChild(active);
  tick();
}

/* ---------- Gardien ---------- */
function renderParent(active) {
  if (!fid) {
    $app.innerHTML = `<h1>ALCATÂCHE</h1><p class="type muted">Pénitencier domestique — poste du Gardien</p>
      <div class="card"><h3>Ouvrir une prison</h3><p>Crée l'établissement et génère le code à saisir sur l'iPhone de la détenue.</p>
      <button class="big" data-a="createFam">🏗️ Construire la prison</button></div>
      <div class="card"><h3>J'ai déjà un code</h3><input id="joinCode" placeholder="CODE" autocapitalize="characters">
      <p></p><button class="steel" data-a="joinFam">Reprendre le contrôle</button></div>`;
    return;
  }
  if (!S.fam) { $app.innerHTML = '<div class="loading">Ouverture des grilles…</div>'; return; }
  if (S.lastStatus !== active) { S.tab = active ? 'cellule' : (S.tab === 'cellule' ? 'ecrouer' : S.tab); S.lastStatus = active; }
  const s = st();
  let body = '';
  if (S.tab === 'ecrouer') body = viewEcrouer(active, s);
  if (S.tab === 'cellule') body = viewCellule(active, s);
  if (S.tab === 'casier') body = viewCasier(s, true);
  if (S.tab === 'reglages') body = viewReglages(s);
  const pending = S.requests.filter(r => r.status === 'pending').length;
  const doneWaiting = active ? S.cell.tasks.filter(t => t.status === 'done').length : 0;
  $app.innerHTML = body + `<nav class="tabs">
    ${tabBtn('ecrouer', '🔒', 'Écrouer')}
    ${tabBtn('cellule', active ? '🚨' : '🚪', 'Cellule' + (doneWaiting ? ' (' + doneWaiting + ')' : ''))}
    ${tabBtn('casier', '📁', 'Casier' + (pending ? ' (' + pending + ')' : ''))}
    ${tabBtn('reglages', '⚙️', 'Réglages')}</nav>`;
}
const tabBtn = (id, ico, label) => `<button class="${S.tab === id ? 'on' : ''}" data-a="tab" data-v="${id}"><span class="ico">${ico}</span>${label}</button>`;

function viewEcrouer(active, s) {
  const selKeys = S.selected.map(t => t.id);
  let h = `<h1>ÉCROUER</h1><p class="type muted">Sélectionnez les travaux forcés, dans l'ordre d'exécution.</p>`;
  if (active) h += `<div class="card warn small">🚨 ${esc(s.childName)} est déjà en cellule : les tâches choisies s'ajouteront à sa peine.</div>`;
  allTasks().forEach(c => {
    h += `<div class="cat">— ${esc(c.cat)} —</div><div class="chips">`;
    c.items.forEach(t => {
      const i = selKeys.indexOf(t.id);
      h += `<div class="chip ${i >= 0 ? 'on' : ''}" data-a="pick" data-v="${esc(t.id)}">${t.icon} ${esc(t.label)}${t.photo ? ' <span class="cam">📷</span>' : ''}${i >= 0 ? `<span class="num">${i + 1}</span>` : ''}</div>`;
    });
    h += `</div>`;
  });
  h += `<div class="card"><label>Motif d'incarcération</label><select id="motif">${MOTIFS.map(m => `<option ${m === S.motif ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select>
    <label>Ou motif libre</label><input id="motifFree" value="${esc(S.motifFree)}" placeholder="ex : 4e « j'arrive » en 10 minutes"></div>
    <button class="big" data-a="ecrouer" ${S.selected.length ? '' : 'disabled'}>🔒 ÉCROUER ${esc(s.childName.toUpperCase())}${S.selected.length ? ' (' + S.selected.length + ')' : ''}</button>`;
  return h;
}

function viewCellule(active, s) {
  if (!active) return `<h1>CELLULE</h1><div class="card center"><p style="font-size:60px;margin:0">🚪</p>
    <p class="type">Cellule vide.<br>${esc(s.childName)} est en liberté conditionnelle.</p></div>`;
  const c = S.cell;
  let h = `<h1 class="blink">🚨 CELLULE OCCUPÉE</h1>
    <div class="timer" data-since="${c.createdAt}"></div>
    <p class="center type muted">Motif : ${esc(c.motif)}</p><div class="card">`;
  c.tasks.forEach((t, i) => {
    const b = { todo: '<span class="badge">À faire</span>', done: '<span class="badge done">Déclarée</span>', validated: '<span class="badge ok">Validée</span>' }[t.status];
    const ph = S.photos[t.key];
    h += `<div class="task"><span class="e">${t.icon}</span><div class="t">${esc(t.label)}<br>${b}${t.refused ? ` <span class="badge ref">${t.refused} refus</span>` : ''}</div>
      ${t.status === 'done' && ph ? `<img class="thumb" src="${ph.data}" data-a="photo" data-v="${esc(t.key)}">` : ''}
      ${t.status !== 'validated' ? `<div class="row"><button class="green mini" data-a="ok" data-v="${i}">✔</button>${t.status === 'done' ? `<button class="red mini" data-a="ko" data-v="${i}">✖</button>` : ''}</div>` : ''}</div>`;
  });
  h += `</div>
    <div class="card small">${nativeHasKey() ? `📣 Relance automatique toutes les ${s.intervalSec} s sur l'iPhone, jusqu'à validation complète.` : '⚠️ <b>Clé de service manquante</b> : aucune relance ne part. Réglages → importer la clé.'}
    ${(S.fam.tokens || []).length ? '' : '<br>⚠️ Aucun iPhone n\'a activé les alertes.'}</div>
    <div class="row wrap"><button class="grow" data-a="kids360">📵 Kids 360</button><button class="steel grow" data-a="findmy">🔊 Faire sonner</button></div><p></p>
    <button class="ghost" style="width:100%" data-a="pardon">Grâce présidentielle (libérer sans tout valider)</button>`;
  return h;
}

function viewCasier(s, parent) {
  const pts = S.fam.points || 0;
  let h = `<h1>CASIER JUDICIAIRE</h1><div class="card center"><div class="points ${pts < 0 ? 'neg' : ''}">${pts} pts</div>
    <div class="type">${pts < 0 ? '⛓️ AU MITARD — solde négatif' : 'soit ' + euros(pts) + ' de pécule'}</div>
    <div class="small muted">Taux : ${s.ptsPerEuro} pts = 1 € · paie demandable dès le ${s.payoutDay} du mois</div></div>`;
  if (parent) {
    if (pts < 0) h += `<div class="card danger small">Solde négatif : sanction suggérée → blocage du soir dans Kids 360.<p></p><button class="mini" data-a="kids360">Ouvrir Kids 360</button></div>`;
    h += `<div class="card"><h3>Ajuster la peine</h3><div class="row"><input id="adjAmount" type="number" inputmode="numeric" placeholder="pts" style="width:90px"><input id="adjReason" placeholder="Motif"></div><p></p>
      <div class="row"><button class="green grow" data-a="bonus">+ Bonus</button><button class="red grow" data-a="malus">− Sanction</button></div></div>`;
  }
  const reqs = S.requests;
  if (reqs.length) {
    h += `<div class="card"><h3>Demandes de paie</h3>`;
    reqs.forEach(r => {
      const lab = { pending: '<span class="badge done">En attente</span>', paid: '<span class="badge ok">Payée</span>', refused: '<span class="badge ref">Refusée</span>' }[r.status];
      h += `<div class="task"><div class="t">${fmtDate(r.at)} — <b>${esc(r.euros)}</b> (${r.points} pts)<br>${lab}</div>
        ${parent && r.status === 'pending' ? `<button class="green mini" data-a="pay" data-v="${r.id}">Payé</button><button class="red mini" data-a="nopay" data-v="${r.id}">Non</button>` : ''}</div>`;
    });
    h += `</div>`;
  }
  h += `<div class="card ledger"><h3>Historique</h3>${S.ledger.length ? S.ledger.map(l => `<div><span>${fmtDate(l.at)} · ${esc(l.reason)}</span><b class="${l.delta >= 0 ? 'plus' : 'minus'}">${l.delta >= 0 ? '+' : ''}${l.delta}</b></div>`).join('') : '<p class="muted">Casier vierge… pour l\'instant.</p>'}</div>`;
  return h;
}

function viewReglages(s) {
  const tokens = (S.fam.tokens || []).length;
  const num = (k, label) => `<label>${label}</label><input type="number" inputmode="numeric" data-set="${k}" value="${s[k]}">`;
  return `<h1>RÉGLAGES</h1>
  <div class="card center"><div class="small muted">Code de la prison (à saisir sur l'iPhone)</div>
    <div class="points" style="font-size:34px;letter-spacing:.12em">${esc(fid)}</div>
    <div class="small">${tokens ? '✅ Alertes actives sur ' + tokens + ' appareil(s)' : '⚠️ Alertes pas encore activées sur l\'iPhone'}</div></div>
  <div class="card"><h3>Clé de service Firebase</h3>
    <p class="small">${nativeHasKey() ? '✅ Clé importée : les relances peuvent partir.' : '⚠️ Pas de clé : importez le fichier .json téléchargé depuis Firebase (Comptes de service).'}</p>
    ${NATIVE ? `<input type="file" id="keyFile" accept=".json,application/json"><p></p>
    <button class="steel" data-a="testPush" ${nativeHasKey() && tokens ? '' : 'disabled'}>📣 Tester une alerte</button>` : '<p class="small muted">Disponible uniquement dans l\'APK Android.</p>'}</div>
  <div class="card"><h3>Règlement intérieur</h3>
    <label>Nom de la détenue</label><input data-set="childName" value="${esc(s.childName)}">
    ${num('ptsPerTask', 'Points par tâche validée')}${num('fastBonus', 'Bonus rapidité (pts)')}${num('fastMinutes', '… si tout est fait en moins de (min)')}
    ${num('graceMinutes', 'Délai de grâce avant pénalité (min)')}${num('penaltyPerMin', 'Pénalité par minute de retard (pts)')}
    ${num('refusePenalty', 'Pénalité par tâche refusée (pts)')}${num('ptsPerEuro', 'Points pour 1 €')}${num('payoutDay', 'Paie demandable à partir du jour')}
    ${num('intervalSec', 'Relance toutes les (secondes, min 30)')}<p></p>
    <button data-a="saveSettings">Enregistrer le règlement</button></div>
  <div class="card"><h3>Ajouter une tâche</h3>
    <div class="row"><input id="ctIcon" placeholder="🧹" style="width:70px"><input id="ctLabel" placeholder="Intitulé"></div>
    <label><input type="checkbox" id="ctPhoto" style="width:auto"> Photo obligatoire</label><p></p>
    <button class="steel" data-a="addTask">Ajouter</button>
    ${(s.customTasks || []).map(t => `<div class="task"><span class="e">${t.icon}</span><div class="t">${esc(t.label)}</div><button class="ghost mini" data-a="delTask" data-v="${esc(t.id)}">Suppr.</button></div>`).join('')}</div>
  <p class="center"><button class="ghost mini" data-a="leave">Changer de prison</button></p>`;
}

/* ---------- Détenue ---------- */
function renderChild(active) {
  if (isIOS && !isStandalone && !QS.has('web')) {
    $app.innerHTML = `<h1>ALCATÂCHE</h1><div class="card warn"><h3>Installation obligatoire</h3>
      <p>1. Appuie sur <b>Partager</b> <span style="font-size:20px">⬆️</span> en bas de Safari<br>2. <b>Sur l'écran d'accueil</b><br>3. Ouvre Alcatâche depuis l'icône.</p>
      <p class="small muted">Sans ça, les alertes ne marchent pas. Et oui, ça va sonner.</p></div>`;
    return;
  }
  if (!fid) {
    $app.innerHTML = `<h1>ALCATÂCHE</h1><p class="type muted">Bienvenue au pénitencier domestique.</p>
      <div class="card"><h3>Code de la prison</h3><p class="small">Demande-le à ton Gardien.</p>
      <input id="joinCode" placeholder="CODE" autocapitalize="characters"><p></p>
      <button class="big" data-a="joinFam">Se constituer prisonnière</button></div>`;
    return;
  }
  if (!S.fam) { $app.innerHTML = '<div class="loading">Fouille au corps en cours…</div>'; return; }
  const s = st();
  const pushOff = S.messagingOk && 'Notification' in window && Notification.permission !== 'granted';
  const pushCard = pushOff ? `<div class="card danger above"><h3>Alertes désactivées</h3><p class="small">Obligatoire selon le règlement intérieur.</p><button class="big" data-a="enablePush">🔔 Activer les alertes</button></div>` : '';

  if (active) {
    const c = S.cell;
    const idx = c.tasks.findIndex(t => t.status === 'todo');
    const cur = idx >= 0 ? c.tasks[idx] : null;
    const prog = c.tasks.map(t => `<i class="${t.status === 'validated' ? 'ok' : t.status === 'done' ? 'done' : ''}"></i>`).join('');
    let h = `<div class="bars"></div><div class="above">${pushCard}
      <div class="ecrou"><div class="stamp">ÉCROUÉE</div><div class="head">FICHE D'ÉCROU</div>
      <div>Détenue : <b>${esc(s.childName)}</b></div><div>Motif : <span class="motif">${esc(c.motif)}</span></div>
      <div>Détention : <b data-since="${c.createdAt}"></b></div></div>
      <div class="progress">${prog}</div>`;
    if (cur) {
      h += `<div class="current"><div class="emoji">${cur.icon}</div><div class="label">${esc(cur.label)}</div>
        ${cur.refused ? `<p class="badge ref">Refusée ${cur.refused} fois par le Gardien. Recommence.</p>` : ''}
        <p class="type muted">Travail ${idx + 1} sur ${c.tasks.length}</p></div>
        ${S.audioUnlocked ? `<button class="big" data-a="done" data-v="${idx}">${cur.photo ? '📷 Prendre la preuve' : '✅ C\'est fait'}</button>`
          : `<button class="big shake" data-a="unlock">📢 Prendre connaissance de la sentence</button>`}`;
    } else {
      h += `<div class="current"><div class="emoji">🔎</div><div class="label">Inspection en cours</div>
        <p class="type">Tout est déclaré. Le Gardien vérifie.<br>La sirène s'arrêtera à la validation.</p></div>`;
      if (!S.audioUnlocked) h += `<button class="big shake" data-a="unlock">📢 Prendre connaissance de la sentence</button>`;
    }
    h += `</div>`;
    $app.innerHTML = h;
    if (S.audioUnlocked && !document.hidden) startSiren();
    return;
  }
  stopSiren();
  const pts = S.fam.points || 0;
  const pending = S.requests.some(r => r.status === 'pending');
  const paidThisMonth = S.requests.some(r => r.month === monthKey() && r.status === 'paid');
  const day = new Date().getDate();
  const canPay = pts > 0 && !pending && !paidThisMonth && day >= s.payoutDay;
  $app.innerHTML = `<h1>ALCATÂCHE</h1><p class="type muted">${esc(s.childName)} — en liberté conditionnelle</p>${pushCard}
    ${pts < 0 ? `<div class="card danger center"><h2>⛓️ AU MITARD</h2><p>Solde négatif. Le Gardien peut appliquer une sanction.</p></div>` : ''}
    ${viewCasier(s, false)}
    <div class="card"><h3>Pécule</h3>
      <button class="big" data-a="askPay" ${canPay ? '' : 'disabled'}>💶 Demander ma paie (${euros(pts)})</button>
      <p class="small muted center">${pending ? 'Demande en attente de traitement.' : paidThisMonth ? 'Paie du mois déjà versée. Rendez-vous le mois prochain.' : day < s.payoutDay ? 'Guichet ouvert à partir du ' + s.payoutDay + ' du mois.' : pts <= 0 ? 'Rien à toucher.' : ''}</p></div>`;
}

/* ---------- actions ---------- */
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-a]'); if (!el) return;
  const a = el.dataset.a, v = el.dataset.v;
  try {
    switch (a) {
      case 'close': closeModal(); break;
      case 'tab': S.tab = v; render(); window.scrollTo(0, 0); break;
      case 'createFam': {
        const id = randomId(10);
        await db.collection('families').doc(id).set({ createdAt: Date.now(), points: 0, tokens: [], activeCell: null, settings: { ...DEFAULTS } });
        fid = id; localStorage.setItem('alca_fid', id); connect(); break;
      }
      case 'joinFam': {
        const code = (document.getElementById('joinCode').value || '').trim().toUpperCase().replace(/\s/g, '');
        if (code.length < 6) return toast('Code invalide.');
        const d = await db.collection('families').doc(code).get();
        if (!d.exists) return toast('Code de prison inconnu.');
        fid = code; localStorage.setItem('alca_fid', code); connect(); break;
      }
      case 'pick': {
        const t = allTasks().flatMap(c => c.items).find(x => x.id === v);
        const i = S.selected.findIndex(x => x.id === v);
        if (i >= 0) S.selected.splice(i, 1); else if (t) S.selected.push(t);
        saveDraft(); render(); break;
      }
      case 'ecrouer': saveDraft(); el.disabled = true; await ecrouer(); break;
      case 'ok': await validate(Number(v), true); break;
      case 'ko': await validate(Number(v), false); break;
      case 'pardon': if (confirm('Libérer sans tout valider ? Seules les tâches validées rapportent des points.')) await release(true); break;
      case 'photo': modal(`<img src="${S.photos[v].data}"><p></p><button class="big" data-a="close">Fermer</button>`); break;
      case 'kids360': closeModal(); if (NATIVE) NATIVE.openKids360(); else toast('Ouvrez Kids 360 sur votre téléphone.'); break;
      case 'findmy': if (NATIVE) NATIVE.openUrl('https://www.icloud.com/find'); else window.open('https://www.icloud.com/find'); break;
      case 'bonus': await adjustPoints(1); break;
      case 'malus': await adjustPoints(-1); break;
      case 'pay': await answerRequest(v, true); break;
      case 'nopay': await answerRequest(v, false); break;
      case 'askPay': el.disabled = true; await requestPay(); break;
      case 'saveSettings': {
        const ns = { ...st() };
        document.querySelectorAll('[data-set]').forEach(i => { const k = i.dataset.set; ns[k] = i.type === 'number' ? Math.max(0, Number(i.value) || 0) : i.value.trim(); });
        ns.intervalSec = Math.max(30, ns.intervalSec || 60); ns.ptsPerEuro = Math.max(1, ns.ptsPerEuro); ns.payoutDay = Math.min(28, Math.max(1, ns.payoutDay));
        if (!ns.childName) ns.childName = DEFAULTS.childName;
        await famRef.update({ settings: ns }); toast('Règlement mis à jour.'); break;
      }
      case 'addTask': {
        const label = document.getElementById('ctLabel').value.trim(); if (!label) return toast('Intitulé manquant.');
        const icon = document.getElementById('ctIcon').value.trim() || '⚠️';
        const ns = { ...st() }; ns.customTasks = (ns.customTasks || []).concat({ id: 'c' + Date.now().toString(36), label, icon, photo: document.getElementById('ctPhoto').checked });
        await famRef.update({ settings: ns }); toast('Tâche ajoutée.'); break;
      }
      case 'delTask': { const ns = { ...st() }; ns.customTasks = ns.customTasks.filter(t => t.id !== v); await famRef.update({ settings: ns }); break; }
      case 'testPush': {
        const r = NATIVE.testPush(JSON.stringify({ projectId: CFG.firebase.projectId, apiKey: CFG.firebase.apiKey, fid, childName: st().childName, link: location.origin + location.pathname }));
        toast(r || 'Alerte de test envoyée.'); break;
      }
      case 'leave': if (confirm('Oublier cette prison sur ce téléphone ?')) { localStorage.removeItem('alca_fid'); location.reload(); } break;
      case 'enablePush': await enablePush(); break;
      case 'unlock': unlockAudio(); render(); break;
      case 'done': {
        unlockAudio();
        const idx = Number(v), t = S.cell.tasks[idx];
        if (t.photo) {
          let inp = document.getElementById('photoInput');
          if (!inp) { inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.capture = 'environment'; inp.id = 'photoInput'; inp.hidden = true; document.body.appendChild(inp); }
          inp.value = '';
          inp.onchange = async () => {
            const f = inp.files && inp.files[0]; if (!f) return;
            toast('Envoi de la preuve…');
            try { await markDone(idx, await compressPhoto(f)); } catch (err) { toast('Échec : ' + err.message); }
          };
          inp.click();
        } else { el.disabled = true; await markDone(idx, null); }
        break;
      }
    }
  } catch (err) { console.error(err); toast('Erreur : ' + (err.code || err.message)); el.disabled = false; }
});

function saveDraft() {
  const m = document.getElementById('motif'), f = document.getElementById('motifFree');
  if (m) S.motif = m.value; if (f) S.motifFree = f.value;
}
document.addEventListener('change', async (e) => {
  if (e.target.id === 'motif' || e.target.id === 'motifFree') saveDraft();
  if (e.target.id === 'keyFile' && NATIVE) {
    const f = e.target.files[0]; if (!f) return;
    const txt = await f.text();
    const r = NATIVE.saveServiceKey(txt);
    toast(r === 'ok' ? 'Clé importée ✔' : 'Clé invalide : ' + r); render();
  }
});
document.addEventListener('input', (e) => { if (e.target.id === 'motifFree') S.motifFree = e.target.value; });

init();
