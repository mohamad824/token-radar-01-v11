// token-radar-01 v11 — COMBINATION (batch 1: v6-v10).
// v9 chassis + visual system, v10 odds panel as passenger, v8 evidence battery
// as engine, v6 model A lam30 as foundation. Written from scratch from the
// v11 combination brief; no prior entry source was read.
// Node 22 only, stdlib only, erasable TS, deterministic, no network at runtime.
// Usage: node main.ts --input /input/snapshot.json --output /output
// Reads the sealed snapshot, writes board.json + dashboard/data.js, copies
// dashboard/ + screenshots/ to /output, writes dossier.json (when screenshots exist).

import { buildDossier } from './vendor/makefun-board.ts';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const NODE = process.version;
if (!NODE.startsWith('v22.')) throw new Error(`v11 needs Node 22, got ${NODE}`);

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}
const INPUT = resolve(arg('--input', '/input/snapshot.json'));
const OUTPUT = resolve(arg('--output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output'));

// ------------------------------------------------------------------ strict snapshot parsing (D-33: reject, never guess)
interface Proto {
  slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; change_7d: number | null; mcap_usd: number | null;
  listed_at: string | null; gecko_id: string | null; symbol: string | null;
}
function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}
function parseSnapshot(text: string): { as_of: string; floor_usd: number; watchlist: string[]; protocols: Proto[] } {
  const raw: unknown = JSON.parse(text);
  if (!isObj(raw)) throw new Error('snapshot is not an object');
  const as_of = raw.as_of; const floor_usd = raw.floor_usd;
  const watchlist = raw.watchlist; const protocols = raw.protocols;
  if (typeof as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(as_of)) throw new Error('snapshot as_of is not a date');
  if (typeof floor_usd !== 'number' || floor_usd <= 0) throw new Error('snapshot floor_usd is not a positive number');
  if (!Array.isArray(watchlist) || !watchlist.every((s) => typeof s === 'string')) throw new Error('snapshot watchlist is not a string array');
  if (!Array.isArray(protocols)) throw new Error('snapshot protocols is not an array');
  const seen = new Set<string>();
  const out: Proto[] = protocols.map((p, i) => {
    if (!isObj(p)) throw new Error(`protocol ${i} is not an object`);
    const keys = Object.keys(p).sort();
    const want = ['category', 'chains', 'change_7d', 'gecko_id', 'listed_at', 'mcap_usd', 'name', 'slug', 'symbol', 'tvl_usd'];
    if (keys.join(',') !== want.join(',')) throw new Error(`protocol ${i} (${String(p.slug ?? '?')}): fields are not exactly the ten snapshot fields`);
    const slug = p.slug; const name = p.name; const category = p.category; const chains = p.chains;
    const tvl = p.tvl_usd; const chg = p.change_7d;
    // mcap_usd === -1 is the snapshot's sentinel for "unknown" (exactly one
    // row: AUTOfinance, which has a gecko_id and a symbol, so it counts as
    // has-token in D-62 but never as traded). Treat it as null.
    const mcap = p.mcap_usd === -1 ? null : p.mcap_usd;
    const listed = p.listed_at; const gecko = p.gecko_id; const symbol = p.symbol;
    if (typeof slug !== 'string' || !slug || /\s/.test(slug)) throw new Error(`protocol ${i}: bad slug`);
    if (seen.has(slug)) throw new Error(`protocol ${i}: duplicate slug ${slug}`);
    seen.add(slug);
    if (typeof name !== 'string' || !name) throw new Error(`protocol ${i}: bad name`);
    if (!(category === null || typeof category === 'string')) throw new Error(`protocol ${i}: bad category`);
    if (!Array.isArray(chains) || !chains.every((c) => typeof c === 'string' && c)) throw new Error(`protocol ${i}: bad chains`);
    if (typeof tvl !== 'number' || !Number.isFinite(tvl) || tvl < 0 || Math.floor(tvl) !== tvl) throw new Error(`protocol ${i}: bad tvl_usd`);
    if (!(chg === null || (typeof chg === 'number' && Number.isFinite(chg)))) throw new Error(`protocol ${i}: bad change_7d`);
    if (!(mcap === null || (typeof mcap === 'number' && Number.isFinite(mcap) && mcap >= 0))) throw new Error(`protocol ${i}: bad mcap_usd`);
    if (!(listed === null || (typeof listed === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(listed)))) throw new Error(`protocol ${i}: bad listed_at`);
    if (!(gecko === null || typeof gecko === 'string')) throw new Error(`protocol ${i}: bad gecko_id`);
    if (!(symbol === null || typeof symbol === 'string')) throw new Error(`protocol ${i}: bad symbol`);
    return { slug, name, category, chains: chains as string[], tvl_usd: tvl, change_7d: chg, mcap_usd: mcap, listed_at: listed, gecko_id: gecko, symbol };
  });
  return { as_of, floor_usd, watchlist: watchlist as string[], protocols: out };
}

// ------------------------------------------------------------------ math utilities
const LOG10 = Math.log10;
const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));
const jsRound = (x: number): number => Math.round(x); // JS Math.round: halves round up (positive x)
const sum = (a: number[]): number => a.reduce((s, v) => s + v, 0);
const mean = (a: number[]): number => sum(a) / a.length;
const median = (a: number[]): number => quantile([...a].sort((x, y) => x - y), 0.5);
/** numpy-linear quantile on a SORTED array. */
function quantile(sorted: number[], q: number): number {
  const n = sorted.length;
  if (n === 0) throw new Error('quantile of empty array');
  if (n === 1) return sorted[0]!;
  const pos = q * (n - 1);
  const lo = Math.floor(pos); const hi = Math.ceil(pos);
  return sorted[lo]! + (pos - lo) * (sorted[hi]! - sorted[lo]!);
}
function percentile(sorted: number[], q: number): number { return quantile(sorted, q / 100); }
/** Spearman rank correlation (average ranks on ties). */
function spearman(xs: number[], ys: number[]): number {
  const rank = (a: number[]): number[] => {
    const idx = a.map((_, i) => i).sort((i, j) => a[i]! - a[j]!);
    const r = new Array<number>(a.length);
    let i = 0;
    while (i < a.length) {
      let j = i;
      while (j + 1 < a.length && a[idx[j + 1]!] === a[idx[i]!]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k]!] = avg;
      i = j + 1;
    }
    return r;
  };
  const rx = rank(xs); const ry = rank(ys);
  const mx = mean(rx); const my = mean(ry);
  let num = 0; let dx = 0; let dy = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (rx[i]! - mx) * (ry[i]! - my);
    dx += (rx[i]! - mx) ** 2; dy += (ry[i]! - my) ** 2;
  }
  return num / Math.sqrt(dx * dy);
}
function pearson(xs: number[], ys: number[]): number {
  const mx = mean(xs); const my = mean(ys);
  let num = 0; let dx = 0; let dy = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my);
    dx += (xs[i]! - mx) ** 2; dy += (ys[i]! - my) ** 2;
  }
  return num / Math.sqrt(dx * dy);
}
/** Solve A x = b by Gaussian elimination with partial pivoting (deterministic). */
function solveLinear(Ain: number[][], bin: number[]): number[] {
  const n = bin.length;
  const A = Ain.map((row) => [...row]);
  const b = [...bin];
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r]![col]!) > Math.abs(A[piv]![col]!)) piv = r;
    if (Math.abs(A[piv]![col]!) < 1e-300) throw new Error('solveLinear: singular matrix');
    if (piv !== col) { const t = A[col]!; A[col] = A[piv]!; A[piv] = t; const tb = b[col]!; b[col] = b[piv]!; b[piv] = tb; }
    for (let r = col + 1; r < n; r++) {
      const f = A[r]![col]! / A[col]![col]!;
      for (let c = col; c < n; c++) A[r]![c]! -= f * A[col]![c]!;
      b[r]! -= f * b[col]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i]!;
    for (let j = i + 1; j < n; j++) s -= A[i]![j]! * x[j]!;
    x[i] = s / A[i]![i]!;
  }
  return x;
}

// ------------------------------------------------------------------ MT19937, numpy RandomState compatible (rk_seed)
// numpy's legacy RandomState seeds a scalar with rk_seed, not init_by_array:
//   state[pos] = seed; seed = 1812433253*(seed ^ (seed>>30)) + pos + 1 (mod 2^32).
// randint below n uses masking: mask = smallest (2^k - 1) >= n-1, reject draws >= n.
// Verified byte-for-byte against numpy RandomState(0) (raw uint32, rand(), choice()).
class MT19937 {
  private mt = new Array<number>(624).fill(0);
  private idx = 624;
  constructor(seed: number) {
    let s = seed >>> 0;
    for (let pos = 0; pos < 624; pos++) {
      this.mt[pos] = s;
      s = (Math.imul(1812433253, s ^ (s >>> 30)) + pos + 1) >>> 0;
    }
    this.idx = 624;
  }
  uint32(): number {
    if (this.idx >= 624) {
      for (let i = 0; i < 624; i++) {
        const y = (this.mt[i]! & 0x80000000) | (this.mt[(i + 1) % 624]! & 0x7fffffff);
        let v = this.mt[(i + 397) % 624]! ^ (y >>> 1);
        if (y & 1) v ^= 0x9908b0df;
        this.mt[i] = v >>> 0;
      }
      this.idx = 0;
    }
    let y = this.mt[this.idx]!; this.idx++;
    y ^= y >>> 11; y ^= (y << 7) & 0x9d2c5680; y ^= (y << 15) & 0xefc60000; y ^= y >>> 18;
    return y >>> 0;
  }
  /** Uniform in (0,1): never exactly 0 or 1, so Box-Muller never takes log(0). */
  uniform(): number { return (this.uint32() + 0.5) / 4294967296; }
  below(n: number): number {
    let mask = 1;
    while (mask < n - 1) mask = (mask << 1) | 1;
    for (;;) {
      const v = this.uint32() & mask;
      if (v < n) return v;
    }
  }
  choice(n: number, size: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < size; i++) out.push(this.below(n));
    return out;
  }
  /** Fisher-Yates shuffle of a copy, deterministic. */
  shuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = this.below(i + 1);
      const t = a[i]!; a[i] = a[j]!; a[j] = t;
    }
    return a;
  }
}
/** One standard normal from a seeded MT19937 (Box-Muller, cosine half). */
function randn(mt: MT19937): number {
  const u1 = mt.uniform(); const u2 = mt.uniform();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// ------------------------------------------------------------------ snapshot + eligibility
const snapText = readFileSync(INPUT, 'utf8');
const snapHash = createHash('sha256').update(snapText).digest('hex');
const snap = parseSnapshot(snapText);
const AS_OF = new Date(`${snap.as_of}T00:00:00Z`);
const WATCH = new Set(snap.watchlist);
const EXCL_CAT = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const EXCH = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
const VERS = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAP = /\b(wrapped|staked|staking)\b/i;
function clean(p: Proto): boolean {
  return !EXCL_CAT.has(p.category ?? '') && !EXCH.test(p.name) && !VERS.test(p.name) && !WRAP.test(p.name);
}
const PROTO = snap.protocols;
function ageYears(p: Proto): number | null {
  if (!p.listed_at) return null;
  const d = new Date(`${p.listed_at}T00:00:00Z`);
  return Math.max((AS_OF.getTime() - d.getTime()) / 86400000 / 365.25, 1 / 365.25);
}
function ageDays(p: Proto): number {
  if (!p.listed_at) return 365;
  return Math.max(Math.round((AS_OF.getTime() - new Date(`${p.listed_at}T00:00:00Z`).getTime()) / 86400000), 1);
}
const tradedAll = PROTO.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
const traded = tradedAll.filter(clean);
const pretoken = PROTO.filter((p) => !p.gecko_id && !p.symbol);
const elig = pretoken.filter(clean);
const agesAll = PROTO.map(ageYears).filter((a): a is number => a !== null);
const MED_AGE = median(agesAll);
const CATN: Record<string, number> = {};
for (const p of traded) if (p.category) CATN[p.category] = (CATN[p.category] ?? 0) + 1;
const TOPCATS = Object.entries(CATN).filter(([, n]) => n >= 5).map(([c]) => c).sort();
function pctInCat(p: Proto): number {
  const same = PROTO.filter((q) => q.category === p.category).map((q) => q.tvl_usd).sort((a, b) => a - b);
  return same.indexOf(p.tvl_usd) / Math.max(same.length - 1, 1);
}
function feats(p: Proto): number[] {
  const x = [LOG10(p.tvl_usd), (p.change_7d ?? 0) / 100];
  for (const c of TOPCATS) x.push(p.category === c ? 1 : 0);
  return x;
}
const Y = traded.map((p) => LOG10(p.mcap_usd!));
const YMULT = traded.map((p) => LOG10(p.mcap_usd! / p.tvl_usd));
const LISTED = traded.map((_, i) => i).sort((a, b) => {
  const la = traded[a]!.listed_at ?? '9999'; const lb = traded[b]!.listed_at ?? '9999';
  return la < lb ? -1 : la > lb ? 1 : a - b;
});
const medX = (err: number[]): number => 10 ** median(err.map(Math.abs));
const meanX = (err: number[]): number => 10 ** mean(err.map(Math.abs));

// ------------------------------------------------------------------ ridge + model selection (frozen rule)
// Model A = ridge lam30 on log10(mcap), features [logTVL, growth, TOPCAT dummies].
// Selection rule (frozen, from the research): lowest mean walk-forward factor;
// a gap under 0.10x falls to the lowest median LOO; a tie falls to model B.
interface RidgeModel { b: number[]; mu: number[]; sd: number[] }
function ridgeFit(X: number[][], y: number[], lam: number): RidgeModel {
  const n = X.length; const d = X[0]!.length;
  const mu = new Array<number>(d); const sd = new Array<number>(d);
  for (let j = 0; j < d; j++) {
    mu[j] = mean(X.map((r) => r[j]!));
    const v = mean(X.map((r) => (r[j]! - mu[j]!) ** 2));
    sd[j] = Math.sqrt(v) || 1;
  }
  const m = d + 1;
  const A: number[][] = Array.from({ length: m }, () => new Array<number>(m).fill(0));
  const rhs = new Array<number>(m).fill(0);
  for (let i = 0; i < n; i++) {
    const row = [1, ...X[i]!.map((v, j) => (v - mu[j]!) / sd[j]!)];
    for (let a = 0; a < m; a++) {
      for (let b = 0; b < m; b++) A[a]![b]! += row[a]! * row[b]!;
      rhs[a]! += row[a]! * y[i]!;
    }
  }
  for (let j = 1; j < m; j++) A[j]![j]! += lam; // intercept unpenalised
  return { b: solveLinear(A, rhs), mu, sd };
}
function ridgePred(mod: RidgeModel, X: number[][]): number[] {
  return X.map((r) => {
    let s = mod.b[0]!;
    for (let j = 0; j < r.length; j++) s += mod.b[j + 1]! * ((r[j]! - mod.mu[j]!) / mod.sd[j]!);
    return s;
  });
}
type PredFn = (tr: number[], te: number[]) => number[];
function looErr(fp: PredFn): number[] {
  const out: number[] = [];
  for (let i = 0; i < traded.length; i++) {
    const tr = traded.map((_, j) => j).filter((j) => j !== i);
    out.push(fp(tr, [i])[0]! - Y[i]!);
  }
  return out;
}
function wfErrs(fp: PredFn): number[][] {
  return [0.4, 0.5, 0.67].map((c) => {
    const cut = Math.floor(LISTED.length * c);
    const tr = LISTED.slice(0, cut); const te = LISTED.slice(cut);
    const pr = fp(tr, te);
    return pr.map((v, k) => v - Y[te[k]!]!);
  });
}
interface ModelStats { medLOO: number; meanLOO: number; medWF: number; meanWF: number; wfMed: number[]; wfMean: number[] }
function modelStats(fp: PredFn): ModelStats {
  const eLoo = looErr(fp); const cuts = wfErrs(fp);
  const wfMed = cuts.map(medX); const wfMean = cuts.map(meanX);
  return { medLOO: medX(eLoo), meanLOO: meanX(eLoo), medWF: mean(wfMed), meanWF: mean(wfMean), wfMed, wfMean };
}
function ridgeFp(lam: number, target: 'mcap' | 'mult'): PredFn {
  return (tr, te) => {
    const yy = target === 'mcap' ? Y : YMULT;
    const m = ridgeFit(tr.map((i) => feats(traded[i]!)), tr.map((i) => yy[i]!), lam);
    const pr = ridgePred(m, te.map((i) => feats(traded[i]!)));
    return target === 'mult' ? pr.map((v, k) => v + LOG10(traded[te[k]!]!.tvl_usd)) : pr;
  };
}
function featsPow(p: Proto): number[] {
  const x = [(p.change_7d ?? 0) / 100];
  for (const c of TOPCATS) x.push(p.category === c ? 1 : 0);
  return x;
}
const YPOW = traded.map((p) => LOG10(p.mcap_usd!) - 0.45 * LOG10(p.tvl_usd));
function powFp(tr: number[], te: number[]): number[] {
  const m = ridgeFit(tr.map((i) => featsPow(traded[i]!)), tr.map((i) => YPOW[i]!), 1);
  return ridgePred(m, te.map((i) => featsPow(traded[i]!))).map((v, k) => v + 0.45 * LOG10(traded[te[k]!]!.tvl_usd));
}
function olsFp(tr: number[], te: number[]): number[] {
  // OLS log-log: log(mcap) = a + b*log(TVL), solved as a 2x2 ridge with lam 0.
  const lt = traded.map((p) => LOG10(p.tvl_usd));
  const m = ridgeFit(tr.map((i) => [lt[i]!]), tr.map((i) => Y[i]!), 0);
  return ridgePred(m, te.map((i) => [lt[i]!]));
}
function flatMcapFp(tr: number[], te: number[]): number[] {
  return te.map(() => median(tr.map((i) => Y[i]!)));
}
function flatMultFp(tr: number[], te: number[]): number[] {
  const base = median(tr.map((i) => YMULT[i]!));
  return te.map((i) => base + LOG10(traded[i]!.tvl_usd));
}
function catShiftFp(k: number): PredFn {
  const lt = traded.map((p) => LOG10(p.tvl_usd));
  return (tr, te) => {
    const m = ridgeFit(tr.map((i) => [lt[i]!]), tr.map((i) => Y[i]!), 0);
    const base = ridgePred(m, traded.map((p) => [LOG10(p.tvl_usd)]));
    const resTr = tr.map((i) => Y[i]! - base[i]!);
    const groups: Record<string, number[]> = {};
    tr.forEach((i, j) => { const c = traded[i]!.category ?? 'none'; (groups[c] ??= []).push(resTr[j]!); });
    const shift: Record<string, number> = {};
    for (const [c, rs] of Object.entries(groups)) shift[c] = median(rs) * rs.length / (rs.length + k);
    return te.map((i) => base[i]! + (shift[traded[i]!.category ?? 'none'] ?? 0));
  };
}
function multFp(multFn: (p: Proto) => number): PredFn {
  return (tr, te) => {
    const m = ridgeFit(tr.map((i) => feats(traded[i]!)), tr.map((i) => Y[i]!), 30);
    return ridgePred(m, te.map((i) => feats(traded[i]!))).map((v, k) => v + LOG10(multFn(traded[te[k]!]!)));
  };
}
function likelihood(p: Proto): number {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('vault') || c.includes('curator')) return 0.8;
  if (c.includes('chain') || c.includes('stak')) return 0.9;
  if (!c || c === 'none') return 0.7;
  return 1;
}
function asymFactor(p: Proto): number {
  const g7 = p.change_7d ?? 0;
  const w = g7 < 0 ? 0.9 : 0.6;
  return 1 + clamp(g7, -60, 120) / 100 * w;
}
function sqrtMat(p: Proto): number {
  const d = ageDays(p);
  return 0.55 + 0.45 * Math.sqrt(clamp(d, 0, 1460) / 1460);
}
function linMat(p: Proto): number {
  const d = ageDays(p);
  return 0.6 + 0.4 * clamp(d, 0, 1095) / 1095;
}
function nisFactor(p: Proto): number {
  const a = ageYears(p) ?? MED_AGE;
  const ageF = 1 + 0.08 * Math.log(1 + a);
  const g7 = p.change_7d ?? 0;
  const growth = clamp(1 + 0.5 * clamp(g7, -60, 120) / 100, 0.5, 1.5);
  return ageF * growth;
}
// Curve (wiliamkesh): OLS on ln(mcap/TVL winsorised [0.01,3]) vs ln(TVL).
function ols1(xs: number[], ys: number[]): { a: number; b: number } {
  // Plain single-feature OLS on raw values (intercept a, slope b).
  const mx = mean(xs), my = mean(ys);
  const b = sum(xs.map((x, i) => (x - mx) * (ys[i]! - my))) / sum(xs.map((x) => (x - mx) ** 2));
  return { a: my - b * mx, b };
}
function curveFit(comps: Proto[]): { a: number; b: number; r2: number } {
  // Plain OLS on the RAW ln values (not ridgeFit: ridgeFit standardises the
  // features, so its coefficients are not the raw intercept/slope). The
  // regression is ln(mcap/TVL) = a + b*ln(TVL); the prediction is
  // log10(mcap) = log10(tvl) + (a + b*ln(tvl))/ln(10).
  const xs = comps.map((p) => Math.log(p.tvl_usd));
  const ys = comps.map((p) => Math.log(clamp(p.mcap_usd! / p.tvl_usd, 0.01, 3)));
  const { a, b } = ols1(xs, ys);
  const pred = xs.map((x) => a + b * x);
  const ssRes = sum(ys.map((v, i) => (v - pred[i]!) ** 2));
  const ssTot = sum(ys.map((v) => (v - mean(ys)) ** 2));
  return { a, b, r2: 1 - ssRes / ssTot };
}
function curveFp(tr: number[], te: number[]): number[] {
  const { a, b } = curveFit(tr.map((i) => traded[i]!));
  return te.map((i) => {
    const p = traded[i]!;
    return LOG10(p.tvl_usd) + (a + b * Math.log(p.tvl_usd)) / Math.log(10);
  });
}
function curveFullFp(tr: number[], te: number[]): number[] {
  const pool = tr.map((i) => traded[i]!);
  return te.map((i) => {
    const p = traded[i]!;
    const { a, b } = curveFit(pool);
    const base = LOG10(p.tvl_usd) + (a + b * Math.log(p.tvl_usd)) / Math.log(10);
    const g = clamp(p.change_7d ?? 0, -60, 200);
    const gm = 1 + (g / 100) * 0.75;
    const mm = 0.6 + clamp(ageDays(p), 0, 1095) / 1095 * 0.4;
    return base + LOG10(gm * mm);
  });
}
function curveMatFp(tr: number[], te: number[]): number[] {
  const pool = tr.map((i) => traded[i]!);
  return te.map((i) => {
    const p = traded[i]!;
    const { a, b } = curveFit(pool);
    const base = LOG10(p.tvl_usd) + (a + b * Math.log(p.tvl_usd)) / Math.log(10);
    const mm = 0.6 + clamp(ageDays(p), 0, 1095) / 1095 * 0.4;
    return base + LOG10(mm);
  });
}
const STATS: Record<string, ModelStats> = {
  A_lam30: modelStats(ridgeFp(30, 'mcap')),
  B_lam3: modelStats(ridgeFp(3, 'mult')),
  C_pow045: modelStats(powFp),
  lam100: modelStats(ridgeFp(100, 'mcap')),
  lam10: modelStats(ridgeFp(10, 'mcap')),
  lam3: modelStats(ridgeFp(3, 'mcap')),
  lam1: modelStats(ridgeFp(1, 'mcap')),
  OLS_loglog: modelStats(olsFp),
  FLAT_mcap: modelStats(flatMcapFp),
  FLAT_mult: modelStats(flatMultFp),
  D24_k3: modelStats(catShiftFp(3)),
  D24_k8: modelStats(catShiftFp(8)),
  D25_likelihood: modelStats(multFp(likelihood)),
  D26_asym: modelStats(multFp(asymFactor)),
  D31_sqrtmat: modelStats(multFp(sqrtMat)),
  D31_linmat: modelStats(multFp(linMat)),
  D32_sqrtmat_x_asym: modelStats(multFp((p) => sqrtMat(p) * asymFactor(p))),
  nisarena2: modelStats(multFp(nisFactor)),
  curve_alone: modelStats(curveFp),
  curve_full: modelStats(curveFullFp),
  curve_mat: modelStats(curveMatFp),
};
// Newest-35 holdout for A.
const TE35 = LISTED.slice(-35);
const TR35 = traded.map((_, i) => i).filter((i) => !TE35.includes(i));
const NEWEST35_MED = medX(ridgeFp(30, 'mcap')(TR35, TE35).map((v, k) => v - Y[TE35[k]!]!));
// In-sample R2 of model A + LOO Spearman + LOO residual SD.
const XTR = traded.map(feats);
const MODEL_A = ridgeFit(XTR, Y, 30);
const PRED_ALL = ridgePred(MODEL_A, XTR);
const SS_RES = sum(Y.map((v, i) => (v - PRED_ALL[i]!) ** 2));
const SS_TOT = sum(Y.map((v) => (v - mean(Y)) ** 2));
const INSAMPLE_R2 = 1 - SS_RES / SS_TOT;
const LOO_PRED_A = traded.map((_, i) => {
  const tr = traded.map((_, j) => j).filter((j) => j !== i);
  return ridgeFp(30, 'mcap')(tr, [i])[0]!;
});
const SPEARMAN_LOO_A = spearman(LOO_PRED_A, Y);
const LOO_RESID_SD = Math.sqrt(mean(LOO_PRED_A.map((v, i) => (v - Y[i]!) ** 2)));
// 5-fold CV R2 (own deterministic protocol: MT19937 seed 0 shuffle, array_split 5).
// Random-feature control: MT19937 seeds 100-102 + Box-Muller normals, same protocol.
function cv5R2(predFn: PredFn): { r2: number; med: number } {
  const mt = new MT19937(0);
  const idx = mt.shuffle(traded.map((_, i) => i));
  const folds: number[][] = [[], [], [], [], []];
  const base = Math.floor(idx.length / 5); const extra = idx.length % 5;
  let at = 0;
  for (let k = 0; k < 5; k++) {
    const sz = base + (k < extra ? 1 : 0);
    folds[k] = idx.slice(at, at + sz); at += sz;
  }
  const oof = new Array<number>(traded.length).fill(0);
  for (let k = 0; k < 5; k++) {
    const te = folds[k]!;
    const tr = folds.flatMap((f, j) => (j === k ? [] : f));
    const pr = predFn(tr, te);
    te.forEach((i, j) => { oof[i] = pr[j]!; });
  }
  const ssR = sum(Y.map((v, i) => (v - oof[i]!) ** 2));
  const ssT = sum(Y.map((v) => (v - mean(Y)) ** 2));
  return { r2: 1 - ssR / ssT, med: medX(oof.map((v, i) => v - Y[i]!)) };
}
const CV5_A = cv5R2(ridgeFp(30, 'mcap'));
const CV5_FLAT = cv5R2(flatMcapFp);
const CV5_RANDOM: { r2: number; med: number }[] = [];
for (let t = 0; t < 3; t++) {
  const mt = new MT19937(100 + t);
  const XR = traded.map(() => Array.from({ length: XTR[0]!.length }, () => randn(mt)));
  const fp: PredFn = (tr, te) => {
    const m = ridgeFit(tr.map((i) => XR[i]!), tr.map((i) => Y[i]!), 30);
    return ridgePred(m, te.map((i) => XR[i]!));
  };
  CV5_RANDOM.push(cv5R2(fp));
}
// Placebo: model A + one random N(0,1) feature, fixed seed (MT19937 seed 3).
// The size signal is thin: a random feature lands in the same LOO range as A.
function placeboMedLOO(seed: number): number {
  const mt = new MT19937(seed);
  const XR = traded.map(() => randn(mt));
  const fp: PredFn = (tr, te) => {
    const m = ridgeFit(tr.map((i) => [...feats(traded[i]!), XR[i]!]), tr.map((i) => Y[i]!), 30);
    return ridgePred(m, te.map((i) => [...feats(traded[i]!), XR[i]!]));
  };
  return medX(looErr(fp));
}
const PLACEBO = { seed: 3, medLOO: placeboMedLOO(3) };

// ------------------------------------------------------------------ token odds: 50/30/20 ensemble
// Rich logit (11 features) + empirical age-band/category odds + base rate.
// Logit fit by Newton/IRLS on the penalised log-likelihood (L2 lam 1.0 on
// slopes, intercept unpenalised); the problem is convex, so the optimum is
// the same one scipy's L-BFGS-B reaches. Odds rounded to 3 decimals ONCE,
// in main.ts; every downstream use takes the rounded odds.
const YO = PROTO.map((p) => (p.gecko_id || p.symbol ? 1 : 0));
const BASE_RATE = mean(YO);
function oddsFeatsRich(p: Proto): number[] {
  const a = ageYears(p) ?? MED_AGE;
  return [LOG10(p.tvl_usd), LOG10(a), (p.change_7d ?? 0) / 100,
    LOG10(p.chains.length), LOG10(a) * LOG10(p.tvl_usd), pctInCat(p),
    ...TOPCATS.map((c) => (p.category === c ? 1 : 0))];
}
const XO = PROTO.map(oddsFeatsRich);
const MU_O = XO[0]!.map((_, j) => mean(XO.map((r) => r[j]!)));
const SD_O = XO[0]!.map((_, j) => Math.sqrt(mean(XO.map((r) => (r[j]! - MU_O[j]!) ** 2))) || 1);
const XSO = XO.map((r) => r.map((v, j) => (v - MU_O[j]!) / SD_O[j]!));
function sigmoid(z: number): number {
  if (z >= 0) return 1 / (1 + Math.exp(-z));
  const e = Math.exp(z); return e / (1 + e);
}
function fitLogit(Xs: number[][], yv: number[], lam = 1): number[] {
  const d = Xs[0]!.length;
  let b = new Array<number>(d + 1).fill(0);
  for (let it = 0; it < 100; it++) {
    const g = new Array<number>(d + 1).fill(0);
    const H: number[][] = Array.from({ length: d + 1 }, () => new Array<number>(d + 1).fill(0));
    for (let i = 0; i < Xs.length; i++) {
      let z = b[0]!;
      for (let j = 0; j < d; j++) z += b[j + 1]! * Xs[i]![j]!;
      const p = sigmoid(z);
      const r = yv[i]! - p;
      const w = Math.max(p * (1 - p), 1e-12);
      g[0]! += r;
      for (let j = 0; j < d; j++) g[j + 1]! += r * Xs[i]![j]!;
      const row = [1, ...Xs[i]!];
      for (let a = 0; a <= d; a++) for (let c = 0; c <= d; c++) H[a]![c]! += w * row[a]! * row[c]!;
    }
    for (let j = 1; j <= d; j++) { g[j]! -= lam * b[j]!; H[j]![j]! += lam; }
    const delta = solveLinear(H, g);
    let mx = 0;
    for (let j = 0; j <= d; j++) { b[j]! += delta[j]!; mx = Math.max(mx, Math.abs(delta[j]!)); }
    if (mx < 1e-10) break;
  }
  return b;
}
function logitPred(b: number[], Xs: number[][]): number[] {
  return Xs.map((r) => {
    let z = b[0]!;
    for (let j = 0; j < r.length; j++) z += b[j + 1]! * r[j]!;
    return sigmoid(z);
  });
}
function ageBand(a: number | null): string {
  if (a === null) return 'unknown';
  if (a < 0.25) return '<90d';
  if (a < 1.0) return '90d-1y';
  if (a < 2.0) return '1-2y';
  return '>2y';
}
function empirPred(tr: number[], p: Proto, shrink = 10): number {
  const stats: Record<string, [number, number]> = {};
  const bands: Record<string, [number, number]> = {};
  for (const i of tr) {
    const q = PROTO[i]!;
    const k = `${ageBand(ageYears(q))}|${q.category ?? 'none'}`;
    const s = stats[k] ??= [0, 0]; s[0] += YO[i]!; s[1]++;
    const b = bands[ageBand(ageYears(q))] ??= [0, 0]; b[0] += YO[i]!; b[1]++;
  }
  const k = `${ageBand(ageYears(p))}|${p.category ?? 'none'}`;
  if (stats[k] && stats[k]![1] >= 5) return (stats[k]![0] + shrink * BASE_RATE) / (stats[k]![1] + shrink);
  const b = bands[ageBand(ageYears(p))];
  if (b && b[1] >= 5) return (b[0] + shrink * BASE_RATE) / (b[1] + shrink);
  return BASE_RATE;
}
const ORDER_ALL = PROTO.map((_, i) => i).sort((a, b) => {
  const la = PROTO[a]!.listed_at ?? '9999'; const lb = PROTO[b]!.listed_at ?? '9999';
  return la < lb ? -1 : la > lb ? 1 : a - b;
});
const W_ODDS: [number, number, number] = [0.5, 0.3, 0.2];
function wfOdds(): { cut: number; nTest: number; brier: number; baseBrier: number; calledRight: number; testRate: number }[] {
  return [0.4, 0.5, 0.67].map((c) => {
    const cut = Math.floor(ORDER_ALL.length * c);
    const tr = ORDER_ALL.slice(0, cut); const te = ORDER_ALL.slice(cut);
    const b = fitLogit(tr.map((i) => XSO[i]!), tr.map((i) => YO[i]!));
    const prLog = logitPred(b, te.map((i) => XSO[i]!));
    const prEmp = te.map((i) => empirPred(tr, PROTO[i]!));
    const pr = prLog.map((v, k) => W_ODDS[0] * v + W_ODDS[1] * prEmp[k]! + W_ODDS[2] * BASE_RATE);
    const brier = mean(pr.map((v, k) => (v - YO[te[k]!]!) ** 2));
    const teRate = mean(te.map((i) => YO[i]!));
    const baseBrier = teRate * (1 - teRate);
    const calledRight = mean(pr.map((v, k) => (v >= 0.5) === (YO[te[k]!]! >= 0.5) ? 1 : 0));
    return { cut: c, nTest: te.length, brier, baseBrier, calledRight, testRate: teRate };
  });
}
const WF_ODDS = wfOdds();
// In-sample odds for the board (rounded to 3 decimals ONCE).
const B_ALL = fitLogit(XSO, YO);
const LOGIT_ALL = logitPred(B_ALL, XSO);
const EMP_ALL = PROTO.map((p) => empirPred(PROTO.map((_, i) => i), p));
const ODDS_FULL = PROTO.map((_, i) => W_ODDS[0] * LOGIT_ALL[i]! + W_ODDS[1] * EMP_ALL[i]! + W_ODDS[2] * BASE_RATE);
const ELIG_IDX = elig.map((p) => PROTO.indexOf(p));
const ODDS_ELIG = ELIG_IDX.map((i) => Math.round(ODDS_FULL[i]! * 1000) / 1000);
// Tier cutoffs = tertiles of the 198 board odds (rounded); tiers by rank (66/66/66).
const TIER_CUTS = [quantile([...ODDS_ELIG].sort((a, b) => a - b), 1 / 3), quantile([...ODDS_ELIG].sort((a, b) => a - b), 2 / 3)];
const SRT_ODDS = ELIG_IDX.map((_, j) => j).sort((a, b) => ODDS_ELIG[a]! - ODDS_ELIG[b]! || a - b);
const TIER_OF: string[] = new Array<string>(elig.length).fill('');
SRT_ODDS.forEach((j, pos) => { TIER_OF[j] = pos < 66 ? 'LOW' : pos < 132 ? 'MED' : 'HIGH'; });
// Tier rates: within each WF test set, split the test rows into tertiles by
// their (unrounded) WF odds and take the tokenisation fraction per tertile.
// Pooled = all three cuts' test rows pooled. This is the reference protocol:
// it reproduces HIGH 74.7% / MED 42.2% / LOW 25.7%.
function tierRates(): { perCut: { cut: number; HIGH: number; MED: number; LOW: number; nHIGH: number; nMED: number; nLOW: number }[]; pooled: { HIGH: number; MED: number; LOW: number } } {
  const pooled: Record<string, [number, number]> = { HIGH: [0, 0], MED: [0, 0], LOW: [0, 0] };
  const perCut = [0.4, 0.5, 0.67].map((c) => {
    const cut = Math.floor(ORDER_ALL.length * c);
    const tr = ORDER_ALL.slice(0, cut); const te = ORDER_ALL.slice(cut);
    const b = fitLogit(tr.map((i) => XSO[i]!), tr.map((i) => YO[i]!));
    const prLog = logitPred(b, te.map((i) => XSO[i]!));
    const prEmp = te.map((i) => empirPred(tr, PROTO[i]!));
    const pr = prLog.map((v, k) => W_ODDS[0] * v + W_ODDS[1] * prEmp[k]! + W_ODDS[2] * BASE_RATE);
    const q1 = quantile([...pr].sort((a, b) => a - b), 1 / 3);
    const q2 = quantile([...pr].sort((a, b) => a - b), 2 / 3);
    const row: { cut: number; HIGH: number; MED: number; LOW: number; nHIGH: number; nMED: number; nLOW: number } = { cut: c, HIGH: 0, MED: 0, LOW: 0, nHIGH: 0, nMED: 0, nLOW: 0 };
    for (const name of ['LOW', 'MED', 'HIGH'] as const) {
      let n = 0; let tok = 0;
      pr.forEach((v, k) => {
        const inTier = name === 'LOW' ? v < q1 : name === 'MED' ? v >= q1 && v < q2 : v >= q2;
        if (inTier) { n++; tok += YO[te[k]!]!; }
      });
      row[name] = n ? tok / n : 0;
      row[`n${name}` as 'nHIGH' | 'nMED' | 'nLOW'] = n;
      pooled[name]![0] += tok; pooled[name]![1] += n;
    }
    return row;
  });
  return { perCut, pooled: { HIGH: pooled.HIGH![0] / pooled.HIGH![1], MED: pooled.MED![0] / pooled.MED![1], LOW: pooled.LOW![0] / pooled.LOW![1] } };
}
const TIER_RATES = tierRates();

// ------------------------------------------------------------------ board: model A, capped, integer
const MULTS_TR = traded.map((p) => p.mcap_usd! / p.tvl_usd);
const CAP_P90 = quantile([...MULTS_TR].sort((a, b) => a - b), 0.9);
const CAP_P85 = quantile([...MULTS_TR].sort((a, b) => a - b), 0.85);
const CAP_P80 = quantile([...MULTS_TR].sort((a, b) => a - b), 0.8);
const IMP_PRED = ridgePred(MODEL_A, elig.map(feats));
const CAPPED_FLOAT = IMP_PRED.map((v, i) => Math.min(10 ** v / elig[i]!.tvl_usd, CAP_P90) * elig[i]!.tvl_usd);
const IMP_INT = CAPPED_FLOAT.map((v) => Math.max(1, jsRound(v))); // RULES.txt: implied is a POSITIVE whole number; Shift DeFi (+4,448.5% 7d) collapses to $0 without the floor
const BOARD_TOTAL_INT = sum(IMP_INT);
const BOARD_TOTAL_FLOAT = sum(CAPPED_FLOAT);
const ORDER_B = IMP_INT.map((_, i) => i).sort((a, b) => IMP_INT[b]! - IMP_INT[a]! || a - b);
const RANK_OF = new Array<number>(elig.length);
ORDER_B.forEach((i, pos) => { RANK_OF[i] = pos + 1; });
const ROWS_BOUND = IMP_PRED.filter((v, i) => 10 ** v / elig[i]!.tvl_usd > CAP_P90).length;
// Cap sensitivity (p85/p80) and the lam100 board, for the evidence section.
function capBoard(cap: number): { binds: number; top1: string; top1Val: number; total: number } {
  const cf = IMP_PRED.map((v, i) => Math.min(10 ** v / elig[i]!.tvl_usd, cap) * elig[i]!.tvl_usd);
  const o = cf.map((_, i) => i).sort((a, b) => cf[b]! - cf[a]!);
  return { binds: IMP_PRED.filter((v, i) => 10 ** v / elig[i]!.tvl_usd > cap).length, top1: elig[o[0]!]!.name, top1Val: cf[o[0]!]!, total: sum(cf) };
}
const CAP_SENS = { p85: capBoard(CAP_P85), p80: capBoard(CAP_P80) };
const M100 = ridgeFit(XTR, Y, 100);
const IMP100 = ridgePred(M100, elig.map(feats)).map((v, i) => Math.min(10 ** v / elig[i]!.tvl_usd, CAP_P90) * elig[i]!.tvl_usd);
const O100 = IMP100.map((_, i) => i).sort((a, b) => IMP100[b]! - IMP100[a]!);
const LAM100_BOARD = {
  top1: elig[O100[0]!]!.name, top1Val: IMP100[O100[0]!]!,
  top5: sum(O100.slice(0, 5).map((i) => IMP100[i]!)), total: sum(IMP100),
  maxMult: Math.max(...IMP100.map((v, i) => v / elig[i]!.tvl_usd)),
  spearman: spearman(IMP100, CAPPED_FLOAT),
  top10Overlap: O100.slice(0, 10).filter((i) => ORDER_B.slice(0, 10).includes(i)).length,
};
// D-24 challenger board (reference only; A stays the board model).
function d24Board(k: number): number[] {
  const lt = traded.map((p) => LOG10(p.tvl_usd));
  const { a, b } = ols1(lt, Y); // raw OLS (ridgeFit's coefficients are standardised — not usable here)
  const base = lt.map((x) => a + b * x);
  const res = Y.map((v, i) => v - base[i]!);
  const groups: Record<string, number[]> = {};
  traded.forEach((p, i) => { const c = p.category ?? 'none'; (groups[c] ??= []).push(res[i]!); });
  const shift: Record<string, number> = {};
  for (const [c, rs] of Object.entries(groups)) shift[c] = median(rs) * rs.length / (rs.length + k);
  return elig.map((p) => {
    const v = a + b * LOG10(p.tvl_usd);
    return 10 ** (v + (shift[p.category ?? 'none'] ?? 0));
  });
}
const D24_IMP = d24Board(3).map((v, i) => Math.min(v / elig[i]!.tvl_usd, CAP_P90) * elig[i]!.tvl_usd);
const D24_O = D24_IMP.map((_, i) => i).sort((a, b) => D24_IMP[b]! - D24_IMP[a]!);
const D24_BOARD = { top1: elig[D24_O[0]!]!.name, top1Val: D24_IMP[D24_O[0]!]!, total: sum(D24_IMP), spearman: spearman(D24_IMP, CAPPED_FLOAT) };
// Curve boards (D-52).
function wiliBoard(a: number, b: number): number[] {
  return elig.map((p) => {
    const mult = clamp(Math.exp(a + b * Math.log(p.tvl_usd)), 0.01, 1);
    const g = clamp(p.change_7d ?? 0, -60, 200);
    const gm = 1 + (g / 100) * 0.75;
    const mm = 0.6 + clamp(ageDays(p), 0, 1095) / 1095 * 0.4;
    return Math.max(1, jsRound(p.tvl_usd * mult * gm * mm));
  });
}
const CURVE_CLEAN = curveFit(traded);
const CURVE_DIRTY = curveFit(tradedAll);
const CURVE_BOARD_CLEAN = (() => {
  const w = wiliBoard(CURVE_CLEAN.a, CURVE_CLEAN.b);
  const o = w.map((_, i) => i).sort((x, y) => w[y]! - w[x]!);
  return { top1: elig[o[0]!]!.name, top1Val: w[o[0]!]!, total: sum(w), spearman: spearman(w, IMP_INT), top10Overlap: o.slice(0, 10).filter((i) => ORDER_B.slice(0, 10).includes(i)).length };
})();
const CURVE_BOARD_DIRTY = (() => {
  const w = wiliBoard(CURVE_DIRTY.a, CURVE_DIRTY.b);
  const o = w.map((_, i) => i).sort((x, y) => w[y]! - w[x]!);
  return { top1: elig[o[0]!]!.name, top1Val: w[o[0]!]!, total: sum(w), spearman: spearman(w, IMP_INT), top10Overlap: o.slice(0, 10).filter((i) => ORDER_B.slice(0, 10).includes(i)).length };
})();
const CURVE_ALONE = (() => {
  const { a, b } = CURVE_CLEAN;
  const vals = elig.map((p) => 10 ** (LOG10(p.tvl_usd) + a / Math.log(10) + b * LOG10(p.tvl_usd)));
  const o = vals.map((_, i) => i).sort((x, y) => vals[y]! - vals[x]!);
  return { top1: elig[o[0]!]!.name, top1Val: vals[o[0]!]!, total: sum(vals), spearman: spearman(vals, IMP_INT) };
})();
const EXPECTED_BOARD = sum(IMP_INT.map((v, i) => v * ODDS_ELIG[i]!));

// ------------------------------------------------------------------ farm economics + verdicts (Lampiran A)
// GAS = cheapest-chain table for the verdict/net (min over the row's chains).
// D-55 uses the FIRST chain's gas instead. Verdict from the FLOAT net:
// FARM if net > +25, SKIP if net < -25, else MARGINAL. All economics from
// the INTEGER implied value and the ROUNDED odds (the entry convention).
const GAS: Record<string, number> = { Ethereum: 8, Base: 0.05, Solana: 0.01, Arbitrum: 0.2, Binance: 0.15, Avalanche: 0.3 };
function gasMin(p: Proto): number {
  if (!p.chains.length) return 1;
  return Math.min(...p.chains.map((c) => GAS[c] ?? 1));
}
function gasFirst(p: Proto): number {
  if (!p.chains.length) return 1;
  return GAS[p.chains[0]!] ?? 1;
}
const PLAN = 5000; const HZ = 12; const DROP = 0.07; const THR = 25;
interface Econ { slice: number; gas: number; costs: number; fee: number; net: number }
function econ(imInt: number, p: Proto, odds: number, plan = PLAN, hz = HZ, drop = DROP, gas?: number): Econ {
  const g = gas ?? gasMin(p);
  const slice = 1000 * (imInt / p.tvl_usd) * drop * odds;
  const costs = 2 * g + plan * 0.001 + plan * 0.04 * (hz / 52);
  const net = slice * (plan / 1000) - costs;
  return { slice, gas: g, costs, fee: 2 * g + plan * 0.001, net };
}
function verdictOf(net: number, thr = THR): 'FARM' | 'MARGINAL' | 'SKIP' {
  return net > thr ? 'FARM' : net < -thr ? 'SKIP' : 'MARGINAL';
}
interface RowEcon extends Econ { verdict: 'FARM' | 'MARGINAL' | 'SKIP'; breakEven: number | null; walkAway: number }
const ROW_ECON: RowEcon[] = elig.map((p, i) => {
  const e = econ(IMP_INT[i]!, p, ODDS_ELIG[i]!);
  const denom = e.slice / 1000 - 0.001 - 0.04 * (HZ / 52);
  const breakEven = denom > 0 ? (2 * e.gas) / denom : null;
  const walkAway = (e.slice * (PLAN / 1000)) / e.costs;
  return { ...e, verdict: verdictOf(e.net), breakEven, walkAway };
});
const VERDICTS = { FARM: 0, MARGINAL: 0, SKIP: 0 };
for (const r of ROW_ECON) VERDICTS[r.verdict]++;
// D-03 break-even + D-04 walk-away.
const BE_FINITE = ROW_ECON.map((r) => r.breakEven).filter((v): v is number => v !== null);
const D03 = {
  finite: BE_FINITE.length, never: ROW_ECON.length - BE_FINITE.length,
  median: median(BE_FINITE), p10: percentile([...BE_FINITE].sort((a, b) => a - b), 10),
  p90: percentile([...BE_FINITE].sort((a, b) => a - b), 90), max: Math.max(...BE_FINITE),
  maxRow: elig[ROW_ECON.findIndex((r) => r.breakEven === Math.max(...BE_FINITE))]!.name,
};
const FLOWDESK_I = elig.findIndex((p) => p.name === 'Flowdesk');
const D03_FLOWDESK = {
  net: ROW_ECON[FLOWDESK_I]!.net, slice: ROW_ECON[FLOWDESK_I]!.slice, gas: ROW_ECON[FLOWDESK_I]!.gas,
  odds: ODDS_ELIG[FLOWDESK_I]!, implied: IMP_INT[FLOWDESK_I]!, tvl: elig[FLOWDESK_I]!.tvl_usd,
  a: ROW_ECON[FLOWDESK_I]!.slice / 1000 - 0.001 - 0.04 * (HZ / 52),
  breakEven: ROW_ECON[FLOWDESK_I]!.breakEven,
};
const WA_FARM = ROW_ECON.filter((r) => r.verdict === 'FARM').map((r) => r.walkAway);
const D04 = {
  median: median(WA_FARM), p10: percentile([...WA_FARM].sort((a, b) => a - b), 10),
  p90: percentile([...WA_FARM].sort((a, b) => a - b), 90), min: Math.min(...WA_FARM), max: Math.max(...WA_FARM),
  fragile: WA_FARM.filter((v) => v < 2).length, robust: WA_FARM.filter((v) => v > 10).length,
  robustNames: elig.filter((_, i) => ROW_ECON[i]!.verdict === 'FARM' && ROW_ECON[i]!.walkAway > 10).map((p) => p.name),
};
// D-47 vesting (PV on the SLICE), D-48 bear/bull, D-49 log-share, D-50 EV/cost, D-51 multi-wallet.
function pvFactor(tge: number, cliff: number, months: number, discYr: number): number {
  const rm = (1 + discYr) ** (1 / 12) - 1;
  let s = 0;
  for (let m = cliff + 1; m <= cliff + months; m++) s += (1 + rm) ** -m;
  return tge + (1 - tge) * (1 / months) * s;
}
function verdictCounts(f = 1, plan = PLAN, gasMult = 1, hz = HZ): { FARM: number; MARGINAL: number; SKIP: number } {
  const c = { FARM: 0, MARGINAL: 0, SKIP: 0 };
  elig.forEach((p, i) => {
    const g = gasMin(p) * gasMult;
    const net = ROW_ECON[i]!.slice * f * (plan / 1000) - (2 * g + plan * 0.001) - plan * 0.04 * (hz / 52);
    c[verdictOf(net)]++;
  });
  return c;
}
const D47: Record<string, { pv: number; counts: { FARM: number; MARGINAL: number; SKIP: number } }> = {};
for (const [lab, tge, cliff, months, disc] of [['typical', 0.2, 0, 12, 0.2], ['harsh', 0.1, 6, 24, 0.3], ['generous', 0.5, 0, 12, 0.2]] as const) {
  const pv = pvFactor(tge, cliff, months, disc);
  D47[lab] = { pv, counts: verdictCounts(pv) };
}
const D48 = {
  bear033: verdictCounts(0.33), base: { ...VERDICTS }, bull25: verdictCounts(2.5), bull30: verdictCounts(3),
};
const D48_SURVIVORS = elig.filter((_, i) => ROW_ECON[i]!.verdict === 'FARM' && ROW_ECON[i]!.slice * 0.33 * 5 - ROW_ECON[i]!.costs > 25)
  .map((p) => {
    const i = elig.indexOf(p);
    return { name: p.name, net: ROW_ECON[i]!.slice * 0.33 * 5 - ROW_ECON[i]!.costs };
  });
const D49: Record<string, { factor: number; counts: { FARM: number; MARGINAL: number; SKIP: number } }> = {};
for (const plan of [1000, 5000, 25000]) {
  const f = Math.log(1 + plan / 1000) / (plan / 1000);
  D49[`$${plan}`] = { factor: f, counts: verdictCounts(f, plan) };
}
const D49_SURVIVORS = (() => {
  const f = Math.log(1 + 5) / 5;
  return elig.filter((_, i) => ROW_ECON[i]!.verdict === 'FARM' && ROW_ECON[i]!.slice * f * 5 - ROW_ECON[i]!.costs > 25)
    .map((p) => ({ name: p.name, net: ROW_ECON[elig.indexOf(p)]!.slice * f * 5 - ROW_ECON[elig.indexOf(p)]!.costs }));
})();
const EV_COST = ROW_ECON.map((r) => (r.slice * 5) / r.costs);
const D50 = {
  median: median(EV_COST), p90: percentile([...EV_COST].sort((a, b) => a - b), 90), max: Math.max(...EV_COST),
  gt1: EV_COST.filter((v) => v > 1).length, gt3: EV_COST.filter((v) => v > 3).length,
  top5: EV_COST.map((v, i) => ({ name: elig[i]!.name, ev: v })).sort((a, b) => b.ev - a.ev).slice(0, 5),
};
const D51_COUNTS = verdictCounts(1, PLAN, 4);
const DOWNS: number[] = []; const UPS: number[] = [];
ROW_ECON.forEach((r) => { if (r.verdict === 'FARM') { DOWNS.push(-r.costs); UPS.push(r.slice * 5 - r.costs); } });
const D51 = {
  multiwallet: D51_COUNTS,
  downsideMedian: median(DOWNS), upsideMedian: median(UPS),
  rowsDownGtUp: DOWNS.filter((d, k) => Math.abs(d) > UPS[k]!).length,
};
// ------------------------------------------------------------------ ranges + conformal audits (D-41..D-46)
// Board half-widths from the FULL model's in-sample residuals (v10 META 0.776/1.633).
const RES_FULL = Y.map((v, i) => Math.abs(PRED_ALL[i]! - v));
const Q50_FULL = quantile([...RES_FULL].sort((a, b) => a - b), 0.5);
const Q80_FULL = quantile([...RES_FULL].sort((a, b) => a - b), 0.8);
const HW_IN = 1.5 * Q50_FULL; const HW_OUT = 1.6 * Q80_FULL;
function rangeSweep(): Record<string, { inner: number; outer: number }> {
  const listed = [...traded].sort((a, b) => {
    const la = a.listed_at ?? '9999'; const lb = b.listed_at ?? '9999';
    return la < lb ? -1 : la > lb ? 1 : 0;
  });
  const out: Record<string, { inner: number; outer: number }> = {};
  for (const k of [1.2, 1.3, 1.4, 1.5, 1.6, 1.7]) {
    const covs: Record<number, number[]> = { 50: [], 80: [] };
    for (const c of [0.5, 0.67]) {
      const cut = Math.floor(listed.length * c);
      const tr = listed.slice(0, cut); const te = listed.slice(cut);
      const m = ridgeFit(tr.map(feats), tr.map((p) => LOG10(p.mcap_usd!)), 30);
      const res = tr.map((p, j) => Math.abs(ridgePred(m, [feats(p)])[0]! - LOG10(p.mcap_usd!)));
      const err = te.map((p) => Math.abs(ridgePred(m, [feats(p)])[0]! - LOG10(p.mcap_usd!)));
      for (const [lvl, q] of [[50, 0.5], [80, 0.8]] as const) {
        const qq = quantile([...res].sort((a, b) => a - b), q);
        covs[lvl]!.push(mean(err.map((e) => (e <= k * qq ? 1 : 0))));
      }
    }
    out[k.toFixed(1)] = { inner: mean(covs[50]!), outer: mean(covs[80]!) };
  }
  return out;
}
const RANGE_SWEEP = rangeSweep();
// Clean cut (T1): model on the oldest 67% (61 rows), band from its in-sample
// quantiles, evaluated on the newest 31 rows (cut-3 test set).
const CLEAN_CUT = (() => {
  const tr = LISTED.slice(0, 61); const te = LISTED.slice(61);
  const m = ridgeFit(tr.map((i) => feats(traded[i]!)), tr.map((i) => Y[i]!), 30);
  const res = tr.map((i) => Math.abs(ridgePred(m, [feats(traded[i]!)])[0]! - Y[i]!));
  const q50 = quantile([...res].sort((a, b) => a - b), 0.5);
  const q80 = quantile([...res].sort((a, b) => a - b), 0.8);
  const err = te.map((i) => Math.abs(ridgePred(m, [feats(traded[i]!)])[0]! - Y[i]!));
  const inner = mean(err.map((e) => (e <= 1.5 * q50 ? 1 : 0)));
  const outer = mean(err.map((e) => (e <= 1.6 * q80 ? 1 : 0)));
  const teByTvl = [...te].sort((a, b) => traded[a]!.tvl_usd - traded[b]!.tvl_usd);
  const terc = [0, 1, 2].map((t) => {
    const idx = teByTvl.slice(t * 10, t === 2 ? undefined : (t + 1) * 10);
    const e2 = idx.map((i) => Math.abs(ridgePred(m, [feats(traded[i]!)])[0]! - Y[i]!));
    return {
      inner: mean(e2.map((e) => (e <= 1.5 * q50 ? 1 : 0))),
      outer: mean(e2.map((e) => (e <= 1.6 * q80 ? 1 : 0))),
      medErr: medX(e2),
    };
  });
  return { inner, outer, factorIn: 10 ** (1.5 * q50), factorOut: 10 ** (1.6 * q80), byTercile: terc };
})();
// U-shape (D-41): median |LOO error| by listing tercile.
const D41_USHAPE = [0, 1, 2].map((t) => {
  const g = LISTED.slice(t * 31, t === 2 ? undefined : (t + 1) * 31);
  const e = g.map((i) => Math.abs(LOO_PRED_A[i]! - Y[i]!));
  return { tercile: t + 1, n: g.length, med: medX(e), mean: meanX(e) };
});
// Mondrian (T2), normalised score (T3), recency (T4), jackknife+ (T5), CQR-lite (T6)
// are negative/usable alternatives computed in the research; the entry states
// their headline numbers from the verified research (they are evidence, not
// the board's band). The board's band is the T1 split-conformal band above.
const CONFORMAL = {
  t1: { inner: CLEAN_CUT.inner, outer: CLEAN_CUT.outer, factorIn: CLEAN_CUT.factorIn, factorOut: CLEAN_CUT.factorOut },
  t2_mondrian: { shrink0: { inner: 0.16, outer: 0.94 }, shrink05: { inner: 0.23, outer: 0.90 }, note: 'calibration pool too small for 3 groups (n~13/group); NOT adopted' },
  t3_normalised: { inner: 0.48, outer: 0.81, widthIn: 4.4, widthOut: 25.97, growthCorr: -0.72, note: 'same inner as T1, worse outer; NOT adopted as default' },
  t4_recency: { note: 'rho 1.0/0.99/0.97: no material effect; NOT adopted (null result)' },
  t5_jackknife: { inner: 0.55, outer: 0.87, widthIn: 6.41, widthOut: 24.06, note: 'usable alternative with a wider band; we use the narrower T1 band at 48%' },
  t6_cqr: { inner: 0.29, outer: 0.81, widthIn: 2.23, widthOut: 18.43, note: 'inner 29% too low; NOT adopted as the main band' },
};

// ------------------------------------------------------------------ D-53..D-62, D-09, D-28, D-02, D-06
function launchFull(p: Proto): number {
  const age = ageDays(p);
  const ap = p.listed_at ? Math.round(Math.min(age, 1095) / 1095 * 40) : 20;
  const g = clamp(p.change_7d ?? 0, -60, 200);
  const gp = Math.round(((g + 60) / 260) * 30);
  const tp = Math.round(clamp(LOG10(Math.max(1, p.tvl_usd) / 5_000_000) / LOG10(1000) * 30, 0, 30));
  return ap + gp + tp;
}
function launchNoGrowth(p: Proto): number {
  const agePts = p.listed_at ? (Math.min(ageDays(p), 1095) / 1095) * 40 : 20;
  const sizePts = (LOG10(p.tvl_usd / 5e6) / 3) * 30; // unclamped, float (D-05: growth excluded)
  return agePts + sizePts;
}
const LAUNCH_FULL = elig.map(launchFull);
const LAUNCH_NG = elig.map(launchNoGrowth);
const D53 = {
  full: { median: median(LAUNCH_FULL), p10: percentile([...LAUNCH_FULL].sort((a, b) => a - b), 10), p90: percentile([...LAUNCH_FULL].sort((a, b) => a - b), 90), max: Math.max(...LAUNCH_FULL), min: Math.min(...LAUNCH_FULL), spearman: spearman(LAUNCH_FULL, IMP_INT), top10Overlap: LAUNCH_FULL.map((_, i) => i).sort((a, b) => LAUNCH_FULL[b]! - LAUNCH_FULL[a]!).slice(0, 10).filter((i) => ORDER_B.slice(0, 10).includes(i)).length },
  nogrowth: { median: median(LAUNCH_NG), p10: percentile([...LAUNCH_NG].sort((a, b) => a - b), 10), p90: percentile([...LAUNCH_NG].sort((a, b) => a - b), 90), max: Math.max(...LAUNCH_NG), min: Math.min(...LAUNCH_NG), spearman: spearman(LAUNCH_NG, IMP_INT), top10Overlap: LAUNCH_NG.map((_, i) => i).sort((a, b) => LAUNCH_NG[b]! - LAUNCH_NG[a]!).slice(0, 10).filter((i) => ORDER_B.slice(0, 10).includes(i)).length, top10: LAUNCH_NG.map((_, i) => i).sort((a, b) => LAUNCH_NG[b]! - LAUNCH_NG[a]!).slice(0, 10).map((i) => elig[i]!.name) },
};
function confidence(p: Proto): number {
  let s = 100;
  if (p.change_7d === null) s -= 30;
  if (p.listed_at === null) s -= 30;
  if (p.category === null) s -= 20;
  if (!p.chains.length) s -= 20;
  return Math.max(0, s);
}
const CONF = elig.map(confidence);
const D54 = {
  counts: (() => { const c: Record<number, number> = {}; for (const v of CONF) c[v] = (c[v] ?? 0) + 1; return c; })(),
  missing: {
    change_7d: elig.filter((p) => p.change_7d === null).length,
    listed_at: elig.filter((p) => p.listed_at === null).length,
    category: elig.filter((p) => p.category === null).length,
    chains: elig.filter((p) => !p.chains.length).length,
  },
};
// D-55 gas-share (wiliamkesh formula): FIRST-chain gas, capital + hold standards.
function gasWili(chain: string): number {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return 8;
  if (c === 'solana') return 1;
  if (c === 'bitcoin' || c === 'babylon genesis' || c === 'bittensor') return 2;
  if (['arbitrum', 'optimism', 'base', 'zksync', 'linea', 'scroll', 'blast', 'mode', 'mantle', 'polygon', 'bsc', 'avalanche', 'fantom', 'gnosis'].includes(c)) return 1;
  return 2;
}
function capitalStd(p: Proto): number {
  return p.tvl_usd >= 5e9 ? 250 : p.tvl_usd >= 1e9 ? 150 : p.tvl_usd >= 1e8 ? 100 : 50;
}
function holdStd(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}
function gasShare(p: Proto): number {
  const chain = p.chains[0] ?? 'its main chain';
  const gas = gasWili(chain);
  const weeks = Math.max(1, Math.round(holdStd(p.listed_at ? ageDays(p) : null) / 7));
  return ((gas * 2 + gas * weeks) / capitalStd(p)) * 100;
}
const GAS_SHARE = elig.map(gasShare);
const D55 = {
  counts: {
    FARM: GAS_SHARE.filter((v) => v <= 25).length,
    THIN: GAS_SHARE.filter((v) => v > 25 && v <= 50).length,
    SKIP: GAS_SHARE.filter((v) => v > 50).length,
  },
  median: median(GAS_SHARE), max: Math.max(...GAS_SHARE),
  ethFirstRows: elig.filter((p) => p.chains[0] === 'Ethereum').length,
};
// D-56 farm value (moustakimm).
function vMoust(p: Proto): number {
  const g = clamp(p.change_7d ?? 0, -60, 150);
  const gm = 1 + (g / 100) * 1;
  const days = ageDays(p);
  const mm = 0.5 + 0.5 * Math.sqrt(clamp(days, 0, 1095) / 1095);
  const ch = 1 + 0.03 * Math.min(Math.max(p.chains.length - 1, 0), 5);
  const size = (100_000_000 / Math.max(1, p.tvl_usd)) ** 0.25;
  return p.tvl_usd * 0.3 * size * gm * mm * ch;
}
function capitalMoust(p: Proto): number {
  const base = p.tvl_usd >= 5e9 ? 250 : p.tvl_usd >= 1e9 ? 150 : p.tvl_usd >= 1e8 ? 100 : 50;
  if (p.change_7d !== null && p.change_7d < -10) return Math.max(25, Math.round(base / 2));
  return base;
}
const FARM_VALUE = elig.map((p) => capitalMoust(p) * (vMoust(p) / p.tvl_usd));
const D56 = {
  median: median(FARM_VALUE), max: Math.max(...FARM_VALUE),
  halved: elig.filter((p) => p.change_7d !== null && p.change_7d < -10).length,
  moustVerdicts: (() => {
    const c = { FARM: 0, MARGINAL: 0, SKIP: 0 };
    elig.forEach((p) => {
      const mult = vMoust(p) / p.tvl_usd;
      const g = p.change_7d;
      const v = mult >= 0.5 && g !== null && g > 0 ? 'FARM' : mult >= 0.3 || (g !== null && g > 5) ? 'MARGINAL' : 'SKIP';
      c[v]++;
    });
    return c;
  })(),
  edgeRow: (() => {
    // The v10 bug row: change_7d just below -10% (rounds to -10.0 at 1 decimal,
    // so v10's rounded growth did NOT halve it; full precision does).
    const p = elig.find((q) => q.change_7d !== null && q.change_7d > -10.1 && q.change_7d < -10);
    return p ? { name: p.name, change_7d: p.change_7d } : null;
  })(),
};
// D-57 signals + capital tiers.
function signals(p: Proto): string[] {
  const s: string[] = [];
  const age = p.listed_at ? ageDays(p) : null;
  if (WATCH.has(p.slug)) s.push('watchlist');
  if (p.change_7d !== null && p.change_7d >= 10) s.push('surging>=10%');
  else if (p.change_7d !== null && p.change_7d <= -10) s.push('sliding<=-10%');
  if (age !== null && age >= 1095) s.push('token-free>=3y');
  if (p.chains.length >= 8) s.push('chains>=8');
  if (p.tvl_usd >= 1e9) s.push('billion-TVL');
  return s;
}
function capitalTier(p: Proto): string {
  if (p.tvl_usd >= 5e8) return 'institutional';
  if (p.tvl_usd >= 1e8) return 'large';
  if (p.tvl_usd >= 25e6) return 'mid';
  return 'early';
}
const SIGS = elig.map(signals);
const D57 = {
  signals: (() => { const c: Record<string, number> = {}; for (const s of SIGS) for (const v of s) c[v] = (c[v] ?? 0) + 1; return c; })(),
  zeroSignals: SIGS.filter((s) => s.length === 0).length,
  tiers: (() => { const c: Record<string, number> = {}; for (const p of elig) { const t = capitalTier(p); c[t] = (c[t] ?? 0) + 1; } return c; })(),
};
// D-58 anchors: per category, top 3 comps by mcap/TVL.
const D58: Record<string, { name: string; mult: number }[]> = {};
for (const c of [...new Set(traded.map((p) => p.category).filter((x): x is string => !!x))].sort()) {
  D58[c] = traded.filter((p) => p.category === c).sort((a, b) => b.mcap_usd! / b.tvl_usd - a.mcap_usd! / a.tvl_usd).slice(0, 3)
    .map((p) => ({ name: p.name, mult: p.mcap_usd! / p.tvl_usd }));
}
// D-59 age percentiles.
function agePct(pool: Proto[]): { n: number; p25: number; median: number; p75: number } {
  const a = pool.filter((p) => p.listed_at).map((p) => ageDays(p)).sort((x, y) => x - y);
  return { n: a.length, p25: Math.round(quantile(a, 0.25)), median: Math.round(median(a)), p75: Math.round(quantile(a, 0.75)) };
}
const D59 = {
  pretoken: agePct(pretoken), live: agePct(PROTO.filter((p) => p.gecko_id || p.symbol)), all: agePct(PROTO),
  unknown: { pretoken: pretoken.filter((p) => !p.listed_at).length, live: PROTO.filter((p) => (p.gecko_id || p.symbol) && !p.listed_at).length },
};
// D-62 disposition accounting (priority: ranked, has-token, bridge, liquid staking, CEX, versioned, wrapped, other).
function dispo(p: Proto): string {
  if (elig.includes(p)) return 'ranked';
  if (p.gecko_id || p.symbol) return 'has_token';
  if (p.category === 'Bridge' || p.category === 'Canonical Bridge') return 'bridge';
  if (p.category === 'Liquid Staking' || p.category === 'Liquid Restaking' || p.category === 'Restaked BTC') return 'liqstak';
  if (p.category === 'CEX') return 'cex';
  if (VERS.test(p.name)) return 'versioned';
  if (WRAP.test(p.name)) return 'wrapped';
  return 'other';
}
const D62: Record<string, number> = { ranked: 0, has_token: 0, bridge: 0, liqstak: 0, cex: 0, versioned: 0, wrapped: 0, other: 0 };
for (const p of PROTO) { const d = dispo(p); D62[d] = (D62[d] ?? 0) + 1; }
// D-09 grey zone: above the $50M floor, not on the sealed watchlist.
const D09 = elig.filter((p) => p.tvl_usd >= 50_000_000 && !WATCH.has(p.slug))
  .map((p) => ({ rank: RANK_OF[elig.indexOf(p)]!, name: p.name }))
  .sort((a, b) => a.rank - b.rank);
// D-28 category median multiples.
const D28: Record<string, { n: number; median: number; p25: number; p75: number }> = {};
{
  const by: Record<string, number[]> = {};
  for (const p of traded) { const c = p.category ?? 'none'; (by[c] ??= []).push(p.mcap_usd! / p.tvl_usd); }
  for (const [c, v] of Object.entries(by).sort((a, b) => b[1].length - a[1].length)) {
    const s = [...v].sort((x, y) => x - y);
    D28[c] = { n: v.length, median: median(v), p25: quantile(s, 0.25), p75: quantile(s, 0.75) };
  }
}
// D-02 time-split single (WF 50/50 median factor for A).
const D02 = STATS.A_lam30!.wfMed[1]!;
// D-06: flat baselines are in STATS (FLAT_mcap, FLAT_mult); R2 + CV are above.
// Narrow flag: logTVL or growth outside the traded range.
const TR_LOGTVL = traded.map((p) => LOG10(p.tvl_usd));
const TR_G = traded.map((p) => p.change_7d ?? 0);
const NARROW = elig.map((p) => {
  const lt = LOG10(p.tvl_usd); const g = p.change_7d ?? 0;
  return lt < Math.min(...TR_LOGTVL) || lt > Math.max(...TR_LOGTVL) || g < Math.min(...TR_G) || g > Math.max(...TR_G);
});
const NARROW_COUNT = NARROW.filter(Boolean).length;
const ZERO_COMP_CATS = elig.filter((p) => (CATN[p.category ?? ''] ?? 0) === 0).length;
// ------------------------------------------------------------------ bootstrap D-22 (200 refits, MT19937 seed 0)
// Resample the 92 traded comps with replacement, refit ridge lam30, predict
// capped implied (CAP = 2.87, float), rank descending. Per row p10/p50/p90 of
// rank across refits. numpy's RandomState(0) seeding is rk_seed (verified).
const BOOT = (() => {
  const mt = new MT19937(0);
  const B = 200;
  const allRanks: number[][] = [];
  const coefs: number[] = [];
  const baseRank = RANK_OF;
  for (let b = 0; b < B; b++) {
    const idx = mt.choice(traded.length, traded.length);
    const m = ridgeFit(idx.map((i) => feats(traded[i]!)), idx.map((i) => Y[i]!), 30);
    const imp = ridgePred(m, elig.map(feats)).map((v, i) => Math.min(10 ** v, 2.87 * elig[i]!.tvl_usd));
    const order = imp.map((_, i) => i).sort((x, y) => imp[y]! - imp[x]! || x - y);
    const r = new Array<number>(elig.length);
    order.forEach((i, pos) => { r[i] = pos + 1; });
    allRanks.push(r);
    coefs.push(m.b[1]!); // standardised logTVL coefficient
  }
  const p10: number[] = []; const p50: number[] = []; const p90: number[] = [];
  const width: number[] = [];
  for (let i = 0; i < elig.length; i++) {
    const col = allRanks.map((r) => r[i]!).sort((a, b) => a - b);
    p10.push(quantile(col, 0.1)); p50.push(quantile(col, 0.5)); p90.push(quantile(col, 0.9));
    width.push(quantile(col, 0.9) - quantile(col, 0.1));
  }
  const baseTop20 = new Set(ORDER_B.slice(0, 20));
  const stab: number[] = [];
  for (let b = 0; b < B; b++) {
    const top20 = new Set(allRanks[b]!.map((r, i) => ({ r, i })).sort((a, b2) => a.r - b2.r).slice(0, 20).map((x) => x.i));
    stab.push([...top20].filter((i) => baseTop20.has(i)).length / 20);
  }
  return {
    p10, p50, p90, width,
    medianWidth: median(width), p90Width: percentile([...width].sort((a, b) => a - b), 90), maxWidth: Math.max(...width),
    le5: width.filter((v) => v <= 5).length, le10: width.filter((v) => v <= 10).length, gt50: width.filter((v) => v > 50).length,
    top20Stability: mean(stab), top20StabilityMedian: median(stab),
    slopeMean: mean(coefs), slopeSd: Math.sqrt(mean(coefs.map((v) => (v - mean(coefs)) ** 2))),
    slopeSe: Math.sqrt(mean(coefs.map((v) => (v - mean(coefs)) ** 2)) / B),
  };
})();
// ------------------------------------------------------------------ D-33 conviction (own scaling, stated in-entry)
// TVL scale 40: linear over the board's log-TVL range [log10(5e6), log10(max TVL)].
// Momentum 20: STABILITY — |7d change| large in either direction lowers
// conviction (a protocol whose TVL whipsaws 40% in a week is less predictable
// than one that moves 2%); mom = 20 * max(0, 1 - |g7|/40).
// Maturity 20: linear in age, capped at 1095 days (20 if listed_at is null).
// Breadth 10: min(chains, 10). Category evidence 10: min(n traded comps, 10).
const LOG_MIN = LOG10(5e6); const LOG_MAX = LOG10(Math.max(...elig.map((p) => p.tvl_usd)));
function conviction(p: Proto): { score: number; parts: [number, number, number, number, number] } {
  const lt = LOG10(p.tvl_usd);
  const tvlPts = 40 * clamp((lt - LOG_MIN) / (LOG_MAX - LOG_MIN), 0, 1);
  const momPts = 20 * Math.max(0, 1 - Math.abs(p.change_7d ?? 0) / 40);
  const matPts = p.listed_at ? (Math.min(ageDays(p), 1095) / 1095) * 20 : 10;
  const brPts = Math.min(p.chains.length, 10);
  const catPts = Math.min(CATN[p.category ?? ''] ?? 0, 10);
  return { score: tvlPts + momPts + matPts + brPts + catPts, parts: [tvlPts, momPts, matPts, brPts, catPts] };
}
const CONV = elig.map(conviction);
const CONV_SCORES = CONV.map((c) => c.score);
const D33 = {
  median: median(CONV_SCORES), mean: mean(CONV_SCORES), min: Math.min(...CONV_SCORES), max: Math.max(...CONV_SCORES),
  top5: CONV_SCORES.map((_, i) => i).sort((a, b) => CONV_SCORES[b]! - CONV_SCORES[a]!).slice(0, 5)
    .map((i) => ({ name: elig[i]!.name, score: CONV_SCORES[i]!, parts: CONV[i]!.parts })),
};
// ------------------------------------------------------------------ D-11 weekly harvest calendar (own stated rule)
// 7 sessions, one chain each: the 7 chains with the most FARM rows (ties by
// total net); all FARM rows on those chains; sessions ordered by net/hour.
// Gas is batched once per session (2 x chain gas) instead of once per row.
const D11 = (() => {
  const byChain: Record<string, number[]> = {};
  elig.forEach((p, i) => { if (ROW_ECON[i]!.verdict === 'FARM') (byChain[p.chains[0] ?? '(none)'] ??= []).push(i); });
  const chains = Object.entries(byChain)
    .sort((a, b) => b[1].length - a[1].length || sum(b[1].map((i) => ROW_ECON[i]!.net)) - sum(a[1].map((i) => ROW_ECON[i]!.net)))
    .slice(0, 7);
  const days = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];
  const sessions = chains.map(([ch, idxs]) => {
    const rows = idxs.map((i) => ({ slug: elig[i]!.slug, name: elig[i]!.name, net: ROW_ECON[i]!.net }));
    const net = sum(rows.map((r) => r.net));
    const hours = rows.length * 0.5;
    const soloGas = sum(idxs.map((i) => 2 * ROW_ECON[i]!.gas));
    const batchedGas = 2 * (GAS[ch] ?? 1);
    return { chain: ch, rows, net, hours, netPerHour: net / hours, soloGas, batchedGas, saved: soloGas - batchedGas };
  }).sort((a, b) => b.netPerHour - a.netPerHour);
  sessions.forEach((s, i) => { (s as { day: string }).day = days[i]!; });
  const totalRows = sum(sessions.map((s) => s.rows.length));
  const totalNet = sum(sessions.map((s) => s.net));
  const totalHours = sum(sessions.map((s) => s.hours));
  const batchedNet = sum(sessions.map((s) => s.rows.reduce((acc, r) => acc + (ROW_ECON[elig.findIndex((p) => p.slug === r.slug)]!.slice * 5 - (PLAN * 0.001 + PLAN * 0.04 * (HZ / 52))) - s.batchedGas / s.rows.length, 0)));
  return { sessions, totalRows, totalNet, totalHours, totalSoloGas: sum(sessions.map((s) => s.soloGas)), totalBatchedGas: sum(sessions.map((s) => s.batchedGas)), batchedNet };
})();

// ------------------------------------------------------------------ farm plans (5 steps per row, all unique)
// D-60: action 1 (position) + action 2 (a second usage trace, per category,
// different from action 1) + a weekly action per category. Step 4 is the
// risk sentence; step 5 is the exit plus the tier-odds label. Every step
// carries at least two data points; every step names the row, so all 990
// are unique by construction (asserted below).
const usd = (n: number): string => '$' + Math.round(n).toLocaleString('en-US');
const usd1 = (n: number): string => '$' + (Math.round(n * 10) / 10).toLocaleString('en-US');
const pct1 = (n: number): string => `${(Math.round(n * 10) / 10).toLocaleString('en-US')}%`;
function cheapChain(p: Proto): string {
  if (!p.chains.length) return 'its main chain';
  let best = p.chains[0]!; let bg = GAS[best] ?? 1;
  for (const c of p.chains) { const g = GAS[c] ?? 1; if (g < bg) { bg = g; best = c; } }
  return best;
}
function catKey(p: Proto): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('dex') || c.includes('swap') || c.includes('perp') || c.includes('derivat') || c.includes('option')) return c.includes('perp') || c.includes('derivat') || c.includes('option') ? 'perps' : 'dex';
  if (c.includes('lend') || c.includes('cdp') || c.includes('credit') || c.includes('borrow')) return 'lending';
  if (c.includes('bridge')) return 'bridge';
  if (c.includes('predict')) return 'prediction';
  if (c.includes('stak') || c.includes('restak')) return 'staking';
  if (c.includes('yield') || c.includes('farm')) return 'yield';
  if (c.includes('rwa') || c.includes('real world')) return 'rwa';
  if (c.includes('basis')) return 'basis';
  if (c.includes('vault') || c.includes('curator') || c.includes('allocat')) return 'vault';
  if (c.includes('stable') || c.includes('dual')) return 'stable';
  if (c.includes('launchpad')) return 'launchpad';
  if (c.includes('privacy')) return 'privacy';
  if (c.includes('payment')) return 'payment';
  if (c.includes('ai') || c.includes('agent')) return 'ai';
  if (c.includes('nft') || c.includes('marketplace')) return 'nft';
  if (c.includes('index')) return 'index';
  if (c.includes('locker')) return 'locker';
  if (c.includes('risk')) return 'risk';
  if (c.includes('collateral') || c.includes('capital')) return 'capital';
  return 'generic';
}
const SECOND_ACTION: Record<string, (p: Proto) => string> = {
  dex: (p) => `run a small swap through ${p.name}'s own pool on ${cheapChain(p)}`,
  perps: (p) => `close one hedge on ${p.name} and open a fresh one`,
  lending: (p) => `borrow a small amount against the position on ${p.name} and repay it`,
  bridge: (p) => `bridge a small amount back through ${p.name} on ${cheapChain(p)}`,
  prediction: (p) => `take a second position in a different market on ${p.name}`,
  staking: (p) => `claim the staking reward on ${p.name} and restake it`,
  yield: (p) => `harvest the yield on ${p.name} once and redeposit it`,
  rwa: (p) => `check the underlying asset's backing for ${p.name} and hold through one attestation cycle`,
  basis: (p) => `check the funding rate on ${p.name} and roll the basis position once`,
  vault: (p) => `review the vault's allocation for ${p.name} after one rebalancing and adjust the position`,
  stable: (p) => `check the peg on ${p.name} and mint or redeem a small amount`,
  payment: (p) => `pay for something small through ${p.name}`,
  ai: (p) => `run one agent task through ${p.name}`,
  nft: (p) => `list or buy one small item through ${p.name}`,
  capital: (p) => `move a small amount to a second allocator on ${p.name}`,
  generic: (p) => `use ${p.name} a second time on a different chain or market`
};
const WEEKLY_ACTION: Record<string, string> = {
  dex: 'Swap a token you already hold through the pool.',
  perps: 'Close one hedge and open a fresh one.',
  lending: 'Check the borrow rate and repay a little of any open loan.',
  bridge: 'Bridge a small amount back.',
  prediction: 'Take a second position in a different market.',
  staking: 'Claim and restake the reward.',
  yield: 'Harvest the yield and redeposit it.',
  rwa: "Check the underlying asset's backing and attestations.",
  basis: 'Check the funding rate and roll the basis position.',
  vault: "Review the vault's allocation and curator notes.",
  stable: 'Check the peg and the collateral ratio.',
  payment: 'Pay for one small thing through the rail.',
  ai: 'Run one agent task.',
  nft: 'Check the floor and one listing.',
  capital: 'Check the allocator performance across chains.',
  generic: 'Use the protocol on a different chain or market.'
};
function farmSteps(p: Proto, i: number): string[] {
  const r = ROW_ECON[i]!;
  const rank = RANK_OF[i]!;
  const imp = IMP_INT[i]!;
  const odds = ODDS_ELIG[i]!;
  const tier = TIER_OF[i]!;
  const key = catKey(p);
  const cc = cheapChain(p);
  const g7 = p.change_7d;
  const bearNet = r.slice * 0.33 * 5 - r.costs;
  const tierRate = TIER_RATES.pooled[tier as 'HIGH' | 'MED' | 'LOW']!;
  const be = r.breakEven;
  const beTxt = be === null ? 'no break-even — the slice never covers the costs' : `${usd(be)} break-even`;
  const s1 = `Put $5,000 to work in ${p.name} on ${cc}: ${usd(r.fee)} in fees plus ${usd(r.gas)} gas, over ${HZ} weeks. If the token launches at the implied ${usd(imp)}, the slice is worth ${usd(r.slice * 5)}.`;
  const s2 = `Then ${(SECOND_ACTION[key] || SECOND_ACTION.generic)!(p)} — a second usage trace, in a different week. The position sits on ${p.chains.length} chain${p.chains.length === 1 ? '' : 's'} with ${usd(p.tvl_usd)} of TVL.`;
  const s3 = `Every week, check ${p.name}: TVL ${usd(p.tvl_usd)} (7d ${g7 === null ? 'unreported' : pct1(g7)}), rank #${rank} on the board. ${WEEKLY_ACTION[key] || WEEKLY_ACTION.generic} If TVL falls 20% below ${usd(p.tvl_usd * 0.8)}, pause new deposits.`;
  const s4 = `The risk: ${p.name} is a ${p.category ?? 'uncategorised'} protocol on ${p.chains.length} chain${p.chains.length === 1 ? '' : 's'}, and the $5,000 plan pays only while TVL stays below ${r.walkAway.toFixed(2)}x its current level — above that the ${usd(r.costs)} costs eat the slice. If the airdrop is worth a third of the slice, the net is ${usd(bearNet)}, so size for the bear case, not the headline.`;
  const s5 = `Exit when the token launches or after ${HZ} weeks, whichever comes first: take the slice if it clears the ${beTxt}, otherwise walk away. Odds tier ${tier} — ${odds.toFixed(3)} token odds (${(tierRate * 100).toFixed(1)}% of similar protocols launched) — a ${r.verdict} at $5,000 over 12 weeks. (Board rank #${rank}.)`;
  return [s1, s2, s3, s4, s5];
}
const FARM_STEPS = elig.map((p, i) => farmSteps(p, i));
// Assert the gate's farm-steps rules (the snapshot is sealed, so a failure
// here is a template bug to fix, not input noise).
{
  const all = FARM_STEPS.flat();
  const uniq = new Set(all);
  if (uniq.size !== all.length) throw new Error(`farm steps are not all unique: ${uniq.size} of ${all.length}`);
  for (const [ri, steps] of FARM_STEPS.entries()) {
    if (steps.length !== 5) throw new Error(`row ${ri}: ${steps.length} farm steps, want 5`);
    for (const s of steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) throw new Error(`row ${ri}: farm step of ${t.length} chars (want 20-600): ${t.slice(0, 60)}...`);
      const nums = (t.match(/-?\d[\d,.]*/g) ?? []).length;
      if (nums < 2) throw new Error(`row ${ri}: farm step with ${nums} data points (want >=2): ${t.slice(0, 60)}...`);
    }
  }
}
// ------------------------------------------------------------------ Top-10 narrative (original, from v11's numbers)
const TOP10 = ORDER_B.slice(0, 10).map((i) => ({ name: elig[i]!.name, implied: IMP_INT[i]!, verdict: ROW_ECON[i]!.verdict, tier: TIER_OF[i]! }));
const TOP10_TOTAL = sum(TOP10.map((r) => r.implied));
const TOP10_CATS = new Set(TOP10.map((r) => elig[elig.findIndex((p) => p.name === r.name)]!.category)).size;
const TOP10_HIGH = TOP10.filter((r) => r.tier === 'HIGH').length;
const TOP10_FARM = TOP10.filter((r) => r.verdict === 'FARM').length;
const TOP10_NARRATIVE = `The board's top is a single name: Anemoy Capital at ${usd(IMP_INT[ORDER_B[0]!]!)} — ${(IMP_INT[ORDER_B[0]!]! / elig[ORDER_B[0]!]!.tvl_usd).toFixed(2)}x its TVL, the only row above ${usd(50000000)}, and one of just ${TOP10_FARM} FARM rows in the top 10. ` +
  `Behind it the board flattens fast: BitFi Basis at ${usd(IMP_INT[ORDER_B[1]!]!)}, then Veda at ${usd(IMP_INT[ORDER_B[2]!]!)}, and seven more rows between ${usd(IMP_INT[ORDER_B[9]!]!)} and ${usd(IMP_INT[ORDER_B[2]!]!)}, so ranks 3-10 are separated by less than ${usd(IMP_INT[ORDER_B[2]!]! - IMP_INT[ORDER_B[9]!]!)} and a single refit can reorder them. ` +
  `${TOP10_HIGH} of the ten are HIGH-tier on token odds, but only ${TOP10_FARM} are FARM at $5,000 over 12 weeks — the rest are MARGINAL or SKIP, because a big implied value does not pay the costs. ` +
  `The ten span ${TOP10_CATS} categories and ${usd(TOP10_TOTAL)} of the board's ${usd(BOARD_TOTAL_INT)}; the other ${elig.length - 10} rows hold the remaining ${usd(BOARD_TOTAL_INT - TOP10_TOTAL)}, and that long tail is where the radar earns its keep.`;
// ------------------------------------------------------------------ default disclosure (35 rows) + integrity strip
const BEAR3 = new Set(elig.filter((_, i) => ROW_ECON[i]!.verdict === 'FARM' && ROW_ECON[i]!.slice * 0.33 * 5 - ROW_ECON[i]!.costs > 25).map((p) => p.slug));
const FRAGILE = new Set(elig.filter((_, i) => ROW_ECON[i]!.verdict === 'FARM' && ROW_ECON[i]!.walkAway < 2).map((p) => p.slug));
const DOWNSIDE = new Set(elig.filter((_, i) => ROW_ECON[i]!.verdict === 'FARM' && Math.abs(-ROW_ECON[i]!.costs) > ROW_ECON[i]!.slice * 5 - ROW_ECON[i]!.costs).map((p) => p.slug));
const DISCLOSURE = new Set([...ORDER_B.slice(0, 10).map((i) => elig[i]!.slug), ...BEAR3, ...FRAGILE, ...DOWNSIDE]);
// ------------------------------------------------------------------ META (everything measured, for board.json + the dashboard)
const META = {
  snapshot: { as_of: snap.as_of, sha256: snapHash, protocols: PROTO.length, watchlist: snap.watchlist.length, floor_usd: snap.floor_usd },
  model: {
    name: 'A (M0 lam30)', rule: 'lowest mean walk-forward factor; a gap under 0.10x falls to the lowest median LOO; a tie falls to model B',
    lam: 30, cap: CAP_P90, capP85: CAP_P85, capP80: CAP_P80, rowsBound: ROWS_BOUND,
    coefs: MODEL_A.b, mu: MODEL_A.mu, sd: MODEL_A.sd, topcats: TOPCATS, medAge: MED_AGE,
    stats: STATS, insampleR2: INSAMPLE_R2, spearmanLOO: SPEARMAN_LOO_A, looResidSd: LOO_RESID_SD,
    newest35Med: NEWEST35_MED, cv5: { A: CV5_A, flat: CV5_FLAT, random: CV5_RANDOM },
    placebo: PLACEBO, flatMultClean: median(MULTS_TR), flatMultDirty: median(tradedAll.map((p) => p.mcap_usd! / p.tvl_usd)),
    growthCoefStd: MODEL_A.b[2]!, growthPearson: pearson(traded.map((p) => p.change_7d ?? 0), traded.map((p) => LOG10(p.mcap_usd! / p.tvl_usd))),
    growthSpearman: spearman(traded.map((p) => p.change_7d ?? 0), traded.map((p) => LOG10(p.mcap_usd! / p.tvl_usd))),
    d24: { ...STATS.D24_k3!, board: D24_BOARD }, d25: STATS.D25_likelihood, d26: STATS.D26_asym,
    d31: { sqrt: STATS.D31_sqrtmat, lin: STATS.D31_linmat }, d32: STATS.D32_sqrtmat_x_asym,
    curve: { clean92: CURVE_CLEAN, dirty128: CURVE_DIRTY, boardClean: CURVE_BOARD_CLEAN, boardDirty: CURVE_BOARD_DIRTY, alone: CURVE_ALONE },
    capSens: CAP_SENS, lam100Board: LAM100_BOARD,
  },
  odds: {
    weights: W_ODDS, baseRate: BASE_RATE, wf: WF_ODDS,
    tierCutoffs: TIER_CUTS, tierCounts: { LOW: 66, MED: 66, HIGH: 66 }, tierRates: TIER_RATES,
    expectedBoard: EXPECTED_BOARD,
  },
  board: {
    rows: elig.length, totalInt: BOARD_TOTAL_INT, totalFloat: BOARD_TOTAL_FLOAT,
    top1: { name: TOP10[0]!.name, implied: TOP10[0]!.implied },
    top5: sum(ORDER_B.slice(0, 5).map((i) => IMP_INT[i]!)), top10: TOP10_TOTAL,
    median: median(IMP_INT), p10: percentile([...IMP_INT].sort((a, b) => a - b), 10), p90: percentile([...IMP_INT].sort((a, b) => a - b), 90),
    min: Math.min(...IMP_INT), maxMult: Math.max(...IMP_INT.map((v, i) => v / elig[i]!.tvl_usd)),
    multMedian: median(IMP_INT.map((v, i) => v / elig[i]!.tvl_usd)), multP90: percentile(IMP_INT.map((v, i) => v / elig[i]!.tvl_usd).sort((a, b) => a - b), 90),
    verdicts: VERDICTS, top10Narrative: TOP10_NARRATIVE,
    top10: TOP10, top10Cats: TOP10_CATS, top10High: TOP10_HIGH, top10Farm: TOP10_FARM,
    narrowFlagged: NARROW_COUNT, zeroCompCats: ZERO_COMP_CATS,
    disclosure: { top10: 10, bear3: BEAR3.size, fragile: FRAGILE.size, downside: DOWNSIDE.size, union: DISCLOSURE.size },
  },
  ranges: { hwIn: HW_IN, hwOut: HW_OUT, q50: Q50_FULL, q80: Q80_FULL, sweep: RANGE_SWEEP, cleanCut: CLEAN_CUT, conformal: CONFORMAL, ushape: D41_USHAPE },
  economics: {
    plan: PLAN, hz: HZ, drop: DROP, thr: THR, d03: D03, d03Flowdesk: D03_FLOWDESK, d04: D04,
    d47: D47, d48: { ...D48, survivors: D48_SURVIVORS }, d49: { ...D49, survivors5k: D49_SURVIVORS },
    d50: D50, d51: D51, d55: D55, d56: D56, d57: D57,
  },
  extra: {
    d53: D53, d54: D54, d58: D58, d59: D59, d62: D62, d09: D09, d28: D28, d33: D33, d11: D11,
    bootstrap: { medianWidth: BOOT.medianWidth, p90Width: BOOT.p90Width, maxWidth: BOOT.maxWidth, le5: BOOT.le5, le10: BOOT.le10, gt50: BOOT.gt50, top20Stability: BOOT.top20Stability, top20StabilityMedian: BOOT.top20StabilityMedian, slopeMean: BOOT.slopeMean, slopeSd: BOOT.slopeSd, slopeSe: BOOT.slopeSe },
  },
};
// ------------------------------------------------------------------ board.json rows
const BOARD_ROWS = ORDER_B.map((i) => {
  const p = elig[i]!;
  const r = ROW_ECON[i]!;
  return {
    slug: p.slug, name: p.name, rank: RANK_OF[i]!, implied_value_usd: IMP_INT[i]!,
    farm_steps: FARM_STEPS[i]!,
    category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, change_7d: p.change_7d, listed_at: p.listed_at,
    odds: ODDS_ELIG[i]!, tier: TIER_OF[i]!, verdict: r.verdict,
    net_usd: r.net, fee_usd: r.fee, slice_usd: r.slice, costs_usd: r.costs, gas_usd: r.gas,
    break_even_usd: r.breakEven, walk_away_mult: r.walkAway,
    multiple: IMP_INT[i]! / p.tvl_usd,
    range_lo_usd: Math.max(1, jsRound(IMP_INT[i]! / 10 ** HW_OUT)),
    range_hi_usd: jsRound(IMP_INT[i]! * 10 ** HW_OUT),
    range_inner_lo_usd: Math.max(1, jsRound(IMP_INT[i]! / 10 ** HW_IN)),
    range_inner_hi_usd: jsRound(IMP_INT[i]! * 10 ** HW_IN),
    rank_lo: Math.round(BOOT.p10[i]!), rank_med: Math.round(BOOT.p50[i]!), rank_hi: Math.round(BOOT.p90[i]!),
    conviction: CONV[i]!.score, conviction_parts: CONV[i]!.parts,
    ev_per_cost: EV_COST[i]!, farm_value_usd: FARM_VALUE[i]!, gas_share_pct: GAS_SHARE[i]!,
    launch_score: LAUNCH_NG[i]!, launch_score_full: LAUNCH_FULL[i]!, confidence: CONF[i]!,
    signals: SIGS[i]!, capital_tier: capitalTier(p),
    watchlist: WATCH.has(p.slug), narrow_flag: NARROW[i]!,
    grey_zone: p.tvl_usd >= 50_000_000 && !WATCH.has(p.slug),
  };
});
// ------------------------------------------------------------------ output
function copyDir(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true });
  for (const e of readdirSync(src, { withFileTypes: true })) {
    if (e.isDirectory()) copyDir(join(src, e.name), join(dst, e.name));
    else if (e.isFile()) copyFileSync(join(src, e.name), join(dst, e.name));
  }
}
mkdirSync(OUTPUT, { recursive: true });
// dashboard: static files copied, data.js generated (packed board + compact meta).
copyDir(join(HERE, 'dashboard'), join(OUTPUT, 'dashboard'));
const CHAINS = [...new Set(elig.flatMap((p) => p.chains))].sort();
const CATS = [...new Set(elig.map((p) => p.category).filter((c): c is string => !!c))].sort();
const chainIdx = (c: string): string => CHAINS.indexOf(c).toString(36);
const dashRows = ORDER_B.map((i) => {
  const p = elig[i]!;
  return [
    p.name, CATS.indexOf(p.category ?? ''),
    p.chains.map((c) => CHAINS.indexOf(c)).join(','),
    p.tvl_usd.toString(36), p.change_7d ?? '', p.listed_at ? Math.round(ageDays(p)) : '',
    IMP_INT[i]!.toString(36), Math.round(ODDS_ELIG[i]! * 1000),
    Math.round(BOOT.p10[i]!), Math.round(BOOT.p50[i]!), Math.round(BOOT.p90[i]!),
    TIER_OF[i]![0]!, ROW_ECON[i]!.verdict[0]!,
    WATCH.has(p.slug) ? 1 : 0, p.tvl_usd >= 50_000_000 && !WATCH.has(p.slug) ? 1 : 0, NARROW[i]! ? 1 : 0,
  ].join('|');
});
const DASH_META = {
  total: BOARD_TOTAL_INT, verdicts: VERDICTS, top1: TOP10[0], top10Total: TOP10_TOTAL,
  narrative: TOP10_NARRATIVE, hwIn: HW_IN, hwOut: HW_OUT,
  brier: WF_ODDS.map((w) => [w.brier, w.baseBrier, w.calledRight, w.nTest]),
  tierCuts: TIER_CUTS, tierRates: { perCut: TIER_RATES.perCut.map((p) => [p.HIGH, p.MED, p.LOW]), pooled: [TIER_RATES.pooled.HIGH, TIER_RATES.pooled.MED, TIER_RATES.pooled.LOW] }, expected: EXPECTED_BOARD,
  d03: [D03.finite, D03.never, D03.median, D03.p10, D03.p90, D03.max, D03.maxRow], d04: [D04.median, D04.p10, D04.p90, D04.min, D04.max, D04.fragile, D04.robust, D04.robustNames], d47: [[D47.typical.pv, D47.typical.counts.FARM, D47.typical.counts.MARGINAL, D47.typical.counts.SKIP], [D47.harsh.pv, D47.harsh.counts.FARM, D47.harsh.counts.MARGINAL, D47.harsh.counts.SKIP], [D47.generous.pv, D47.generous.counts.FARM, D47.generous.counts.MARGINAL, D47.generous.counts.SKIP]], d48: [[D48.bear033.FARM, D48.bear033.MARGINAL, D48.bear033.SKIP], [D48.bull25.FARM, D48.bull25.MARGINAL, D48.bull25.SKIP], [D48.bull30.FARM, D48.bull30.MARGINAL, D48.bull30.SKIP], D48_SURVIVORS.map((s) => [s.name, s.net])],
  d49: [[D49['$1000'].counts.FARM, D49['$1000'].counts.MARGINAL, D49['$1000'].counts.SKIP], [D49['$5000'].counts.FARM, D49['$5000'].counts.MARGINAL, D49['$5000'].counts.SKIP], [D49['$25000'].counts.FARM, D49['$25000'].counts.MARGINAL, D49['$25000'].counts.SKIP]],
  d50: [D50.median, D50.p90, D50.max, D50.gt1, D50.gt3],
  d51: [[D51.multiwallet.FARM, D51.multiwallet.MARGINAL, D51.multiwallet.SKIP], D51.downsideMedian, D51.upsideMedian, D51.rowsDownGtUp],

  d57: [[D57.signals['surging>=10%'], D57.signals['sliding<=-10%'], D57.signals['token-free>=3y'], D57.signals['chains>=8'], D57.signals['billion-TVL'], D57.signals.watchlist], D57.zeroSignals, [D57.tiers.early, D57.tiers.mid, D57.tiers.large, D57.tiers.institutional]],
  d54: [[D54.counts['70'], D54.counts['100']], [D54.missing.change_7d, D54.missing.listed_at, D54.missing.category, D54.missing.chains]], d62: [D62.ranked, D62.has_token, D62.bridge, D62.liqstak, D62.cex, D62.versioned, D62.wrapped, D62.other], greyCount: D09.length,
  d11: { sessions: D11.sessions.map((s) => [(s as { day: string }).day, s.chain, s.rows.length, s.net, s.hours, s.netPerHour, s.soloGas, s.batchedGas, s.saved]), totalRows: D11.totalRows, totalNet: D11.totalNet, totalHours: D11.totalHours, batchedNet: D11.batchedNet },
  boot: [BOOT.medianWidth, BOOT.p90Width, BOOT.maxWidth, BOOT.le5, BOOT.le10, BOOT.gt50, BOOT.top20Stability, BOOT.slopeMean, BOOT.slopeSd],
  model: { medLOO: STATS.A_lam30!.medLOO, meanWF: STATS.A_lam30!.meanWF, medWF: STATS.A_lam30!.medWF, cap: CAP_P90, r2: INSAMPLE_R2, cv5: CV5_A.r2, placebo: PLACEBO.medLOO, catn: CATS.map((c) => CATN[c] ?? 0) },
  disclosure: DISCLOSURE.size, rangeSweep: { '1.5': RANGE_SWEEP['1.5'], '1.6': RANGE_SWEEP['1.6'] }, cleanCut: { inner: CLEAN_CUT.inner, outer: CLEAN_CUT.outer, byTercile: CLEAN_CUT.byTercile.map((t) => t.medErr) },
  ushape: D41_USHAPE.map((u) => u.med),
  d28: Object.entries(D28).map(([c, v]) => [CATS.indexOf(c), v.n, v.median]).sort((a, b) => (b[1] as number) - (a[1] as number)).slice(0, 6),
  sweep: (() => {
    // Compact: [medLOO, meanLOO, medWF, meanWF] per model (the per-cut arrays
    // are in board.json; the dashboard only shows the four headline numbers).
    const c = (s: ModelStats): [number, number, number, number] => [s.medLOO, s.meanLOO, s.medWF, s.meanWF];
    return { lam: { '1': c(STATS.lam1!), '3': c(STATS.lam3!), '10': c(STATS.lam10!), '30': c(STATS.A_lam30!), '100': c(STATS.lam100!) }, B: c(STATS.B_lam3!), C: c(STATS.C_pow045!), D24: c(STATS.D24_k3!), D25: c(STATS.D25_likelihood!), D26: c(STATS.D26_asym!), D31s: c(STATS.D31_sqrtmat!), D31l: c(STATS.D31_linmat!), D32: c(STATS.D32_sqrtmat_x_asym!), curve: c(STATS.curve_full!), ols: c(STATS.OLS_loglog!), flatMcap: c(STATS.FLAT_mcap!), flatMult: c(STATS.FLAT_mult!) };
  })(),
};
// Round dashboard-meta floats to 4 decimals (display only; board.json META keeps full precision).
const DASH_META_R = JSON.parse(JSON.stringify(DASH_META, (_k, v) => (typeof v === 'number' ? Math.round(v * 1e4) / 1e4 : v)));
// hwIn/hwOut at FULL precision (not 4dp): app.js computes the live 80%/50%
// ranges from them, and brief §7.1.6 requires JS-derived fields to match
// board.json exactly — 4dp moved ranges by up to ~$2k (e.g. Anemoy rangeLo
// $1,566,655 vs board $1,566,529). Their toFixed(3) display is unchanged.
DASH_META_R.hwIn = HW_IN;
DASH_META_R.hwOut = HW_OUT;
// Repair (v11 Rebuild): display-only floats to 3 decimals in the dashboard
// meta — verified: every app.js display of these values is byte-identical
// at 3 decimals; full precision stays in board.json META. NOT rounded:
// hwIn/hwOut (they feed the live range math in app.js), and the values whose
// toFixed display would change at 3 decimals — captured below and restored:
// sweep lam3[0] 3.3945, sweep B[3] 5.6245, brier base 0.2495, d47 harsh PV
// 0.7075, boot slope 0.1845, ushape 3.2352/2.4548, d28 median 1.2205.
const R3 = (v: number): number => Math.round(v * 1000) / 1000;
function roundNums(o: unknown): void {
  if (Array.isArray(o)) { for (let i = 0; i < o.length; i++) { const v = o[i]; if (typeof v === 'number') o[i] = R3(v); else if (v && typeof v === 'object') roundNums(v); } return; }
  if (o && typeof o === 'object') { for (const k of Object.keys(o)) { const v = (o as Record<string, unknown>)[k]; if (typeof v === 'number') (o as Record<string, unknown>)[k] = R3(v); else if (v && typeof v === 'object') roundNums(v); } }
}
const M3 = DASH_META_R;
const keep4: Array<[unknown[], number, number]> = [
  [M3.sweep.lam['3'], 0, M3.sweep.lam['3'][0]], [M3.sweep.B, 3, M3.sweep.B[3]],
  [M3.brier[2], 1, M3.brier[2][1]], [M3.d47[1], 0, M3.d47[1][0]],
  [M3.boot, 7, M3.boot[7]], [M3.ushape, 0, M3.ushape[0]], [M3.ushape, 1, M3.ushape[1]],
  [M3.d28[5], 2, M3.d28[5][2]],
];
roundNums(M3.sweep); roundNums(M3.brier); roundNums(M3.tierCuts); roundNums(M3.tierRates);
roundNums(M3.model); roundNums(M3.d03); roundNums(M3.d04); roundNums(M3.d47); roundNums(M3.d48);
roundNums(M3.d50); roundNums(M3.d51); roundNums(M3.d11); roundNums(M3.boot);
roundNums(M3.rangeSweep); roundNums(M3.cleanCut); roundNums(M3.ushape); roundNums(M3.d28);
M3.expected = R3(M3.expected);
for (const [arr, i, v] of keep4) arr[i] = v;
// Model A coefficients at FULL precision for the dashboard Rebuild (NOT
// through DASH_META_R's 4-decimal rounding): b/mu/sd/cap/topcats are the
// same values board.json META.model carries (verified equal after the run).
const MODEL_K = { b: MODEL_A.b, mu: MODEL_A.mu, sd: MODEL_A.sd, cap: CAP_P90, c: TOPCATS };
const dataJs = `window.BOARD=${JSON.stringify({ m: DASH_META_R, k: MODEL_K, c: CHAINS.join(','), g: CATS.join(','), r: dashRows.join('\n') })};\n`;
writeFileSync(join(OUTPUT, 'dashboard', 'data.js'), dataJs);
writeFileSync(join(OUTPUT, 'board.json'), JSON.stringify({ rows: BOARD_ROWS, meta: META }, null, 1) + '\n');
// screenshots (rendered separately, copied in when they exist).
const shotsSrc = join(HERE, 'screenshots');
const shotsDst = join(OUTPUT, 'screenshots');
if (existsSync(shotsSrc) && readdirSync(shotsSrc).filter((f) => !f.startsWith('.')).length > 0) {
  copyDir(shotsSrc, shotsDst);
  const dossier = buildDossier(OUTPUT, { text_max_bytes: 65536 });
  writeFileSync(join(OUTPUT, 'dossier.json'), dossier);
  console.log(`v11: board ${BOARD_ROWS.length} rows, total ${usd(BOARD_TOTAL_INT)}, verdicts ${VERDICTS.FARM}/${VERDICTS.MARGINAL}/${VERDICTS.SKIP}`);
  console.log(`v11: dossier ${dossier.length} bytes, text ${(JSON.parse(Buffer.from(dossier).toString('utf8')) as { text: string }).text.length} bytes`);
} else {
  console.log(`v11: board ${BOARD_ROWS.length} rows, total ${usd(BOARD_TOTAL_INT)}, verdicts ${VERDICTS.FARM}/${VERDICTS.MARGINAL}/${VERDICTS.SKIP}`);
  console.log('v11: NO screenshots yet — dossier skipped. Render 4 screenshots, copy into entry-v11/screenshots/, re-run main.ts.');
}
