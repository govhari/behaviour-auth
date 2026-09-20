#!/usr/bin/env node
import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { BioPrint } from '../server/core.js';
import { PASSIVE_ROUNDS, PASSIVE_VERSION } from '../server/passive.js';
import * as scoring from '../server/scoring.js';
const ACTIVE_ROUNDS = scoring.ACTIVE_ROUNDS_RECOMMENDED ?? scoring.ACTIVE_ROUNDS ?? 8;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'data', 'benchmark');
const DB = join(DIR, 'simulation.sqlite');
const OUT = join(DIR, (() => { const i = process.argv.indexOf('--noise'); return i > 0 && Number(process.argv[i + 1]) !== 1 ? `simulation-results-noise${process.argv[i + 1]}.json` : 'simulation-results.json'; })());
const DOC = join(ROOT, 'docs', 'BENCHMARK.md');
const arg = (name, dflt) => { const i = process.argv.indexOf('--' + name); return i > 0 ? Number(process.argv[i + 1]) : dflt; };
const USERS = arg('users', 30), LOGINS = arg('logins', 20), SEED = arg('seed', 7);
const NOISE = arg('noise', 1);
const KEY = 'simulation-enrollment-secret', BIND = 'binding-sim';
const DEVICE = { installId: 'install-sim', class: 'desktop-pointer', scroll: false };
const PASSWORD = 'Tr0ub4dor&3xy'; // 13 characters, the same for every account
const SUBMIT = { x: .5, y: .78, w: .16, h: .08 };
const started = performance.now();

function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const hash = s => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
let rng = mulberry32(SEED);
const U = (a, b) => a + (b - a) * rng();
const gauss = () => { let u = 0, v = 0; while (u === 0) u = rng(); while (v === 0) v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const logn = (medianValue, sigma) => medianValue * Math.exp(sigma * gauss());
const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

function persona(id) {
  const seed = hash('persona:' + SEED + ':' + id);
  const p = {
    id, name: `demo_user${String(id).padStart(2, '0')}`, seed,
    dwell: U(80, 140), flight: U(120, 350), sigma: U(.15, .25) * NOISE,
    pauseProb: U(.02, .08), pauseMedian: U(500, 1200), correctionProb: U(0, .04),
    tab: rng() < .7, transition: U(250, 700), keyToPointer: U(150, 500),
    fittsA: U(50, 150), fittsB: U(120, 220), sampleMs: U(7, 17), bow: U(-.15, .15), tremor: U(.001, .004), overshoot: U(0, .03),
    arrival: U(80, 250), hold: U(60, 140), bx: U(.3, .7), by: U(.3, .7), startX: U(.3, .5), startY: U(.4, .5),
  };
  p.keyMul = key => 1 * Math.exp(.25 * gaussFrom(mulberry32(p.seed ^ hash('k' + key))));
  p.dwellMul = key => Math.exp(.15 * gaussFrom(mulberry32(p.seed ^ hash('d' + key))));
  p.posMul = i => Math.exp(.2 * gaussFrom(mulberry32(p.seed ^ hash('p' + i))));
  p.posDwellMul = i => Math.exp(.15 * gaussFrom(mulberry32(p.seed ^ hash('q' + i))));
  return p;
}
function gaussFrom(r) { let u = 0, v = 0; while (u === 0) u = r(); while (v === 0) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
const CONTINUOUS = ['dwell', 'flight', 'sigma', 'pauseProb', 'pauseMedian', 'correctionProb', 'transition', 'keyToPointer', 'fittsA', 'fittsB', 'sampleMs', 'bow', 'tremor', 'overshoot', 'arrival', 'hold', 'bx', 'by', 'startX', 'startY'];
function mimic(impostor, victim) {
  const m = { ...impostor, id: impostor.id, mimicOf: victim.id, tab: victim.tab };
  for (const k of CONTINUOUS) m[k] = impostor[k] + .5 * (victim[k] - impostor[k]);
  for (const f of ['keyMul', 'dwellMul', 'posMul', 'posDwellMul']) m[f] = k => Math.sqrt(impostor[f](k) * victim[f](k));
  return m;
}
const session = () => ({ dwell: logn(1, .06 * NOISE), flight: logn(1, .06 * NOISE), speed: logn(1, .08 * NOISE) });

const submitRect = (x, y) => Math.abs(x - SUBMIT.x) <= SUBMIT.w / 2 && Math.abs(y - SUBMIT.y) <= SUBMIT.h / 2;
const finalize = ev => { ev.sort((a, b) => a.t - b.t); let last = -1; for (const e of ev) { if (e.t < last) e.t = last; last = e.t; } return ev; };

function sweep(p, s, t, x0, y0) {
  const ev = [];
  const gx = SUBMIT.x + gauss() * SUBMIT.w * .12, gy = SUBMIT.y + gauss() * SUBMIT.h * .12;
  const D = Math.hypot(gx - x0, gy - y0), W = SUBMIT.w;
  const MT = (p.fittsA + p.fittsB * Math.log2(D / W + 1)) * logn(1, .12) / s.speed;
  const dt0 = p.sampleMs;
  const nx = -(gy - y0) / D, ny = (gx - x0) / D; // unit normal
  const over = p.overshoot * logn(1, .5);
  let elapsed = 0;
  while (elapsed < MT) {
    const tau = elapsed / MT, sMin = 10 * tau ** 3 - 15 * tau ** 4 + 6 * tau ** 5;
    const along = sMin * (1 + over * Math.sin(Math.PI * Math.min(1, tau * 1.15)) * (tau > .8 ? 1 : 0));
    const bow = p.bow * Math.sin(Math.PI * tau) * D;
    const x = clamp(x0 + (gx - x0) * along + nx * bow + gauss() * p.tremor), y = clamp(y0 + (gy - y0) * along + ny * bow + gauss() * p.tremor);
    ev.push({ type: 'move', x, y, target: submitRect(x, y) ? 'submit' : 'form', pointerType: 'mouse', t: t + elapsed, trusted: true });
    elapsed += dt0 * logn(1, .25);
  }
  // Settle on the target with a few slow corrective samples.
  for (let i = 0; i < 3; i++) { elapsed += dt0 * logn(1.6, .3); const x = clamp(gx + gauss() * p.tremor), y = clamp(gy + gauss() * p.tremor); ev.push({ type: 'move', x, y, target: submitRect(x, y) ? 'submit' : 'form', pointerType: 'mouse', t: t + elapsed, trusted: true }); }
  return { ev, t: t + elapsed, gx, gy };
}

function humanTrace(p, username, password, s = session()) {
  const ev = []; let t = U(300, 900), pos = 0;
  const key = (field, k, code, action, dwell) => {
    const data = { field, position: pos++, action, ...(field === 'username' ? { key: k, code } : {}) };
    ev.push({ type: 'keydown', ...data, t, trusted: true });
    ev.push({ type: 'keyup', ...data, t: t + dwell, trusted: true });
    if (action === 'character' || action === 'correction') ev.push({ type: 'input', field, source: 'typing', t: t + Math.min(1, dwell / 2), trusted: true });
  };
  const typeField = (field, text) => {
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const dwellMul = field === 'username' ? p.dwellMul(ch) : p.posDwellMul(i), flightMul = field === 'username' ? p.keyMul(text[i - 1] + ch) : p.posMul(i);
      const dw = logn(p.dwell * dwellMul * s.dwell, p.sigma);
      if (rng() < p.correctionProb) { // typo, backspace, retype
        key(field, ch === 'a' ? 's' : 'a', 'KeyA', 'character', logn(p.dwell * s.dwell, p.sigma)); t += logn(p.flight * s.flight, p.sigma);
        key(field, 'Backspace', 'Backspace', 'correction', logn(p.dwell * 1.2 * s.dwell, p.sigma)); t += logn(p.flight * 1.3 * s.flight, p.sigma);
      }
      key(field, ch, ch.length === 1 && /[a-z]/i.test(ch) ? 'Key' + ch.toUpperCase() : /\d/.test(ch) ? 'Digit' + ch : 'Key' + ch, 'character', dw);
      t += i < text.length - 1 ? logn(p.flight * flightMul * s.flight, p.sigma) + (rng() < p.pauseProb ? logn(p.pauseMedian, .4) : 0) : dw;
    }
  };
  ev.push({ type: 'focus', field: 'username', active: true, t, trusted: true }); t += U(60, 200);
  typeField('username', username);
  t += logn(p.transition * s.flight, p.sigma);
  if (p.tab) {
    key('username', 'Tab', 'Tab', 'navigation', logn(80, .3));
    ev.push({ type: 'focus', field: 'username', active: false, t: t + 5, trusted: true });
    ev.push({ type: 'focus', field: 'password', active: true, t: t + 6, trusted: true });
    t += logn(p.transition * s.flight, p.sigma);
  } else { // move to the password field and click it
    const x0 = clamp(p.startX + gauss() * .04), y0 = clamp(p.startY - .12 + gauss() * .02);
    let n = 0; const dur = logn(280, .2);
    for (let e = 0; e < dur; e += p.sampleMs * logn(1, .25)) { const tau = e / dur; ev.push({ type: 'move', x: clamp(x0 + gauss() * p.tremor), y: clamp(y0 + .12 * (10 * tau ** 3 - 15 * tau ** 4 + 6 * tau ** 5) + gauss() * p.tremor), target: tau > .9 ? 'password' : 'form', pointerType: 'mouse', t: t + e, trusted: true }); n++; }
    t += dur + logn(p.arrival, .3);
    ev.push({ type: 'down', x: x0, y: y0 + .12, target: 'password', pointerType: 'mouse', t, trusted: true });
    ev.push({ type: 'focus', field: 'username', active: false, t: t + 2, trusted: true });
    ev.push({ type: 'focus', field: 'password', active: true, t: t + 3, trusted: true });
    t += logn(p.hold, .25);
    ev.push({ type: 'up', x: x0, y: y0 + .12, target: 'password', pointerType: 'mouse', t, trusted: true });
    t += logn(p.transition * .6 * s.flight, p.sigma);
  }
  typeField('password', password);
  t += logn(p.keyToPointer, p.sigma);
  const sw = sweep(p, s, t, clamp(p.startX + gauss() * .05), clamp(p.startY + gauss() * .05));
  ev.push(...sw.ev); t = sw.t + logn(p.arrival, .3);
  const bx = clamp(p.bx + gauss() * .08), by = clamp(p.by + gauss() * .08);
  ev.push({ type: 'down', x: sw.gx, y: sw.gy, target: 'submit', pointerType: 'mouse', buttonX: bx, buttonY: by, t, trusted: true });
  t += logn(p.hold, .25);
  ev.push({ type: 'up', x: sw.gx, y: sw.gy, target: 'submit', pointerType: 'mouse', buttonX: bx, buttonY: by, t, trusted: true });
  ev.push({ type: 'submit', method: 'pointer', t: t + U(4, 20), trusted: true });
  return finalize(ev);
}

function botTrace(kind, username, password, attempt = 0) {
  const trusted = kind !== 'naive', jitter = kind === 'jittered';
  const ev = []; let t = 100, pos = 0;
  const D = (kind === 'naive' ? 50 : 45) + (kind === 'naive' ? 3 : 5) * attempt, F = (kind === 'naive' ? 100 : 140) + (kind === 'naive' ? 7 : 11) * attempt, S = (kind === 'naive' ? 10 : 12) + attempt % 7;
  const dwell = () => jitter ? 40 + rng() * 60 : D, flight = () => jitter ? 60 + rng() * 140 : F;
  const key = (field, k, code) => { const data = { field, position: pos++, action: 'character', ...(field === 'username' ? { key: k, code } : {}) }; const d = dwell(); ev.push({ type: 'keydown', ...data, t, trusted }); ev.push({ type: 'input', field, source: 'typing', t: t + .5, trusted }); ev.push({ type: 'keyup', ...data, t: t + d, trusted }); t += flight(); };
  ev.push({ type: 'focus', field: 'username', active: true, t, trusted });
  for (const ch of username) key('username', ch, 'Key' + ch.toUpperCase());
  ev.push({ type: 'focus', field: 'username', active: false, t, trusted }); ev.push({ type: 'focus', field: 'password', active: true, t: t + 1, trusted }); t += jitter ? 200 + rng() * 300 : 200;
  for (const ch of password) key('password', ch);
  t += jitter ? 100 + rng() * 300 : 100;
  const x0 = .3, y0 = .4, N = 40;
  for (let i = 0; i <= N; i++) { const u = i / N, x = x0 + (SUBMIT.x - x0) * u + (jitter ? (rng() - .5) * .001 : 0), y = y0 + (SUBMIT.y - y0) * u + (jitter ? (rng() - .5) * .001 : 0); ev.push({ type: 'move', x, y, target: submitRect(x, y) ? 'submit' : 'form', pointerType: 'mouse', t, trusted }); t += jitter ? 7 + rng() * 8 : S; }
  t += jitter ? 50 + rng() * 150 : 50;
  ev.push({ type: 'down', x: SUBMIT.x, y: SUBMIT.y, target: 'submit', pointerType: 'mouse', buttonX: .5, buttonY: .5, t, trusted }); t += jitter ? 60 + rng() * 60 : 50;
  ev.push({ type: 'up', x: SUBMIT.x, y: SUBMIT.y, target: 'submit', pointerType: 'mouse', buttonX: .5, buttonY: .5, t, trusted });
  ev.push({ type: 'submit', method: 'pointer', t: t + 5, trusted });
  return finalize(ev);
}

function activeTrace(c, p, round = 0) {
  const saved = rng; rng = mulberry32(p.seed ^ (0x5bd1e995 + round));
  try { return activeTraceInner(c, p, session()); } finally { rng = saved; }
}
function activeTraceInner(c, p, s) {
  const ev = []; let t = U(200, 600);
  for (const ch of c.phrase) { const gap = Math.max(60, logn(p.flight * s.flight, p.sigma)), d = Math.min(gap * .85, logn(p.dwell * s.dwell, p.sigma)); ev.push({ type: 'keydown', key: ch, t, trusted: true }); ev.push({ type: 'keyup', key: ch, t: t + d, trusted: true }); t += gap; }
  let prev = { x: clamp(p.startX), y: clamp(p.startY) };
  t += logn(p.keyToPointer, p.sigma);
  for (const goal of c.targets) {
    const D = Math.max(.05, Math.hypot(goal.x - prev.x, goal.y - prev.y)), MT = (p.fittsA + p.fittsB * Math.log2(D / .1 + 1)) / s.speed, nx = -(goal.y - prev.y) / D, ny = (goal.x - prev.x) / D;
    let e = 0; while (e < MT) { const tau = e / MT, sm = 10 * tau ** 3 - 15 * tau ** 4 + 6 * tau ** 5, bow = p.bow * Math.sin(Math.PI * tau) * D; ev.push({ type: 'move', x: clamp(prev.x + (goal.x - prev.x) * sm + nx * bow + gauss() * p.tremor), y: clamp(prev.y + (goal.y - prev.y) * sm + ny * bow + gauss() * p.tremor), t: t + e, trusted: true }); e += p.sampleMs * logn(1, .25); }
    t += e + logn(p.arrival, .3);
    ev.push({ type: 'down', x: goal.x, y: goal.y, t, trusted: true }); t += logn(p.hold, .25);
    ev.push({ type: 'up', x: goal.x, y: goal.y, t, trusted: true }); t += logn(300, .3);
    prev = goal;
  }
  return finalize(ev);
}

mkdirSync(DIR, { recursive: true });
for (const f of [DB, DB + '-wal', DB + '-shm']) rmSync(f, { force: true });
let now = Date.UTC(2026, 0, 1);
const core = new BioPrint(DB, KEY, () => now);
const personas = Array.from({ length: USERS }, (_, i) => persona(i));
const enrolled = [], enrollmentFailures = [];
console.error(`enrolling ${USERS} synthetic users (${ACTIVE_ROUNDS} active + ${PASSIVE_ROUNDS} passive rounds each) ...`);
for (const p of personas) {
  try {
    const flow = core.startEnrollmentFlow(p.name, KEY);
    for (let i = 0; i < ACTIVE_ROUNDS; i++) {
      const c = core.challenge(p.name, 'enroll', flow.activeEnrollment.enrollmentId, flow.activeEnrollment.enrollmentToken, DEVICE, BIND);
      const r = core.submit({ challengeId: c.challengeId, nonce: c.nonce, userId: p.name, events: activeTrace(c, p, i), enrollmentToken: flow.activeEnrollment.enrollmentToken }, 'enroll', BIND);
      if (r.decision !== 'SAMPLE_ACCEPTED') throw Error('active round rejected: ' + r.reasons.join(','));
      now += 45000;
    }
    let accepted = 0, attempts = 0;
    while (accepted < PASSIVE_ROUNDS && attempts < PASSIVE_ROUNDS + 6) {
      const c = core.passiveChallenge(p.name, 'passive-enroll', DEVICE, BIND, flow.passiveEnrollment);
      const r = core.submitPassive({ challengeId: c.challengeId, nonce: c.nonce, userId: p.name, username: p.name, events: humanTrace(p, p.name, PASSWORD), enrollmentToken: flow.passiveEnrollment.enrollmentToken, hints: {} }, 'passive-enroll', BIND);
      attempts++; if (r.decision === 'SAMPLE_ACCEPTED') accepted++; else if (r.decision === 'REJECT') throw Error('passive round rejected: ' + r.reasons.join(','));
      now += 45000;
    }
    const done = core.completeEnrollmentFlow(p.name, flow, BIND);
    const profile = core.profile(p.name);
    enrolled.push({ p, threshold: profile.passive.threshold, calibration: profile.passive.calibration.scores, passiveAttempts: attempts });
  } catch (e) { enrollmentFailures.push({ user: p.name, reason: e.message }); }
}
console.error(`  enrolled ${enrolled.length}/${USERS}` + (enrollmentFailures.length ? `, failed: ${enrollmentFailures.map(f => f.reason).join('; ')}` : ''));

const attempts = []; // every passive-auth attempt with its outcome
function login(victim, events, category, meta = {}) {
  now += 60000 + Math.floor(rng() * 60000);
  const c = core.passiveChallenge(victim, 'passive-auth', DEVICE, BIND);
  const t0 = performance.now();
  const r = core.submitPassive({ challengeId: c.challengeId, nonce: c.nonce, userId: victim, username: victim, events, hints: {} }, 'passive-auth', BIND, true);
  const wallMs = performance.now() - t0;
  attempts.push({ category, victim, ...meta, decision: r.decision, reasons: r.reasons, identityScore: r.identityScore, threshold: r.threshold, quality: r.quality, humanScore: r.humanScore, signals: r.signals, modalities: r.modalities ?? {}, wallMs, verificationMs: r.verificationMs });
  return r;
}
console.error('running genuine logins, impostors, mimics, bots and replays ...');
const captured = {};
for (const { p } of enrolled) {
  for (let i = 0; i < LOGINS; i++) { const ev = humanTrace(p, p.name, PASSWORD); if (!captured[p.name]) captured[p.name] = ev; login(p.name, ev, 'genuine', { actor: p.name }); }
}
for (const { p: victim } of enrolled) {
  for (const { p: other } of enrolled) if (other !== victim) for (let i = 0; i < 2; i++) login(victim.name, humanTrace(other, victim.name, PASSWORD), 'zeroEffort', { actor: other.name });
  const others = enrolled.filter(e => e.p !== victim).map(e => e.p);
  for (let k = 0; k < 6; k++) { const other = others[Math.floor(rng() * others.length)]; const m = mimic(other, victim); for (let i = 0; i < 2; i++) login(victim.name, humanTrace(m, victim.name, PASSWORD), 'mimic', { actor: other.name }); }
  for (const [k, kind] of ['naive', 'forgedTrust', 'jittered'].entries()) for (let i = 0; i < 3; i++) login(victim.name, botTrace(kind, victim.name, PASSWORD, victim.id * 9 + k * 3 + i), 'bot:' + kind, { actor: 'bot' });
  const ev = captured[victim.name];
  login(victim.name, ev.map(e => ({ ...e })), 'replay:exact', { actor: 'replay' });
  login(victim.name, ev.map(e => ({ ...e, t: e.t * 1.03 + 50 })), 'replay:timeScaled', { actor: 'replay' });
}
core.close();

const q = (arr, f) => { const s = arr.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(f * (s.length - 1)))] : null; };
const r4 = x => x === null || x === undefined ? null : Number(x.toFixed(4));
const pct = x => x === null ? 'n/a' : (100 * x).toFixed(1) + '%';
function breakdown(category) {
  const a = attempts.filter(x => x.category === category), n = a.length;
  const count = pred => a.filter(pred).length;
  const reasons = {}; for (const x of a) for (const r of x.reasons) reasons[r] = (reasons[r] ?? 0) + 1;
  return { attempts: n, accept: r4(count(x => x.decision === 'ACCEPT') / n), stepUp: r4(count(x => x.decision === 'STEP_UP') / n), reject: r4(count(x => x.decision === 'REJECT') / n), reasons,
    identityScore: { median: r4(q(a.map(x => x.identityScore), .5)), p10: r4(q(a.map(x => x.identityScore), .1)), p90: r4(q(a.map(x => x.identityScore), .9)) },
    latencyMs: { median: r4(q(a.map(x => x.wallMs), .5)), p95: r4(q(a.map(x => x.wallMs), .95)), engineMedian: r4(q(a.map(x => x.verificationMs), .5)), engineP95: r4(q(a.map(x => x.verificationMs), .95)) } };
}
function eer(genuine, impostor) {
  const g = genuine.filter(Number.isFinite).sort((a, b) => a - b), im = impostor.filter(Number.isFinite).sort((a, b) => a - b);
  const below = (arr, t) => { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < t) lo = m + 1; else hi = m; } return lo; };
  let best = { eer: 1, threshold: null, far: 1, frr: 0 };
  for (const t of new Set([...g, ...im])) { const frr = below(g, t) / g.length, far = 1 - below(im, t) / im.length; if (Math.abs(far - frr) < Math.abs(best.far - best.frr)) best = { eer: (far + frr) / 2, threshold: t, far, frr }; }
  return best;
}
const categories = ['genuine', 'zeroEffort', 'mimic', 'bot:naive', 'bot:forgedTrust', 'bot:jittered', 'replay:exact', 'replay:timeScaled'];
const summary = Object.fromEntries(categories.map(c => [c, breakdown(c)]));
const genuineScores = attempts.filter(x => x.category === 'genuine').map(x => x.identityScore), zeroScores = attempts.filter(x => x.category === 'zeroEffort').map(x => x.identityScore), mimicScores = attempts.filter(x => x.category === 'mimic').map(x => x.identityScore);
const perUser = enrolled.map(({ p, threshold, calibration, passiveAttempts }) => {
  const g = attempts.filter(x => x.category === 'genuine' && x.victim === p.name), z = attempts.filter(x => x.category === 'zeroEffort' && x.victim === p.name);
  return { user: p.name, threshold: r4(threshold), rawCalibration: r4(calibration.length ? median(calibration) - 3 * mad(calibration) : null), passiveAttempts, genuineAccept: r4(g.filter(x => x.decision === 'ACCEPT').length / g.length), zeroEffortAccept: r4(z.filter(x => x.decision === 'ACCEPT').length / z.length), eer: r4(eer(g.map(x => x.identityScore), z.map(x => x.identityScore)).eer) };
});
function median(a) { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? (s[(s.length - 1) >> 1] + s[s.length >> 1]) / 2 : null; }
function mad(a) { const m = median(a); return m === null ? null : median(a.map(x => Math.abs(x - m))); }
const all = attempts.filter(x => x.category !== 'replay:exact' && x.category !== 'replay:timeScaled');
const MODALITIES = ['username', 'password', 'pointer', 'click', 'crossModal'];
const modality = Object.fromEntries(MODALITIES.map(m => {
  const g = attempts.filter(x => x.category === 'genuine').map(x => x.modalities[m]), z = attempts.filter(x => x.category === 'zeroEffort').map(x => x.modalities[m]), mm = attempts.filter(x => x.category === 'mimic').map(x => x.modalities[m]);
  return [m, { genuineMedian: r4(q(g, .5)), zeroEffortMedian: r4(q(z, .5)), mimicMedian: r4(q(mm, .5)), eerZeroEffort: r4(eer(g, z).eer), eerMimic: r4(eer(g, mm).eer) }];
}));
const thresholdSweep = [.5, .6, .7, .75, .8, .85, .9].map(t => ({ threshold: t, genuineFRR: r4(genuineScores.filter(s => !(s >= t)).length / genuineScores.length), zeroEffortFAR: r4(zeroScores.filter(s => s >= t).length / zeroScores.length), mimicFAR: r4(mimicScores.filter(s => s >= t).length / mimicScores.length) }));
const results = {
  synthetic: true, note: 'Synthetic personas driving the real engine. Pipeline behaviour evidence only; see cmu-results.json for real-data evidence.',
  config: { users: USERS, noise: NOISE, enrolled: enrolled.length, enrollmentFailures, loginsPerUser: LOGINS, seed: SEED, passiveRounds: PASSIVE_ROUNDS, activeRounds: ACTIVE_ROUNDS, matcherVersion: PASSIVE_VERSION, password: PASSWORD.length + ' characters', db: DB },
  summary, perUser, modality,
  identityEER: { pooledGenuineVsZeroEffort: eer(genuineScores, zeroScores), pooledGenuineVsMimic: eer(genuineScores, mimicScores), meanPerUserZeroEffort: r4(perUser.reduce((s, u) => s + u.eer, 0) / perUser.length) },
  thresholdSweep,
  latencyMs: { allPassiveAuth: { median: r4(q(all.map(x => x.wallMs), .5)), p95: r4(q(all.map(x => x.wallMs), .95)), max: r4(Math.max(...all.map(x => x.wallMs))) }, enrollmentRounds: null },
  runtimeMs: Math.round(performance.now() - started),
};
writeFileSync(OUT, JSON.stringify(results, null, 2));

const rows = [];
rows.push('| Attempt class | n | ACCEPT | STEP_UP | REJECT | Top reasons | Median identity score (p10–p90) | Decision latency median / p95 (ms) |', '|---|---|---|---|---|---|---|---|');
const labels = { genuine: 'Genuine owner, fresh session', zeroEffort: 'Zero-effort impostor (other persona, correct password)', mimic: 'Mimic impostor (persona moved 50% toward victim)', 'bot:naive': 'Bot: untrusted events, exact timing, straight line', 'bot:forgedTrust': 'Bot: isTrusted spoofed, exact timing', 'bot:jittered': 'Bot: isTrusted spoofed, randomised timing', 'replay:exact': 'Replay: captured genuine login resubmitted', 'replay:timeScaled': 'Replay: same capture, time-scaled ×1.03 + 50 ms' };
for (const c of categories) {
  const s = summary[c];
  const top = Object.entries(s.reasons).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${pct(v / s.attempts)}`).join(', ') || '–';
  rows.push(`| ${labels[c]} | ${s.attempts} | ${pct(s.accept)} | ${pct(s.stepUp)} | ${pct(s.reject)} | ${top} | ${s.identityScore.median ?? 'n/a'} (${s.identityScore.p10 ?? 'n/a'}–${s.identityScore.p90 ?? 'n/a'}) | ${s.latencyMs.median} / ${s.latencyMs.p95} |`);
}
const sweepRows = ['| Fixed passive threshold | Genuine FRR | Zero-effort FAR | Mimic FAR |', '|---|---|---|---|', ...thresholdSweep.map(t => `| ${t.threshold.toFixed(2)} | ${pct(t.genuineFRR)} | ${pct(t.zeroEffortFAR)} | ${pct(t.mimicFAR)} |`)];
const modRows = ['| Modality (fusion weight) | Genuine median | Zero-effort median | Mimic median | EER vs zero-effort | EER vs mimic |', '|---|---|---|---|---|---|', ...MODALITIES.map(m => `| ${m} (${{ username: .2, password: .3, pointer: .25, click: .1, crossModal: .15 }[m]}) | ${modality[m].genuineMedian} | ${modality[m].zeroEffortMedian} | ${modality[m].mimicMedian} | ${pct(modality[m].eerZeroEffort)} | ${pct(modality[m].eerMimic)} |`)];
const md = ['<!-- generated by tools/simulate.js; do not edit by hand -->', '',
  `Synthetic run (noise ×${NOISE}): ${enrolled.length}/${USERS} personas enrolled (${enrollmentFailures.length} enrollment failures${enrollmentFailures.length ? ': ' + enrollmentFailures.map(f => f.reason).join('; ') : ''}), ${LOGINS} genuine logins each, seed ${SEED}, ${attempts.length} passive-auth decisions in ${(results.runtimeMs / 1000).toFixed(1)} s.`, '',
  ...rows, '',
  `Identity-score EER on this synthetic population: ${pct(results.identityEER.pooledGenuineVsZeroEffort.eer)} vs zero-effort impostors (pooled threshold ${results.identityEER.pooledGenuineVsZeroEffort.threshold?.toFixed(3)}), ${pct(results.identityEER.pooledGenuineVsMimic.eer)} vs mimics; mean per-user zero-effort EER ${pct(results.identityEER.meanPerUserZeroEffort)}. Mean calibrated threshold ${(perUser.reduce((s, u) => s + u.threshold, 0) / perUser.length).toFixed(3)}, mean raw calibration (median − 3·MAD of leave-one-out scores) ${(perUser.reduce((s, u) => s + (u.rawCalibration ?? 0), 0) / perUser.length).toFixed(3)}.`, '',
  ...sweepRows, '', ...modRows, '',
  `Server decision latency over all ${all.length} passive-auth calls (SQLite on disk, one process): median ${results.latencyMs.allPassiveAuth.median} ms, p95 ${results.latencyMs.allPassiveAuth.p95} ms, max ${results.latencyMs.allPassiveAuth.max} ms.`, ''].join('\n');
console.log(md);
if (!process.argv.includes('--no-doc') && existsSync(DOC)) {
  const tag = NOISE === 1 ? 'sim' : 'sim-lownoise';
  const doc = readFileSync(DOC, 'utf8'), begin = `<!-- ${tag}:begin -->`, end = `<!-- ${tag}:end -->`;
  if (doc.includes(begin) && doc.includes(end)) { writeFileSync(DOC, doc.slice(0, doc.indexOf(begin) + begin.length) + '\n' + md + doc.slice(doc.indexOf(end))); console.error('updated ' + DOC); }
}
if (!process.argv.includes('--keep-db')) for (const f of [DB, DB + '-wal', DB + '-shm']) rmSync(f, { force: true });
console.error(`wrote ${OUT} in ${results.runtimeMs} ms`);
