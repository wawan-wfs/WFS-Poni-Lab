// Local Web Audio sound synthesis from the Poni 1.8.1 reference.
(function () {
  const TAU = Math.PI * 2;
  /** Control curves (the slow swells) move slowly: a few thousand values a second are plenty. */
  const CR = 3000;

  // seeded random numbers (mulberry32): a test can make the same sound twice
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // noise colours, a sample at a time (brown leans the same way at any sample rate)
  function colour(kind, r, sr) {
    if (kind === 'pink') { // Paul Kellet's refined filter
      let b0 = 0; let b1 = 0; let b2 = 0; let b3 = 0; let b4 = 0; let b5 = 0; let b6 = 0;
      return () => {
        const w = r() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        const out = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
        b6 = w * 0.115926;
        return out * 0.11;
      };
    }
    if (kind === 'brown') { let b = 0; const k = 0.02 * 48000 / sr; return () => { b = (b + k * (r() * 2 - 1)) / (1 + k); return b; }; }
    return () => r() * 2 - 1;
  }

  // a biquad filter (RBJ's cookbook) over the samples, in place. `circular`: the samples loop, so the filter runs over
  // them twice and keeps the second pass, which carries on from their end into their start without a seam
  function biquad(x, sr, type, f, q = 0.707, circular = false) {
    const w = TAU * Math.min(f, sr * 0.45) / sr; const cs = Math.cos(w); const al = Math.sin(w) / (2 * q);
    let b0; let b1; let b2;
    if (type === 'lowpass') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; } else if (type === 'highpass') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; } else { b0 = al; b1 = 0; b2 = -al; }
    const a0 = 1 + al; const c1 = -2 * cs / a0; const c2 = (1 - al) / a0;
    b0 /= a0; b1 /= a0; b2 /= a0;
    let x1 = 0; let x2 = 0; let y1 = 0; let y2 = 0;
    for (let pass = circular ? 2 : 1; pass > 0; pass--) {
      for (let i = 0; i < x.length; i++) {
        const v = x[i];
        const y = b0 * v + b1 * x1 + b2 * x2 - c1 * y1 - c2 * y2;
        x2 = x1; x1 = v; y2 = y1; y1 = y;
        if (pass === 1) x[i] = y;
      }
    }
  }

  function rms(chs) { let s = 0; let n = 0; for (const c of chs) { for (let i = 0; i < c.length; i++) s += c[i] * c[i]; n += c.length; } return Math.sqrt(s / n) || 1; }
  function scale(chs, k) { for (const c of chs) for (let i = 0; i < c.length; i++) c[i] *= k; }

  // `secs` of stereo noise (each side its own) that loops without a seam: made half a second longer, and that end
  // faded into its start (equal power, so the level doesn't dip); RMS 0.1. Low sounds (rumble) are made at a lower
  // `rate`: a quarter of the work and the memory, and nothing lost
  function noise(ctx, secs, kind, filters, r, rate = ctx.sampleRate) {
    const sr = rate; const n = Math.round(secs * sr); const F = Math.round(0.5 * sr); const W = Math.round(0.25 * sr);
    const buf = ctx.createBuffer(2, n, sr); const chs = [];
    for (let c = 0; c < 2; c++) {
      const next = colour(kind, rng(r() * 4294967296), sr);
      const x = new Float32Array(W + n + F);
      for (let i = 0; i < x.length; i++) x[i] = next();
      for (const [type, f, q] of filters) biquad(x, sr, type, f, q);
      const out = buf.getChannelData(c);
      for (let i = 0; i < n; i++) out[i] = x[W + i];
      for (let i = 0; i < F; i++) { const a = ((i + 0.5) / F) * Math.PI / 2; out[i] = x[W + i] * Math.sin(a) + x[W + n + i] * Math.cos(a); }
      chs.push(out);
    }
    scale(chs, 0.1 / rms(chs));
    return buf;
  }

  // a stereo loop of short sounds (drops, crackles): add(at seconds, sample(i), length, pan 0-1); one that runs past
  // the end comes in at the start, so the loop has no seam
  function events(ctx, secs, rate = ctx.sampleRate) {
    const sr = rate; const n = Math.round(secs * sr);
    const buf = ctx.createBuffer(2, n, sr); const L = buf.getChannelData(0); const R = buf.getChannelData(1);
    const add = (t, f, len, pan) => {
      const s = Math.floor(t * sr) % n; const p = Math.max(0, Math.min(1, pan)) * Math.PI / 2; const gl = Math.cos(p); const gr = Math.sin(p);
      for (let i = 0; i < len; i++) { const v = f(i); const j = (s + i) % n; L[j] += v * gl; R[j] += v * gr; }
    };
    return { buf, add, sr, secs };
  }

  // a smooth wandering curve from 0 to 1 that loops after `n` values: slow waves of whole cycles over the loop
  function wander(r, parts, n) {
    const x = new Float32Array(n);
    for (let k = 1; k <= parts; k++) {
      const a = (0.6 + 0.8 * r()) / k ** 0.9; const ph = r() * TAU; const cw = Math.cos(TAU * k / n); const sw = Math.sin(TAU * k / n);
      // (a turning pointer instead of a sine per value)
      let c = Math.cos(ph); let s = Math.sin(ph);
      for (let i = 0; i < n; i++) { x[i] += a * s; const t = c * cw - s * sw; s = s * cw + c * sw; c = t; }
    }
    let lo = Infinity; let hi = -Infinity;
    for (const v of x) { if (v < lo) lo = v; if (v > hi) hi = v; }
    for (let i = 0; i < n; i++) x[i] = (x[i] - lo) / (hi - lo || 1);
    return x;
  }

  // ocean swells over `secs`: waves of 7-11 s that fill the loop exactly. [the swell itself, the foam once it breaks]
  function swells(r, n, secs) {
    const A = new Float32Array(n); const B = new Float32Array(n);
    const lens = []; let sum = 0;
    while (sum < secs - 6) { const l = 7 + 4 * r(); lens.push(l); sum += l; }
    let start = 0;
    for (const l of lens) {
      const P = l * secs / sum; const a = 0.55 + 0.45 * r(); const rise = 0.45 * P; const fall = 0.3 * P; const wash = 0.5 * P;
      // over two periods (its tail runs on under the next wave), round the loop's end
      const m = Math.round(2 * P * CR); const s0 = Math.round(start * CR);
      for (let i = 0; i < m; i++) {
        const u = i / CR; let ea; let eb;
        if (u < rise) { ea = a * (0.5 - 0.5 * Math.cos(Math.PI * u / rise)) ** 1.6; eb = 0.25 * ea; } else {
          const d = u - rise;
          ea = a * Math.exp(-d / fall);
          eb = a * (d < 0.35 ? 0.25 + 0.75 * (d / 0.35) : Math.exp(-(d - 0.35) / wash));
        }
        const j = (s0 + i) % n;
        if (ea > A[j]) A[j] = ea;
        if (eb > B[j]) B[j] = eb;
      }
      start += P;
    }
    return [A, B];
  }

  // a looping source of control curves; ch[i] is curve i, to drive() parameters with
  function control(ctx, secs, make) {
    const n = Math.round(secs * CR);
    const curves = make(n);
    const buf = ctx.createBuffer(curves.length, n, CR);
    curves.forEach((c, i) => buf.copyToChannel(c, i));
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const sp = ctx.createChannelSplitter(curves.length); src.connect(sp);
    const ch = curves.map((_, i) => { const g = ctx.createGain(); sp.connect(g, i); return g; });
    return { src, ch };
  }
  // the parameter = `base` + the curve (0-1) × `depth`
  function drive(ctx, from, param, base, depth) { param.value = base; const g = ctx.createGain(); g.gain.value = depth; from.connect(g).connect(param); }

  // a looping buffer → (a filter) → a gain → `dest`
  function layer(ctx, buffer, dest, gain = 1, filter = null) {
    const src = ctx.createBufferSource(); src.buffer = buffer; src.loop = true;
    const g = ctx.createGain(); g.gain.value = gain;
    (filter ? src.connect(filter) : src).connect(g).connect(dest);
    return { src, g, filter };
  }
  function filt(ctx, type, f, q = 0.707) { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }

  function rainDrops(ctx, secs, r) {
    const e = events(ctx, secs); const { sr } = e;
    // the patter: lots of tiny ticks, most of them faint
    for (let k = Math.round(secs * 140); k > 0; k--) {
      const len = Math.round(sr * (0.0006 + r() * 0.0018)); const tau = len / 3; const a = 0.04 + 0.5 * r() ** 4;
      e.add(r() * secs, (i) => (r() * 2 - 1) * a * Math.exp(-i / tau), len, r());
    }
    // and drops: a short "plink" whose pitch rises a little
    for (let k = Math.round(secs * 7); k > 0; k--) {
      const f0 = 1700 * 2.3 ** r(); const tau = sr * (0.006 + r() * 0.014); const len = Math.round(tau * 5); const a = 0.05 + 0.2 * r() ** 2;
      let ph = 0;
      e.add(r() * secs, (i) => { ph += TAU * f0 * (1 + 0.3 * i / len) / sr; return Math.sin(ph) * a * Math.exp(-i / tau); }, len, 0.15 + 0.7 * r());
    }
    // (the ticks' low thump out)
    for (let c = 0; c < 2; c++) biquad(e.buf.getChannelData(c), sr, 'highpass', 1200, 0.7, true);
    return e.buf;
  }

  function fireCrackles(ctx, secs, r) {
    const e = events(ctx, secs); const { sr } = e;
    // bursts of tiny clicks, most of them faint, a few loud
    for (let k = Math.round(secs * 5); k > 0; k--) {
      const t0 = r() * secs; const pan = 0.2 + 0.6 * r();
      for (let j = 1 + Math.floor(r() * 7); j > 0; j--) {
        const len = Math.round(sr * (0.0003 + r() * 0.0012)); const tau = len / 4; const a = Math.min(0.35, 0.04 / Math.max(0.02, r()) ** 0.7);
        e.add(t0 + r() * 0.07, (i) => (r() * 2 - 1) * a * Math.exp(-i / tau), len, pan + 0.1 * (r() - 0.5));
      }
    }
    for (let c = 0; c < 2; c++) biquad(e.buf.getChannelData(c), sr, 'highpass', 900, 0.7, true);
    // now and then a soft pop: a quick, low knock
    for (let k = Math.round(secs * 0.5); k > 0; k--) {
      const f0 = 300 + 400 * r(); const tau = sr * (0.01 + 0.015 * r()); const len = Math.round(tau * 5); const a = 0.12 + 0.16 * r();
      e.add(r() * secs, (i) => Math.sin(TAU * f0 * i / sr) * a * Math.exp(-i / tau) * Math.min(1, i / 24), len, 0.25 + 0.5 * r());
    }
    return e.buf;
  }

  // ---- café: far voices, the room, a spoon on a cup now and then, and the espresso machine's steam once in a while
  // (their loops run round: each is made once over its last moments first, which carry on into its start, so it has
  // no seam; filters and smoothing forget where they started well within that)

  // vowels' first three formants (Hz, a man's; a woman's are about 17% higher)
  const VOWELS = [[730, 1090, 2440], [530, 1840, 2480], [270, 2290, 3010], [570, 840, 2410], [300, 870, 2240], [660, 1720, 2410], [490, 1350, 1690], [440, 1020, 2240]];

  // One person talking somewhere in the room, `n` samples round the loop: a buzz at their pitch (with some breath)
  // through three formants that glide from vowel to vowel, in syllables of 0.13-0.28 s (4-7 a second) and phrases
  // with pauses between, low-passed by how far away they are (`top` Hz). Its pitch is nudged so that its cycles fill
  // the loop exactly.
  function talker(n, sr, r, top) {
    const woman = r() < 0.5; const k = woman ? 1.17 : 1; const p0 = woman ? 185 + 50 * r() : 100 + 40 * r();
    // the plan: the syllable each sample is in (T[that + 1]: its pitch and formants; T[0] in pauses), how loud, and
    // whether it starts with a consonant (a puff of breath)
    const idx = new Int16Array(n).fill(-1); const amp = new Float32Array(n); const puff = new Uint8Array(n);
    const T = [[p0, 500 * k, 1500 * k, 2500 * k]];
    const at0 = Math.floor(r() * n); let t = Math.round(r() * 0.8 * sr);
    const atk = Math.round(0.035 * sr); const rel = Math.round(0.06 * sr);
    for (;;) {
      const m = 3 + Math.floor(r() * 9); const lift = 1.04 + 0.12 * r();
      const syl = Array.from({ length: m }, () => Math.round((0.13 + 0.15 * r()) * sr));
      if (t + syl.reduce((a, b) => a + b, 0) > n - 0.25 * sr) break;
      syl.forEach((s, j) => {
        const a = (0.45 + 0.55 * r()) * (j === m - 1 ? 0.7 : 1);
        const v = VOWELS[Math.floor(r() * VOWELS.length)];
        T.push([p0 * (lift - 0.25 * j / m) * (0.95 + 0.1 * r()), v[0] * k, v[1] * k, v[2] * k]);
        const q = T.length - 2; const cons = r() < 0.55 ? Math.round((0.02 + 0.04 * r()) * sr) : 0;
        for (let i = 0; i < s; i++) {
          const x = (at0 + t + i) % n;
          idx[x] = q; puff[x] = i < cons ? 1 : 0;
          amp[x] = a * (i < atk ? 0.5 - 0.5 * Math.cos(Math.PI * i / atk) : i > s - rel ? 0.5 + 0.5 * Math.cos(Math.PI * (i - s + rel) / rel) : 1);
        }
        t += s;
      });
      t += Math.round((0.2 + 1.4 * r() ** 1.6) * sr);
    }
    // pitch glides (30 ms), formants (25 ms, moved with their filters every 16 samples) and breath (10 ms) follow the
    // plan smoothly
    const kp = 1 - Math.exp(-1 / (0.03 * sr)); const kf = 1 - Math.exp(-16 / (0.025 * sr)); const kb = 1 - Math.exp(-1 / (0.01 * sr));
    const W = Math.min(n, Math.round(0.3 * sr));
    let p = p0; let cyc = 0;
    for (let j = n - W; j < 2 * n; j++) { p += kp * (T[idx[j % n] + 1][0] - p); if (j >= n) cyc += p / sr; }
    const fit = Math.max(1, Math.round(cyc)) / cyc;
    // three band-passes on the formants (new coefficients every 16 samples), then the distance's low-pass
    const bw = [90, 120, 180]; const g = [1, 0.6, 0.22]; const B = [0, 0, 0]; const A1 = [0, 0, 0]; const A2 = [0, 0, 0];
    const z = new Float64Array(12); const fq = [T[0][1], T[0][2], T[0][3]];
    const w = TAU * top / sr; const cw = Math.cos(w); const al = Math.sin(w) / 1.2; const a0 = 1 + al;
    const l0 = (1 - cw) / 2 / a0; const l1 = (1 - cw) / a0; const la1 = -2 * cw / a0; const la2 = (1 - al) / a0;
    let x1 = 0; let x2 = 0; let y1 = 0; let y2 = 0;
    const seed = (r() * 4294967296) | 0; const out = new Float32Array(n);
    let ph = 0; let br = 0.12; p = p0;
    for (let j = n - W; j < 2 * n; j++) {
      const i = j % n; const tg = T[idx[i] + 1];
      p += kp * (tg[0] - p); br += kb * ((puff[i] ? 0.6 : 0.12) - br);
      if ((i & 15) === 0) {
        for (let q = 0; q < 3; q++) {
          fq[q] += kf * (tg[q + 1] - fq[q]);
          const f = Math.min(fq[q], 0.42 * sr); const wq = TAU * f / sr; const aq = Math.sin(wq) * bw[q] / (2 * f); const d = 1 + aq;
          B[q] = aq / d; A1[q] = -2 * Math.cos(wq) / d; A2[q] = (1 - aq) / d;
        }
      }
      const dt = p * fit / sr; ph += dt; if (ph >= 1) ph -= 1;
      // a saw without its aliasing (polyBLEP), and noise from the sample's own number (the same both times round)
      let saw = 2 * ph - 1;
      if (ph < dt) { const u = ph / dt; saw -= u + u - u * u - 1; } else if (ph > 1 - dt) { const u = (ph - 1) / dt; saw -= u * u + u + u + 1; }
      let h = Math.imul(i ^ seed, 0x9e3779b1); h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13;
      const x = (saw * (1 - br) + (h / 2147483648) * br * 1.4) * amp[i];
      let y = 0;
      for (let q = 0, o = 0; q < 3; q++, o += 4) { const v = B[q] * (x - z[o + 1]) - A1[q] * z[o + 2] - A2[q] * z[o + 3]; z[o + 1] = z[o]; z[o] = x; z[o + 3] = z[o + 2]; z[o + 2] = v; y += g[q] * v; }
      const lp = l0 * (y + x2) + l1 * x1 - la1 * y1 - la2 * y2; x2 = x1; x1 = y; y2 = y1; y1 = lp;
      if (j >= n) out[i] = lp;
    }
    return out;
  }

  // a small room (Freeverb's combs and all-passes): what blurs far voices into a murmur. One bank of combs, summed two
  // ways for the two sides; returns the reverb alone, [left, right]
  function room(x, sr, r, size = 0.83, damp = 0.3) {
    const s = sr / 44100; const n = x.length; const W = Math.min(n, Math.round(2.5 * sr));
    const cb = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((d) => new Float32Array(Math.max(1, Math.round((d + 40 * r()) * s))));
    const ab = [556, 441, 341, 225, 579, 464, 364, 248].map((d) => new Float32Array(Math.max(1, Math.round(d * s))));
    const cp = new Int32Array(8); const cs = new Float64Array(8); const ap = new Int32Array(8);
    const L = new Float32Array(n); const R = new Float32Array(n);
    for (let j = n - W; j < 2 * n; j++) {
      const v = x[j % n]; let yl = 0; let yr = 0;
      for (let k = 0; k < 8; k++) {
        const b = cb[k]; const p = cp[k]; const o = b[p];
        cs[k] = o + (cs[k] - o) * damp; b[p] = v + cs[k] * size; cp[k] = p + 1 < b.length ? p + 1 : 0;
        yl += o; yr += k & 1 ? -o : o;
      }
      for (let k = 0; k < 8; k++) {
        const b = ab[k]; const p = ap[k]; const o = b[p];
        if (k < 4) { b[p] = yl + o * 0.5; yl = o - yl; } else { b[p] = yr + o * 0.5; yr = o - yr; }
        ap[k] = p + 1 < b.length ? p + 1 : 0;
      }
      if (j >= n) { L[j - n] = yl; R[j - n] = yr; }
    }
    return [L, R];
  }

  // `voices` people talking at once, each somewhere else in the room (nearer ones a little louder and brighter), and
  // the room's echo over them all: a stereo loop of `secs` at a low `rate` (it's all under 2.5 kHz), RMS 0.1
  function murmur(ctx, secs, voices, r, rate) {
    const sr = rate; const n = Math.round(secs * sr);
    const buf = ctx.createBuffer(2, n, sr); const L = buf.getChannelData(0); const R = buf.getChannelData(1);
    for (let v = 0; v < voices; v++) {
      const near = r(); const x = talker(n, sr, r, 900 + 1300 * near);
      const a = (0.5 + 0.5 * near) / rms([x]); const p = (0.08 + 0.84 * r()) * Math.PI / 2; const gl = a * Math.cos(p); const gr = a * Math.sin(p);
      for (let i = 0; i < n; i++) { L[i] += x[i] * gl; R[i] += x[i] * gr; }
    }
    // (the low hum of their voices out: the room has its own)
    for (const c of [L, R]) biquad(c, sr, 'highpass', 150, 0.7, true);
    const mid = new Float32Array(n); for (let i = 0; i < n; i++) mid[i] = (L[i] + R[i]) / 2;
    const [wl, wr] = room(mid, sr, r); const k = rms([L, R]) / rms([wl, wr]);
    for (let i = 0; i < n; i++) { L[i] = 0.5 * L[i] + 0.85 * k * wl[i]; R[i] = 0.5 * R[i] + 0.85 * k * wr[i]; }
    scale([L, R], 0.1 / rms([L, R]));
    return buf;
  }

  // a ceramic cup struck by a spoon (or set down on its saucer): a few inharmonic partials, each beating a little as a
  // real cup's do, dying away at their own rates, and the tick of the hit
  function cup(e, t, f0, a, pan, r, saucer = false) {
    const { sr } = e;
    const parts = saucer ? [[1, 1, 0.06], [2.4, 0.5, 0.035], [4.1, 0.25, 0.02]] : [[1, 1, 0.22], [2.83, 0.4, 0.1], [5.4, 0.15, 0.05]];
    for (const [ratio, amp, tau0] of parts) {
      const f = f0 * ratio * (0.985 + 0.03 * r());
      if (f > 0.42 * sr) continue;
      const tau = tau0 * (0.8 + 0.4 * r()) * sr; const w = TAU * f / sr; const beat = TAU * (0.8 + 2.5 * r()) / sr; const ph = r() * TAU;
      // (turning pointers for the partial and its beat, and the decay as a factor: no sine or exp per sample)
      const cw = Math.cos(w); const sw = Math.sin(w); const cb = Math.cos(beat); const sb = Math.sin(beat); const d = Math.exp(-1 / tau);
      let c = Math.cos(ph); let s = Math.sin(ph); let bc = 1; let bs = 0; let env = a * amp;
      e.add(t, () => {
        const v = env * s * (0.75 + 0.25 * bc); env *= d;
        let u = c * cw - s * sw; s = s * cw + c * sw; c = u; u = bc * cb - bs * sb; bs = bs * cb + bc * sb; bc = u;
        return v;
      }, Math.round(tau * 6), pan);
    }
    const tl = Math.round(sr * 0.002);
    e.add(t, (i) => a * (saucer ? 0.5 : 0.25) * (r() * 2 - 1) * (1 - i / tl), tl, pan);
    // (and the saucer's soft knock on the table)
    if (saucer) { const tau = 0.012 * sr; const w = TAU * (150 + 60 * r()) / sr; e.add(t, (i) => a * 0.35 * Math.exp(-i / tau) * Math.sin(w * i), Math.round(tau * 6), pan); }
  }

  // The café's small sounds, each in its own stretch of a loop CLINK s long: a spoon tapped on a cup, a stir (a few
  // quick taps), a cup set on its saucer. They only sound when a gate opens on one (cafe below); returns the loop and
  // the stretches as [start, length] in seconds.
  const CLINK = 6;
  function clinkLoop(ctx, r) {
    const e = events(ctx, CLINK, 32000); const slots = []; let t = 0;
    for (const [kind, len] of [['tap', 0.8], ['stir', 1.5], ['set', 0.7], ['tap', 0.8], ['stir', 1.4], ['tap', 0.8]]) {
      const at = t + 0.03; const pan = 0.15 + 0.7 * r(); const f0 = 2100 + 1700 * r();
      if (kind === 'tap') cup(e, at, f0, 0.55 + 0.3 * r(), pan, r);
      else if (kind === 'set') { const f = 1000 + 600 * r(); cup(e, at, f, 0.5, pan, r, true); cup(e, at + 0.03 + 0.03 * r(), f * 1.02, 0.3, pan, r, true); }
      else { let s = at; for (let j = 3 + Math.floor(r() * 3); j > 0; j--) { cup(e, s, f0 * (0.99 + 0.02 * r()), 0.25 + 0.3 * r(), pan, r); s += 0.15 + 0.1 * r(); } }
      slots.push([t, len]);
      t += len;
    }
    for (let c = 0; c < 2; c++) biquad(e.buf.getChannelData(c), e.sr, 'lowpass', 9000, 0.7, true);
    // across the room: a little of its echo
    const L = e.buf.getChannelData(0); const R = e.buf.getChannelData(1);
    const mid = new Float32Array(L.length); for (let i = 0; i < L.length; i++) mid[i] = (L[i] + R[i]) / 2;
    const [wl, wr] = room(mid, e.sr, r, 0.78, 0.4); const k = 0.35 * rms([L, R]) / rms([wl, wr]);
    for (let i = 0; i < L.length; i++) { L[i] += k * wl[i]; R[i] += k * wr[i]; }
    return { buf: e.buf, slots };
  }

  // A gate over the clink loop, `cycles` of it long: open (at its own level) on `count` of the stretches in `which`,
  // at least three loops apart, shut the rest of the time. Its length is whole loops, so it stays in step with them.
  function gate(n, slots, cycles, count, which, r) {
    const x = new Float32Array(n); const per = n / cycles;
    const picks = []; const free = Array.from({ length: cycles }, (_, i) => i);
    while (picks.length < count && free.length) {
      const c = free.splice(Math.floor(r() * free.length), 1)[0];
      if (picks.every((p) => Math.min(Math.abs(p - c), cycles - Math.abs(p - c)) >= 3)) picks.push(c);
    }
    for (const c of picks) {
      const [s, len] = slots[which[Math.floor(r() * which.length)]]; const a = 0.55 + 0.45 * r();
      const i0 = Math.round(c * per + s * CR); const m = Math.round(len * CR); const up = Math.round(0.01 * CR); const down = Math.round(0.08 * CR);
      for (let i = 0; i < m; i++) x[(i0 + i) % n] = a * (i < up ? i / up : i > m - down ? (m - i) / down : 1);
    }
    return x;
  }

  // the steam wand, once in the loop: it swells in, hisses a few seconds with a little wobble, and dies away
  function steam(n, r) {
    const x = new Float32Array(n); const i0 = Math.floor(r() * n);
    const up = Math.round((0.8 + 0.6 * r()) * CR); const hold = Math.round((1.5 + 2.5 * r()) * CR); const down = Math.round((1 + 0.8 * r()) * CR);
    const wob = TAU * (0.6 + 0.8 * r()) / CR;
    for (let i = 0; i < up + hold + down; i++) {
      const e = i < up ? 0.5 - 0.5 * Math.cos(Math.PI * i / up) : i < up + hold ? 1 : 0.5 + 0.5 * Math.cos(Math.PI * (i - up - hold) / down);
      x[(i0 + i) % n] = e * (0.85 + 0.15 * Math.sin(wob * i));
    }
    return x;
  }

  /** The rate the low layers are made at. */
  const LOW = 12000;
  // Each sound: (ctx, out, r) → its sources, wired to `out`.
  const BUILD = {
    white: (ctx, out, r) => [layer(ctx, noise(ctx, 7.1, 'white', [['lowpass', 11000]], r), out).src],
    pink: (ctx, out, r) => [layer(ctx, noise(ctx, 7.3, 'pink', [['highpass', 30]], r), out).src],
    brown: (ctx, out, r) => [layer(ctx, noise(ctx, 7.7, 'brown', [['highpass', 28]], r), out).src],
    rain(ctx, out, r) {
      // a steady hiss, a soft rumble, and the drops, all a little heavier now and then
      const swell = control(ctx, 31, (n) => [wander(r, 8, n)]);
      const bed = layer(ctx, noise(ctx, 6.1, 'pink', [['highpass', 450, 0.6], ['lowpass', 8500, 0.6]], r), out, 0);
      drive(ctx, swell.ch[0], bed.g.gain, 0.8, 0.3);
      const rumble = layer(ctx, noise(ctx, 5.3, 'brown', [['highpass', 30], ['lowpass', 260]], r, LOW), out, 0.35);
      const drops = layer(ctx, rainDrops(ctx, 7.9, r), out, 0);
      drive(ctx, swell.ch[0], drops.g.gain, 0.6, 0.5);
      return [swell.src, bed.src, rumble.src, drops.src];
    },
    waves(ctx, out, r) {
      // the swell (low rumble, brighter as it rises) and the foam's hiss after it breaks
      const env = control(ctx, 47, (n) => swells(r, n, 47));
      const deep = layer(ctx, noise(ctx, 7.7, 'brown', [['highpass', 30], ['lowpass', 2500]], r, LOW), out, 0, filt(ctx, 'lowpass', 250, 0.5));
      drive(ctx, env.ch[0], deep.g.gain, 0.15, 0.85);
      drive(ctx, env.ch[0], deep.filter.frequency, 250, 1100);
      const foam = layer(ctx, noise(ctx, 6.3, 'pink', [['highpass', 700], ['lowpass', 9000]], r), out, 0);
      drive(ctx, env.ch[1], foam.g.gain, 0.03, 0.55);
      return [env.src, deep.src, foam.src];
    },
    wind(ctx, out, r) {
      // gusts: louder and higher together; a faint whistle in the strongest; a low rumble under it all
      const gust = control(ctx, 43, (n) => [wander(r, 10, n).map((v) => v ** 1.7), wander(r, 14, n).map((v) => v ** 3)]);
      const body = layer(ctx, noise(ctx, 7.9, 'pink', [['highpass', 60], ['lowpass', 5000]], r, 2 * LOW), out, 0, filt(ctx, 'bandpass', 220, 0.7));
      drive(ctx, gust.ch[0], body.g.gain, 0.3, 1.1);
      drive(ctx, gust.ch[0], body.filter.frequency, 220, 650);
      const whistle = layer(ctx, noise(ctx, 6.7, 'pink', [['lowpass', 3000]], r, LOW), out, 0, filt(ctx, 'bandpass', 650, 9));
      drive(ctx, gust.ch[1], whistle.g.gain, 0, 1);
      drive(ctx, gust.ch[1], whistle.filter.frequency, 650, 900);
      const low = layer(ctx, noise(ctx, 6.1, 'brown', [['highpass', 25], ['lowpass', 180]], r, LOW), out, 0.4);
      return [gust.src, body.src, whistle.src, low.src];
    },
    fire(ctx, out, r) {
      // a low roar that flickers, a faint hiss, and the crackles
      const flick = control(ctx, 29, (n) => [wander(r, 24, n)]);
      const roar = layer(ctx, noise(ctx, 7.1, 'brown', [['highpass', 40], ['lowpass', 450]], r, LOW), out, 0);
      drive(ctx, flick.ch[0], roar.g.gain, 0.3, 0.35);
      const hiss = layer(ctx, noise(ctx, 5.9, 'pink', [['highpass', 2000], ['lowpass', 6000]], r), out, 0.15);
      const crackle = layer(ctx, fireCrackles(ctx, 8.9, r), out, 1.4);
      return [flick.src, roar.src, hiss.src, crackle.src];
    },
    cafe(ctx, out, r) {
      // the murmur: three loops of different lengths, three or four voices each (made at 8 kHz; a low-pass takes off
      // what playing them at the context's rate adds above), swelling and ebbing a little
      const swell = control(ctx, 37.3, (n) => [wander(r, 6, n)]);
      const bus = ctx.createGain(); bus.connect(filt(ctx, 'lowpass', 2400, 0.6)).connect(out);
      drive(ctx, swell.ch[0], bus.gain, 0.88, 0.2);
      const talk = [[17.3, 3], [22.9, 4], [27.7, 4]].map(([secs, v]) => layer(ctx, murmur(ctx, secs, v, r, 8000), bus));
      // the room itself: a low hum and a little air
      const hum = layer(ctx, noise(ctx, 6.7, 'brown', [['highpass', 35], ['lowpass', 320]], r, LOW), out, 0.35);
      const air = layer(ctx, noise(ctx, 5.9, 'pink', [['highpass', 300], ['lowpass', 4000]], r, 2 * LOW), out, 0.08);
      // the clinks: two gates of 11 and 13 loops over them, each on its own stretches, so which comes when doesn't
      // repeat for 14 minutes; the second also brings the steam once round
      const ck = clinkLoop(ctx, r);
      const clinks = layer(ctx, ck.buf, out, 0);
      const g1 = control(ctx, 11 * CLINK, (n) => [gate(n, ck.slots, 11, 3, [0, 2, 4], r)]);
      const g2 = control(ctx, 13 * CLINK, (n) => [gate(n, ck.slots, 13, 3, [1, 3, 5], r), steam(n, r)]);
      drive(ctx, g1.ch[0], clinks.g.gain, 0, 0.2);
      drive(ctx, g2.ch[0], clinks.g.gain, 0, 0.2);
      const hiss = layer(ctx, noise(ctx, 4.3, 'white', [['highpass', 1800], ['lowpass', 6500]], r, 2 * LOW), out, 0);
      drive(ctx, g2.ch[1], hiss.g.gain, 0, 0.16);
      return [swell.src, g1.src, g2.src, ...talk.map((l) => l.src), hum.src, air.src, clinks.src, hiss.src];
    },
  };
  // Each sound's own gain, so that all of them are about as loud at the same volume: −21 LUFS at 100% (measured
  // offline, BS.1770 loudness), with their peaks still under full scale; the default 70% is about −27 LUFS, well
  // under music.
  const CAL = { white: 0.45, pink: 0.56, brown: 0.71, rain: 0.5, waves: 1.17, wind: 1.17, fire: 1.36, cafe: 0.385 };

  // The sound `kind` into `dest`, its sources started at `when`; returns them (to stop).
  function build(ctx, dest, kind, seed, when = 0) {
    const cal = ctx.createGain(); cal.gain.value = CAL[kind]; cal.connect(dest);
    const srcs = BUILD[kind](ctx, cal, rng(seed));
    for (const s of srcs) s.start(when);
    return srcs;
  }

  // the tests (an offline render in a page of its own) use the same code
  window.poniFocusSound = { build, kinds: Object.keys(BUILD), CAL };
})();
