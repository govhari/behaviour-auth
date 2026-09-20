#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { analyzePassive, calibratePassive, matchPassive, PASSIVE_ROUNDS, PASSIVE_VERSION } from '../server/passive.js';
import { median, mad } from '../server/features/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'data', 'benchmark');
const CSV = join(DIR, 'DSL-StrongPasswordData.csv');
const SOURCE = 'https://www.cs.cmu.edu/~keystroke/DSL-StrongPasswordData.csv';
const OUT = join(DIR, 'cmu-results.json');
const DOC = join(ROOT, 'docs', 'BENCHMARK.md');
const started = performance.now();

mkdirSync(DIR, { recursive: true });
if (!existsSync(CSV)) {
  console.error('downloading ' + SOURCE);
  const res = await fetch(SOURCE);
  if (!res.ok) throw Error('download failed: HTTP ' + res.status);
  writeFileSync(CSV, Buffer.from(await res.arrayBuffer()));
}
const lines = readFileSync(CSV, 'utf8').trim().split(/\r?\n/);
const header = lines[0].split(',');
const col = Object.fromEntries(header.map((h, i) => [h, i]));
const KEYS = ['period', 't', 'i', 'e', 'five', 'Shift.r', 'o', 'a', 'n', 'l'];
const CHARS = ['.', 't', 'i', 'e', '5', 'R', 'o', 'a', 'n', 'l'];
const CODES = ['Period', 'KeyT', 'KeyI', 'KeyE', 'Digit5', 'KeyR', 'KeyO', 'KeyA', 'KeyN', 'KeyL'];
const FEATURE_COLUMNS = header.slice(3); // the paper's 31 timing features
const rows = lines.slice(1).map(l => l.split(','));
const subjects = [...new Set(rows.map(r => r[0]))];

function timeline(r) {
  const downs = [], ups = [];
  let t = 300;
  for (let i = 0; i < KEYS.length; i++) {
    if (i > 0) t += 1000 * Number(r[col['DD.' + KEYS[i - 1] + '.' + KEYS[i]]]);
    downs.push(t);
    ups.push(t + 1000 * Number(r[col['H.' + KEYS[i]]]));
  }
  const enter = downs.at(-1) + 1000 * Number(r[col['DD.l.Return']]);
  return { downs, ups, enter };
}

function toEvents(r, field) {
  const { downs, ups, enter } = timeline(r);
  const ev = [];
  for (let i = 0; i < KEYS.length; i++) {
    const data = { field, position: i, action: 'character', ...(field === 'username' ? { key: CHARS[i], code: CODES[i] } : {}) };
    ev.push({ type: 'keydown', ...data, t: downs[i], trusted: true });
    ev.push({ type: 'keyup', ...data, t: ups[i], trusted: true });
    ev.push({ type: 'input', field, source: 'typing', t: downs[i] + 1, trusted: true });
  }
  ev.sort((a, b) => a.t - b.t);
  ev.push({ type: 'submit', method: 'keyboard', t: Math.max(enter, ev.at(-1).t), trusted: true });
  return ev;
}
const slim = a => ({ stats: a.stats, evidenceQuality: a.evidenceQuality, quality: a.quality, signals: a.signals, complete: a.complete });

console.error(`deriving ${rows.length} repetitions x 2 field variants through analyzePassive ...`);
const data = {};
const signalCounts = {};
for (const r of rows) {
  const subject = r[0];
  const pw = analyzePassive(toEvents(r, 'password')), un = analyzePassive(toEvents(r, 'username'));
  for (const s of [...pw.signals, ...un.signals]) signalCounts[s] = (signalCounts[s] ?? 0) + 1;
  (data[subject] ??= []).push({ session: Number(r[1]), rep: Number(r[2]), password: slim(pw), username: slim(un), vector: FEATURE_COLUMNS.map((_, i) => Number(r[3 + i])) });
}
for (const s of subjects) data[s].sort((a, b) => a.session - b.session || a.rep - b.rep);

function eer(genuine, impostor) {
  const g = genuine.filter(Number.isFinite).sort((a, b) => a - b), im = impostor.filter(Number.isFinite).sort((a, b) => a - b);
  const candidates = [...new Set([...g, ...im])].sort((a, b) => a - b);
  let best = { eer: 1, threshold: null, far: 1, frr: 0 };
  const roc = [];
  const below = (arr, t) => { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < t) lo = m + 1; else hi = m; } return lo; };
  for (const t of candidates) {
    const frr = below(g, t) / g.length, far = 1 - below(im, t) / im.length;
    roc.push([t, far, frr]);
    if (Math.abs(far - frr) < Math.abs(best.far - best.frr)) best = { eer: (far + frr) / 2, threshold: t, far, frr };
  }
  return { ...best, roc };
}
const rate = (arr, pred) => arr.length ? arr.filter(pred).length / arr.length : null;
const mean = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
const sd = arr => { const m = mean(arr); return arr.length > 1 ? Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / (arr.length - 1)) : null; };
const r4 = x => x === null || x === undefined ? null : Number(x.toFixed(4));

function scaledManhattan(train) {
  const n = train[0].length, mu = [], dev = [];
  for (let j = 0; j < n; j++) {
    const v = train.map(x => x[j]);
    mu.push(mean(v));
    dev.push(Math.max(1e-6, mean(v.map(x => Math.abs(x - mu[j])))));
  }
  return x => -x.reduce((s, xi, j) => s + Math.abs(xi - mu[j]) / dev[j], 0);
}

function bioprintRun(field, trainIdx, testIdx = reps => reps.slice(200)) {
  const perUser = [];
  for (const subject of subjects) {
    const reps = data[subject];
    const train = trainIdx(reps).map(r => r[field]);
    const profile = calibratePassive(train);
    const score = sample => { const m = matchPassive(sample, profile), f = m.features[field].filter(x => Number.isFinite(x.score)); const w = f.reduce((s, x) => s + x.weight, 0); return { geo: m.score, arith: w ? f.reduce((s, x) => s + x.weight * x.score, 0) / w : null, outlier: f.length ? f.filter(x => x.z <= 1.96).length / f.length : null }; };
    const g = testIdx(reps).map(r => score(r[field])), im = subjects.filter(s => s !== subject).flatMap(s => data[s].slice(0, 5).map(r => score(r[field])));
    const genuine = g.map(x => x.geo), impostor = im.map(x => x.geo);
    const e = eer(genuine, impostor);
    const loo = [...profile.calibration.scores].sort((a, b) => a - b), p10 = loo.length ? loo[Math.floor(.1 * (loo.length - 1))] : null;
    perUser.push({ subject, threshold: profile.threshold, calibratedRaw: (median(profile.calibration.scores) ?? .85) - 3 * (mad(profile.calibration.scores) ?? 0), eer: e.eer, eerThreshold: e.threshold, genuine, impostor,
      p10Rule: { threshold: p10, far: rate(impostor, s => s >= p10), frr: rate(genuine, s => !(s >= p10)) },
      alt: { arithmetic: eer(g.map(x => x.arith), im.map(x => x.arith)), outlierCount: eer(g.map(x => x.outlier), im.map(x => x.outlier)) },
      production: { far: rate(impostor, s => s >= profile.threshold), frr: rate(genuine, s => !(s >= profile.threshold)) } });
  }
  return perUser;
}
function summarize(perUser) {
  const eers = perUser.map(u => u.eer);
  const floorSweep = [.5, .6, .7, .75, .8, .85, .9].map(floor => {
    const far = [], frr = [];
    for (const u of perUser) { const t = Math.max(floor, Math.min(.97, u.calibratedRaw)); far.push(rate(u.impostor, s => s >= t)); frr.push(rate(u.genuine, s => !(s >= t))); }
    return { floor, meanFAR: r4(mean(far)), meanFRR: r4(mean(frr)) };
  });
  const fixed = [.5, .6, .7, .75, .8, .85, .9, .95].map(t => ({ threshold: t, meanFAR: r4(mean(perUser.map(u => rate(u.impostor, s => s >= t)))), meanFRR: r4(mean(perUser.map(u => rate(u.genuine, s => !(s >= t))))) }));
  const pooled = eer(perUser.flatMap(u => u.genuine), perUser.flatMap(u => u.impostor));
  return {
    meanEER: r4(mean(eers)), sdEER: r4(sd(eers)), medianEER: r4(median(eers)), minEER: r4(Math.min(...eers)), maxEER: r4(Math.max(...eers)),
    pooledEER: r4(pooled.eer), pooledEERThreshold: r4(pooled.threshold),
    meanEERThreshold: r4(mean(perUser.map(u => u.eerThreshold))),
    production: { rule: 'max(0.85, min(0.97, median(LOO) - 3*MAD(LOO)))', meanCalibratedRaw: r4(mean(perUser.map(u => u.calibratedRaw))), meanThreshold: r4(mean(perUser.map(u => u.threshold))), usersAtFloor: perUser.filter(u => u.threshold === .85).length, meanFAR: r4(mean(perUser.map(u => u.production.far))), meanFRR: r4(mean(perUser.map(u => u.production.frr))) },
    floorSweep, fixedThreshold: fixed,
    looPercentileRule: { rule: '10th percentile of leave-one-out enrollment scores, no floor', meanThreshold: r4(mean(perUser.map(u => u.p10Rule.threshold))), meanFAR: r4(mean(perUser.map(u => u.p10Rule.far))), meanFRR: r4(mean(perUser.map(u => u.p10Rule.frr))) },
    whatIf: { arithmeticMeanFusion: { meanEER: r4(mean(perUser.map(u => u.alt.arithmetic.eer))), meanEERThreshold: r4(mean(perUser.map(u => u.alt.arithmetic.threshold))) }, outlierCount196: { meanEER: r4(mean(perUser.map(u => u.alt.outlierCount.eer))), meanEERThreshold: r4(mean(perUser.map(u => u.alt.outlierCount.threshold))) } },
    perUser: perUser.map(u => ({ subject: u.subject, eer: r4(u.eer), eerThreshold: r4(u.eerThreshold), calibratedThreshold: r4(u.threshold), productionFAR: r4(u.production.far), productionFRR: r4(u.production.frr) })),
  };
}

console.error('scoring ...');
const first200 = reps => reps.slice(0, 200);
const first10 = reps => reps.slice(0, PASSIVE_ROUNDS);
const last10 = reps => reps.slice(200 - PASSIVE_ROUNDS, 200);
const interleavedTrain = reps => reps.slice(0, 200).filter((_, i) => i % 4 !== 3);
const interleavedTest = reps => reps.slice(0, 200).filter((_, i) => i % 4 === 3);
const results = {
  dataset: { name: 'CMU DSL-StrongPasswordData', source: SOURCE, subjects: subjects.length, repetitions: rows.length, password: '.tie5Roanl' },
  citation: 'K. S. Killourhy and R. A. Maxion, "Comparing Anomaly-Detection Algorithms for Keystroke Dynamics", DSN 2009. Reported mean EERs: scaled Manhattan 0.096, nearest-neighbor (Mahalanobis) 0.100, outlier-count (z-score) 0.102.',
  protocol: { train: 'first 200 repetitions of the subject (sessions 1-4)', genuineTest: 'remaining 200 repetitions (sessions 5-8)', impostorTest: 'first 5 repetitions of each of the other 50 subjects (250 attempts)', thresholdSweep: 'per-subject, over all observed scores; EER = (FAR+FRR)/2 at the closest crossing', subsampling: 'none, all 20,400 repetitions used' },
  engine: { matcherVersion: PASSIVE_VERSION, passiveRounds: PASSIVE_ROUNDS, howScored: 'analyzePassive on a keydown/keyup stream with a keyboard submit and no pointer events; matchPassive against calibratePassive(model); with a single available modality the fused score equals that modality score', automationSignalsTripped: signalCounts },
  bioprint: {
    passwordField: { description: 'keys hidden (position + action only): median dwell, down-down, up-down, overlap ratio, pause ratio, burst length, pause median/spread, correction and modifier ratios', enroll200: null, enroll10First: null, enroll10Last: null, enroll150Interleaved: null },
    usernameField: { description: 'keys visible: the password-field features plus per-key hold times and per-digraph down-down latencies (the product learns these for the username)', enroll200: null, enroll10First: null, enroll10Last: null, enroll150Interleaved: null },
  },
  baselines: {},
  runtimeMs: null,
};
for (const field of ['password', 'username']) {
  const key = field + 'Field';
  results.bioprint[key].enroll200 = summarize(bioprintRun(field, first200));
  results.bioprint[key].enroll10First = summarize(bioprintRun(field, first10));
  results.bioprint[key].enroll10Last = summarize(bioprintRun(field, last10));
  results.bioprint[key].enroll150Interleaved = summarize(bioprintRun(field, interleavedTrain, interleavedTest));
  console.error(`  ${key}: mean EER 200-rep ${results.bioprint[key].enroll200.meanEER}, 10-rep(first) ${results.bioprint[key].enroll10First.meanEER}, 10-rep(last) ${results.bioprint[key].enroll10Last.meanEER}`);
}
for (const [name, trainIdx, testIdx] of [['enroll200', first200], ['enroll10First', first10], ['enroll10Last', last10], ['enroll150Interleaved', interleavedTrain, interleavedTest]]) {
  const perUser = [];
  for (const subject of subjects) {
    const reps = data[subject];
    const score = scaledManhattan(trainIdx(reps).map(r => r.vector));
    const genuine = (testIdx ?? (r => r.slice(200)))(reps).map(r => score(r.vector));
    const impostor = subjects.filter(s => s !== subject).flatMap(s => data[s].slice(0, 5).map(r => score(r.vector)));
    perUser.push({ subject, ...eer(genuine, impostor), genuine, impostor });
  }
  const eers = perUser.map(u => u.eer);
  results.baselines['scaledManhattan_' + name] = { meanEER: r4(mean(eers)), sdEER: r4(sd(eers)), medianEER: r4(median(eers)), pooledEER: r4(eer(perUser.flatMap(u => u.genuine), perUser.flatMap(u => u.impostor)).eer), perUser: perUser.map(u => ({ subject: u.subject, eer: r4(u.eer) })) };
  console.error(`  scaled Manhattan ${name}: mean EER ${results.baselines['scaledManhattan_' + name].meanEER}`);
}
results.baselines.paperReported = { scaledManhattan: .096, nearestNeighborMahalanobis: .1, outlierCountZScore: .102 };
results.runtimeMs = Math.round(performance.now() - started);
writeFileSync(OUT, JSON.stringify(results, null, 2));

const pct = x => x === null ? 'n/a' : (100 * x).toFixed(1) + '%';
const B = results.bioprint, M = results.baselines;
const table = [];
table.push('| Detector | Enrollment | Mean EER (± sd) | Median EER | Pooled EER |', '|---|---|---|---|---|');
table.push(`| Scaled Manhattan (paper's best, our re-implementation) | 200 reps | ${pct(M.scaledManhattan_enroll200.meanEER)} (± ${pct(M.scaledManhattan_enroll200.sdEER)}) | ${pct(M.scaledManhattan_enroll200.medianEER)} | ${pct(M.scaledManhattan_enroll200.pooledEER)} |`);
table.push(`| Scaled Manhattan (paper, reported) | 200 reps | 9.6% (± 6.9%) | – | – |`);
table.push(`| Scaled Manhattan | 10 reps (first) | ${pct(M.scaledManhattan_enroll10First.meanEER)} (± ${pct(M.scaledManhattan_enroll10First.sdEER)}) | ${pct(M.scaledManhattan_enroll10First.medianEER)} | ${pct(M.scaledManhattan_enroll10First.pooledEER)} |`);
table.push(`| Scaled Manhattan | 10 reps (last of train block) | ${pct(M.scaledManhattan_enroll10Last.meanEER)} (± ${pct(M.scaledManhattan_enroll10Last.sdEER)}) | ${pct(M.scaledManhattan_enroll10Last.medianEER)} | ${pct(M.scaledManhattan_enroll10Last.pooledEER)} |`);
table.push(`| Scaled Manhattan | 150 reps, same-session hold-out (drift control) | ${pct(M.scaledManhattan_enroll150Interleaved.meanEER)} (± ${pct(M.scaledManhattan_enroll150Interleaved.sdEER)}) | ${pct(M.scaledManhattan_enroll150Interleaved.medianEER)} | ${pct(M.scaledManhattan_enroll150Interleaved.pooledEER)} |`);
for (const [key, label] of [['usernameField', 'BioPrint username-field matcher (keys visible, per-key hold + digraph)'], ['passwordField', 'BioPrint password-field matcher (keys hidden, medians only)']]) {
  for (const [v, name] of [['enroll200', '200 reps'], ['enroll10First', `${PASSIVE_ROUNDS} reps (first)`], ['enroll10Last', `${PASSIVE_ROUNDS} reps (last of train block)`], ['enroll150Interleaved', '150 reps, same-session hold-out (drift control)']]) {
    const s = B[key][v];
    table.push(`| ${label} | ${name} | ${pct(s.meanEER)} (± ${pct(s.sdEER)}) | ${pct(s.medianEER)} | ${pct(s.pooledEER)} |`);
  }
}
const prod = [];
prod.push('| Matcher | Enrollment | Mean raw calibration (median−3·MAD) | Mean threshold after 0.85 floor | Users at floor | Mean FAR | Mean FRR | Mean per-user EER threshold | LOO-p10 rule: threshold → FAR / FRR |', '|---|---|---|---|---|---|---|---|---|');
for (const [key, label] of [['usernameField', 'username-field'], ['passwordField', 'password-field']])
  for (const [v, name] of [['enroll200', '200 reps'], ['enroll10First', `${PASSIVE_ROUNDS} reps (first)`], ['enroll10Last', `${PASSIVE_ROUNDS} reps (last)`]]) {
    const p = B[key][v].production;
    const l = B[key][v].looPercentileRule;
    prod.push(`| ${label} | ${name} | ${p.meanCalibratedRaw.toFixed(3)} | ${p.meanThreshold.toFixed(3)} | ${p.usersAtFloor}/${subjects.length} | ${pct(p.meanFAR)} | ${pct(p.meanFRR)} | ${B[key][v].meanEERThreshold.toFixed(3)} | ${l.meanThreshold.toFixed(3)} → ${pct(l.meanFAR)} / ${pct(l.meanFRR)} |`);
  }
const whatIf = ['| Fusion of the same BioPrint feature terms | Enrollment | username-field mean EER | password-field mean EER |', '|---|---|---|---|'];
for (const [v, name] of [['enroll200', '200 reps'], ['enroll10Last', `${PASSIVE_ROUNDS} reps (last)`]]) {
  whatIf.push(`| Geometric mean (current engine) | ${name} | ${pct(B.usernameField[v].meanEER)} | ${pct(B.passwordField[v].meanEER)} |`);
  whatIf.push(`| Weighted arithmetic mean (what-if) | ${name} | ${pct(B.usernameField[v].whatIf.arithmeticMeanFusion.meanEER)} | ${pct(B.passwordField[v].whatIf.arithmeticMeanFusion.meanEER)} |`);
  whatIf.push(`| Outlier count, fraction of features within 1.96 scales (what-if) | ${name} | ${pct(B.usernameField[v].whatIf.outlierCount196.meanEER)} | ${pct(B.passwordField[v].whatIf.outlierCount196.meanEER)} |`);
}
const sweep = [];
sweep.push('| Fixed threshold | username-field FAR / FRR (200 reps) | username-field FAR / FRR (10 reps) | password-field FAR / FRR (200 reps) | password-field FAR / FRR (10 reps) |', '|---|---|---|---|---|');
for (let i = 0; i < B.usernameField.enroll200.fixedThreshold.length; i++) {
  const a = B.usernameField.enroll200.fixedThreshold[i], b = B.usernameField.enroll10First.fixedThreshold[i], c = B.passwordField.enroll200.fixedThreshold[i], d = B.passwordField.enroll10First.fixedThreshold[i];
  sweep.push(`| ${a.threshold.toFixed(2)} | ${pct(a.meanFAR)} / ${pct(a.meanFRR)} | ${pct(b.meanFAR)} / ${pct(b.meanFRR)} | ${pct(c.meanFAR)} / ${pct(c.meanFRR)} | ${pct(d.meanFAR)} / ${pct(d.meanFRR)} |`);
}
const md = ['<!-- generated by tools/benchmark-cmu.js; do not edit by hand -->', '', '**Equal error rate (per-subject threshold sweep, mean over 51 subjects)**', '', ...table, '', '**Production decision rule** (per-user `calibratePassive` threshold = max(0.85, min(0.97, median(LOO) − 3·MAD(LOO))); accept when score ≥ threshold)', '', ...prod, '', '**Fusion what-ifs** (offline, from the feature terms the real matcher returns; no engine change)', '', ...whatIf, '', '**Fixed-threshold sweep** (mean over subjects; the row where FAR ≈ FRR is the operating point the floor should target)', '', ...sweep, '', `Runtime: ${(results.runtimeMs / 1000).toFixed(1)} s for ${rows.length} repetitions; automation signals tripped by real humans in this corpus: ${Object.entries(signalCounts).map(([k, v]) => `${k} ×${v}`).join(', ') || 'none'}.`, ''].join('\n');
console.log(md);
if (!process.argv.includes('--no-doc') && existsSync(DOC)) {
  const doc = readFileSync(DOC, 'utf8'), begin = '<!-- cmu:begin -->', end = '<!-- cmu:end -->';
  if (doc.includes(begin) && doc.includes(end)) {
    writeFileSync(DOC, doc.slice(0, doc.indexOf(begin) + begin.length) + '\n' + md + doc.slice(doc.indexOf(end)));
    console.error('updated ' + DOC);
  }
}
console.error(`wrote ${OUT} in ${results.runtimeMs} ms`);
