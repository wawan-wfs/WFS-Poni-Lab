// Offline Indonesian and English deadline parser adapted from the Poni 1.8.1 reference.
(function () {
  const MIN = 60000;
  const W = String.raw;
  const B = W`(?<![\p{L}\p{N}'’])`; // a word starts (an apostrophe is inside one: the "at" of "Jum'at" isn't a word)
  const E = W`(?![\p{L}\p{N}'’])`; // a word ends
  const NB = W`(?<![\p{L}\p{N}.,:/])`; // a number starts (not inside 1.500, 12:30 or 8/11)
  const DATE_MASK = '\u0001';
  const TIME_MASK = '\u0002';

  const DAY_LONG = { minggu: 0, ahad: 0, senin: 1, selasa: 2, rabu: 3, kamis: 4, jumat: 5, jumaat: 5, sabtu: 6,
    sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
  const DAY_SHORT = { min: 0, sen: 1, sel: 2, rab: 3, kam: 4, jum: 5, sab: 6,
    sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6 };
  const LONG = W`minggu|ahad|senin|selasa|rabu|kamis|jum['’]?at|jumaat|sabtu|sunday|monday|tuesday|wednesday|thursday|friday|saturday`;
  const SHORT = W`min|sen|sel|rab|kam|jum|sab|sun|mon|tues?|wed|thu(?:rs?)?|fri|sat`;
  const DAY = `(?:${LONG}|${SHORT})`;
  const dayOf = (w) => { const k = w.toLowerCase().replace(/['’]/g, ''); return k in DAY_LONG ? DAY_LONG[k] : DAY_SHORT[k]; };

  const MONTHS = [['januari', 'january', 'jan'], ['februari', 'pebruari', 'february', 'feb', 'peb'], ['maret', 'march', 'mar'],
    ['april', 'apr'], ['mei', 'may'], ['juni', 'june', 'jun'], ['juli', 'july', 'jul'], ['agustus', 'august', 'agu', 'agt', 'ags', 'aug'],
    ['september', 'sept', 'sep'], ['oktober', 'october', 'okt', 'oct'], ['november', 'nopember', 'nov', 'nop'], ['desember', 'december', 'des', 'dec']];
  const MON = MONTHS.flat().sort((a, b) => b.length - a.length).join('|');
  const monthOf = (w) => MONTHS.findIndex((names) => names.includes(w.toLowerCase()));

  // parts of the day: their default time, and how they read a bare hour (clock())
  const POD = W`pagi|siang|sore|malam|morning|afternoon|evening|night`;
  const POD_ID = W`pagi|siang|sore|malam`;
  const podOf = (w) => ({ morning: 'pagi', afternoon: 'sore', evening: 'malam', night: 'malam', tonight: 'malam', tonite: 'malam' })[(w = (w || '').toLowerCase())] || w || null;
  const POD_AT = { pagi: [9, 0], siang: [12, 0], sore: [15, 0], malam: [19, 0] };

  const UNIT_M = W`m|min|mins|minutes?|mnt|menit`;
  const UNIT_H = W`h|hr|hrs|hours?|j|jam`;
  // "15m", "2 jam", "1h 30m", "1 jam 30 menit", "setengah jam", "sejam", "an hour"
  const DUR = W`(?:(\d{1,2})\s*(?:${UNIT_H})(?:\s*(\d{1,2})\s*(?:${UNIT_M}))?|(\d{1,3})\s*(?:${UNIT_M})|(setengah|half\s+an?)\s*(?:jam|hours?)|(?:se|an?|one|satu)\s*(?:jam|hours?))${E}`;
  const durMins = (m, i) => (m[i] ? +m[i] * 60 + +(m[i + 1] || 0) : m[i + 2] ? +m[i + 2] : m[i + 3] ? 30 : 60);
  const COUNT = W`(?:se|an?|one|satu|\d{1,2})`;
  const countOf = (w) => (/^\d+$/.test(w) ? +w : 1);

  const EVERY = W`(?:tiap|setiap|saban|every|each)`;
  const RANGE = W`(?:\s*(?:-|–|—|s\/d)\s*|\s+(?:sampai|sampe|hingga|to|thru|through|until|till|sd)\s+)`;
  const LIST_SEP = W`\s*(?:,|&|\/|\+)\s*(?:(?:dan|and)\s+)?|\s+(?:dan|and|&)\s+|\s+`;
  const DAY_ITEM = `${DAY}${E}(?:${RANGE}${DAY}${E})?`;
  const ONE_DAY = new RegExp(`(${DAY})${E}(?:${RANGE}(${DAY})${E})?`, 'giu'); // one item of a list, for its days
  // "daily"/"weekly" only with a time next ("standup daily 9am"; not "daily standup", "laporan weekly")
  const TIME_NEXT = W`(?=\s*(?:(?:at|jam|pukul)\s*|@\s*)?\d)`;
  // words before a number that make it a version, page, verse, price or score ("versi 2.30", "QS 2:15", "bab 3/4")
  const NUM_CTX = new RegExp(W`(?<![\p{L}])(?:versi|version|ver|v|ke|to|bab|hal|halaman|page|pg|no|nomor|nmr|pasal|ayat|surat|surah|qs|step|langkah|chapter|ch|level|lvl|kelas|rp|harga|price|vol|rating|nilai|skor|score|rate)\.?\s*$`, 'iu');
  const QUARTER = /^(00|15|30|45)$/;

  const TPRE = W`((?:at|on|pada|pd|di|by|sebelum|before)\s+|@\s*)?`; // "at 3pm", "@9.15", "pada pukul 9"
  const DPRE = W`((?:on|by|for|pada|pd|di|untuk|buat|sebelum|before|mulai|this|coming|next)\s+)?`; // "on friday", "untuk besok"
  const MER = W`(am|pm|a\.m\.|p\.m\.)`;
  const merOf = (w) => (w ? (w[0].toLowerCase() === 'p' ? 'pm' : 'am') : null);
  // words after "jam 2" that make it a count ("beli jam 2 buah", "jam 10 ribu"), or a duration ("2 jam 15 menit")
  const NOT_TIME = W`(?!\s*(?:${UNIT_M}|buah|biji|pcs|unit|kali|x|orang|lembar|bungkus|botol|kotak|pack|set|ribu|rb|k|rupiah|rp)${E})`;

  // ---- what each phrase means
  const rep = (days, pod) => ({ kind: 'rep', days: [...new Set(days)], pod: pod || null });
  const time = (h, m, mer, pod, lead0, today) => (h > 24 || m > 59 || (mer && (h < 1 || h > 12)) || (h === 24 && m) ? null
    : { kind: 'time', h, m, mer: mer || null, pod: pod || null, lead0: !!lead0, today: !!today });
  const date = (at, pod) => ({ kind: 'date', at, pod: pod || null });
  const sod = (now) => { const d = new Date(now); d.setHours(0, 0, 0, 0); return d; };
  // n days from today at h:m (h 24 = the midnight that ends that day)
  const offset = (n) => (now, h, m) => { const d = sod(now); d.setDate(d.getDate() + n); d.setHours(h, m, 0, 0); return d; };
  // the next such weekday whose h:m is still ahead (strict: not today)
  const weekday = (wd, strict) => (now, h, m) => {
    for (let i = strict ? 1 : 0; i <= 8; i++) {
      const d = sod(now); d.setDate(d.getDate() + i);
      if (d.getDay() !== wd) continue;
      d.setHours(h, m, 0, 0);
      if (d > now) return d;
    }
    return null;
  };
  // next week's Monday, plus `k` days
  const nextWeek = (k) => (now, h, m) => { const d = sod(now); d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7) + k); d.setHours(h, m, 0, 0); return d; };
  const realDay = (y, mo, d) => d >= 1 && new Date(y, mo, d).getDate() === d;
  // the next `n`th of a month (today's only while its time is ahead)
  const monthDay = (n) => (now, h, m) => {
    const t = new Date(now);
    for (let k = 0; k < 13; k++) {
      if (!realDay(t.getFullYear(), t.getMonth() + k, n)) continue;
      const d = new Date(t.getFullYear(), t.getMonth() + k, n, h, m);
      if (d > now) return d;
      if (k === 0 && n === t.getDate()) return null;
    }
    return null;
  };
  // day + month (+ year): without a year the next one, but a date in the last 60 days is a reference, not a plan
  const dayMonth = (day, mo, year) => (now, h, m) => {
    if (year) return realDay(year, mo, day) ? new Date(year, mo, day, h, m) : null;
    const y = new Date(now).getFullYear();
    if (realDay(y, mo, day)) {
      const d = new Date(y, mo, day, h, m);
      if (d > now) return d;
      if (sod(now) - new Date(y, mo, day) <= 60 * 86400000) return null;
    }
    return realDay(y + 1, mo, day) ? new Date(y + 1, mo, day, h, m) : null;
  };

  // [kind for masking, pattern, (match, working text) → meaning or null (not this one)]. Order matters:
  // repeats before days (both have weekdays), durations and times before days (short day names need a time after).
  const RULES = [
    // ---- repeats
    // "tiap senin dan kamis", "every mon, wed, fri", "tiap hari minggu", "setiap senin-jumat", "tiap minggu" (week)
    ['rep', W`${B}${EVERY}\s+(hari\s+)?(${DAY_ITEM}(?:(?:${LIST_SEP})${DAY_ITEM})*)(?:\s+(${POD})${E})?`, (m) => {
      const list = m[2];
      if (!m[1] && /^minggu$/.test(list)) return rep([null], podOf(m[3])); // lowercase "tiap minggu" = every week (today's weekday)
      const days = [];
      for (const x of list.matchAll(ONE_DAY)) {
        const a = dayOf(x[1]); const b = x[2] != null ? dayOf(x[2]) : a;
        for (let d = a; ; d = (d + 1) % 7) { days.push(d); if (d === b) break; }
      }
      return rep(days, podOf(m[3]));
    }],
    ['rep', W`${B}${EVERY}\s+(?:hari\s+kerja|weekdays?|workdays?|working\s+days?)${E}|${B}(?:on\s+)?weekdays${E}`, () => rep([1, 2, 3, 4, 5])],
    ['rep', W`${B}${EVERY}\s+(?:akhir\s+(?:pekan|minggu)|weekends?)${E}|${B}(?:on\s+)?weekends${E}`, () => rep([0, 6])],
    ['rep', W`${B}(?:${EVERY}\s+(?:hari|day)|everyday)${E}|${B}daily${E}${TIME_NEXT}`, () => rep([0, 1, 2, 3, 4, 5, 6])],
    ['rep', W`${B}(?:${EVERY}\s+(?:pekan|week)|seminggu\s+sekali|once\s+a\s+week)${E}|${B}weekly${E}${TIME_NEXT}`, () => rep([null])],
    // "tiap pagi", "every evening": every day at that part of the day
    ['rep', W`${B}${EVERY}\s+(${POD})${E}`, (m) => rep([0, 1, 2, 3, 4, 5, 6], podOf(m[1]))],
    // "senin-jumat", "mon-fri", "senin sampai jumat"
    ['rep', W`${B}(?:(?:on|pada)\s+)?(?:hari\s+)?(${DAY})(?:${RANGE})(${DAY})${E}(?:\s+(${POD})${E})?`, (m) => {
      const days = []; const b = dayOf(m[2]);
      for (let d = dayOf(m[1]); ; d = (d + 1) % 7) { days.push(d); if (d === b) break; }
      return days.length > 1 ? rep(days, podOf(m[3])) : null;
    }],

    // ---- a number of days or weeks from today: "dalam 3 hari", "2 minggu lagi", "in 2 weeks"
    ['date', W`${B}(?:dalam|in|within)\s+(${COUNT})\s*(hari|days?|minggu|pekan|weeks?)${E}|${B}(${COUNT})\s*(hari|days?|minggu|pekan|weeks?)\s+(?:lagi|from\s+now|later)${E}`, (m) => {
      const n = countOf(m[1] || m[3]); const unit = (m[2] || m[4]).toLowerCase();
      return n ? date(offset(/^(hari|days?)$/.test(unit) ? n : n * 7)) : null;
    }],
    // ---- durations: "dalam 10 menit", "in 2h", "15 menit lagi", "sejam lagi"
    ['dur', W`${B}(?:dalam|in|within)\s+${DUR}`, (m) => ({ kind: 'dur', mins: durMins(m, 1) })],
    ['dur', W`${B}${DUR}\s+(?:lagi|from\s+now|later)${E}`, (m) => ({ kind: 'dur', mins: durMins(m, 1) })],

    // ---- times
    // "jam 3", "jam 3 sore", "pukul 9.30", "jam 8 malam ini", "jam 3an" (not "2 jam 15 menit", "jam 2 buah")
    ['time', W`${B}${TPRE}(?:jam|pukul|pkl\.?|pk\.?)\s*(\d{1,2})(?:[.:](\d{2}))?(?:an)?(?:\s*${MER})?(?:\s+(${POD_ID})(\s+ini)?)?(?![\p{L}\p{N}])${NOT_TIME}`,
      (m) => time(+m[2], +(m[3] || 0), merOf(m[4]), m[5], m[2].length === 2 && m[2][0] === '0', !!m[6])],
    // "3pm", "3:30 pm", "3.30pm", "at 11 am"
    ['time', W`${NB}${TPRE}(\d{1,2})(?:[.:](\d{2}))?\s*${MER}(?![\p{L}\p{N}])`, (m) => time(+m[2], +(m[3] || 0), merOf(m[4]))],
    // "15:30", "09.00", "9:30", "@9.15", "at 7:45", "08:00 pagi". Without "at"/"@": a one-digit hour only on a
    // quarter ("versi 1.10", "Yoh 3:16" stay text), and not after a version/page/verse word.
    ['time', W`${NB}${TPRE}(\d{1,2})([.:])(\d{2})(?![\p{N}]|[.,:/]\d)(?:\s+(${POD_ID})(\s+ini)?)?${E}`, (m, w) => {
      if (!m[1] && ((m[2].length === 1 && !QUARTER.test(m[4])) || NUM_CTX.test(w.slice(0, m.index)))) return null;
      return time(+m[2], +m[4], null, m[5], m[2].length === 2 && m[2][0] === '0', !!m[6]);
    }],
    // "noon", "midnight", "tengah malam", "tengah hari"
    ['time', W`${B}${TPRE}(noon|midday|midnight|tengah\s+malam|tengah\s+hari)${E}`, (m) => (/^(noon|midday|tengah\s+hari)$/i.test(m[2]) ? time(12, 0) : time(24, 0))],
    // "at 3", "@9" — only when nothing but a day follows ("at 5 stores" stays text)
    ['time', W`${B}(at\s+|@\s*)(\d{1,2})(?:\s+(${POD_ID}))?(?=\s*(?:$|[,;.!?)](?!\d)|[\u0001\u0002]|(?:today|tomorrow|tonight|tonite|tmrw?|on|this|next|every|besok|lusa|hari|nanti|${LONG})${E}))`,
      (m) => time(+m[2], 0, null, m[3])],

    // ---- days
    // "senin minggu depan", "friday next week"
    ['date', W`${B}${DPRE}(?:hari\s+)?(${DAY})\s+(?:(?:minggu|pekan)\s+(?:depan|dpn)|next\s+week)${E}`, (m) => date(nextWeek((dayOf(m[2]) + 6) % 7))],
    // "minggu depan", "next week": its Monday
    ['date', W`${B}${DPRE}(?:(?:minggu|pekan)\s+(?:depan|dpn)|next\s+week)${E}`, () => date(nextWeek(0))],
    // "hari ini", "today", "nanti malam", "tonight", "sore ini", "this evening"
    ['date', W`${B}${DPRE}(?:(hari\s+ini|today)(?:\s+(${POD}))?|(?:nanti|ntar|ntr|entar)\s+(${POD_ID})|(${POD_ID})\s+ini|this\s+(morning|afternoon|evening)|(tonight|tonite))${E}`,
      (m) => date(offset(0), podOf(m[3] || m[4] || m[5] || m[6] || m[7]))],
    // "lusa", "day after tomorrow" (before "tomorrow", which would take the end of it)
    ['date', W`${B}${DPRE}(?:lusa|(?:the\s+)?day\s+after\s+tomorrow)(?:\s+(${POD}))?${E}`, (m) => date(offset(2), podOf(m[2]))],
    // "besok", "besok pagi", "tomorrow night"
    ['date', W`${B}${DPRE}(?:besok|bsk|esok|tomorrow|tmrw?|tomorow)(?:\s+(${POD}))?${E}`, (m) => date(offset(1), podOf(m[2]))],
    // "8 Nov", "tanggal 8 November 2026", "8th of november"
    ['date', W`${B}${DPRE}(?:(?:tanggal|tgl\.?|tg\.?)\s*)?(?:the\s+)?${NB}(\d{1,2})(?:st|nd|rd|th)?(?:\s+of)?\s+(${MON})\.?${E}(?:,?\s+(\d{4})${E})?`,
      (m) => (+m[2] >= 1 && +m[2] <= 31 ? date(dayMonth(+m[2], monthOf(m[3]), m[4] ? +m[4] : 0)) : null)],
    // "Nov 8", "november 8th, 2026"
    ['date', W`${B}${DPRE}(${MON})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?(?![\p{L}\p{N}]|[.:/]\d|\s*(?:am|pm|a\.m\.|p\.m\.)(?![\p{L}]))`,
      (m) => (+m[3] >= 1 && +m[3] <= 31 ? date(dayMonth(+m[3], monthOf(m[2]), m[4] ? +m[4] : 0)) : null)],
    // "8/11", "tgl 8/11", "8/11/2026" (day first)
    ['date', W`${B}${DPRE}((?:tanggal|tgl\.?|tg\.?)\s*)?${NB}(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?(?![\p{N}]|\/\d|[.,]\d)`, (m, w) => {
      const d = +m[3]; const mo = +m[4]; let y = m[5] ? +m[5] : 0;
      if (y && y < 100) y += 2000;
      if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
      if (!m[2] && !y) {
        // a fraction, a score or a page, not a date
        if ((d < mo && mo <= 4) || (d === 24 && mo === 7)) return null;
        if (NUM_CTX.test(w.slice(0, m.index))) return null;
        if (/^\s*(?:kg|g|gr|gram|ons|liter|ltr|l|ml|cup|cups|sdm|sdt|bagian|potong|lusin|porsi|lembar|buah|biji|%)(?![\p{L}])/iu.test(w.slice(m.index + m[0].length))) return null;
      }
      return date(dayMonth(d, mo - 1, y));
    }],
    // "tanggal 8", "tgl 8", "on the 8th": the next 8th
    ['date', W`${B}${DPRE}(?:(?:tanggal|tgl\.?|tg\.?)\s*(\d{1,2})|the\s+(\d{1,2})(?:st|nd|rd|th))${E}(?![.:/]\d)`,
      (m) => { const n = +(m[2] || m[3]); return n >= 1 && n <= 31 ? date(monthDay(n)) : null; }],
    // a list of days without "tiap"/"every" ("selasa dan jumat", "mon wed fri"): a repeat or two one-offs? unsure
    ['bad', W`${B}(?:hari\s+)?${DAY_ITEM}(?:(?:${LIST_SEP})(?:hari\s+)?${DAY_ITEM})+`, () => ({ kind: 'bad' })],
    // "malam minggu", "malam jumat": the night before that day (not "makan malam senin", dinner on Monday)
    ['date', W`${B}${DPRE}(?<!makan\s+)malam\s+(${LONG})${E}`, (m) => date(weekday((dayOf(m[2]) + 6) % 7), 'malam')],
    // "jumat", "hari senin", "next friday", "senin depan", "jumat sore"; "sen", "fri" only with context
    ['date', W`${B}${DPRE}(hari\s+)?(${DAY})${E}(?:\s+(depan|dpn|ini)${E})?(?:\s+(${POD})${E})?`, (m, w) => {
      const word = m[3]; const low = word.toLowerCase(); const pre = (m[1] || '').trim().toLowerCase();
      const before = w.slice(0, m.index); const after = w.slice(m.index + m[0].length);
      if (low === 'minggu' && !m[2]) {
        // "2 minggu", "minggu ini/lalu", "akhir minggu": the week, not Sunday
        if (m[4] && m[4].toLowerCase() === 'ini') return null;
        if (/(?:\d|\b(?:akhir|per|dalam|tiap|setiap|se))\s*$/i.test(before) || /^\s*(?:lalu|kemarin|kemaren|kmrn|yang|yg)(?![\p{L}])/iu.test(after)) return null;
      }
      if (!(low.replace(/['’]/g, '') in DAY_LONG)) {
        // a short name ("sen" is also a cent, "min" a minus) needs "hari"/"on"/"next"…, "depan" or a time right
        // after; not "RAB" (a budget plan) or "sel"/"min" with just a time ("cek sel jam 9")
        const timeAfter = /^\s*\u0002/.test(after) && word !== word.toUpperCase() && !/^(rab|sel|min)$/.test(low);
        if (/\d\s*$/.test(before)) return null; // "50 sen"
        if (!(m[2] ||/^(on|pada|pd|next|this|coming|by|sebelum|before)$/.test(pre) || /^(depan|dpn)$/i.test(m[4] || '') || timeAfter)) return null;
      }
      return date(weekday(dayOf(word), pre === 'next' || /^(depan|dpn)$/i.test(m[4] || '')), podOf(m[5]));
    }],

    // ---- a duration at the very end, as before: "Call Budi 15m", "rapat 2 jam" (not "selama 2 jam", "tiap 2 jam")
    ['dur', W`(?<![\p{L}\p{N}])(?<!(?:selama|for|durasi|during|tiap|setiap|every|each|per)\s+)${DUR}\s*[.!]?\s*$`, (m, w) => (w.slice(0, m.index).trim() ? { kind: 'dur', mins: durMins(m, 1) } : null)],
  ].map(([kind, src, fn]) => ({ kind, re: new RegExp(src, 'giu'), fn }));

  // h:m of a time, read with its own am/pm or part of the day, else the day's ("besok sore jam 4" = 16:00)
  function clock(t, dayPod) {
    const h = t.h; const m = t.m;
    if (t.mer) return [h % 12 + (t.mer === 'pm' ? 12 : 0), m];
    if (h === 0 || h > 12 || t.lead0) return [h, m];
    switch (t.pod || dayPod) {
      case 'pagi': return [h % 12, m];
      case 'siang': return [h >= 10 ? h : h + 12, m];
      case 'sore': return [h === 12 ? 12 : h + 12, m];
      case 'malam': return [h === 12 ? 24 : h >= 6 ? h + 12 : h, m];
      default: return [h <= 5 ? h + 12 : h, m];
    }
  }
  const hhmm = (h, m) => `${String(h % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

  function parse(text, now = Date.now()) {
    if (!text || !text.trim()) return null;
    let w = text;
    const found = [];
    for (const rule of RULES) {
      rule.re.lastIndex = 0;
      let m;
      while ((m = rule.re.exec(w))) {
        const v = rule.fn(m, w);
        if (!v) { rule.re.lastIndex = m.index + 1; continue; }
        const start = m.index; const end = start + m[0].length;
        found.push({ ...v, start, end });
        w = w.slice(0, start) + (rule.kind === 'time' ? TIME_MASK : DATE_MASK).repeat(end - start) + w.slice(end);
      }
    }
    if (!found.length || found.some((f) => f.kind === 'bad')) return null;
    const of = (k) => found.filter((f) => f.kind === k);
    const [reps, dates, times, durs] = ['rep', 'date', 'time', 'dur'].map(of);
    // two of a kind, or things that don't go together: unsure, so nothing
    if (reps.length > 1 || dates.length > 1 || times.length > 1 || durs.length > 1) return null;
    if (durs.length && found.length > 1) return null;
    if (reps.length && dates.length) return null;

    // the task's text without the phrases (and the commas around them)
    let rest = '';
    let at = 0;
    for (const f of [...found].sort((a, b) => a.start - b.start)) { rest += text.slice(at, f.start) + ' '; at = f.end; }
    rest = (rest + text.slice(at)).replace(/\s+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').replace(/([,;:])(?:\s*[,;:])+/g, '$1')
      .replace(/[,;:]+(?=[.!?])/g, '').replace(/^[\s,;:–—-]+|[\s,;:–—-]+$/g, '').trim();
    if (!rest) return null;
    const t = times[0];
    if (durs.length) return { text: rest, due: now + durs[0].mins * MIN, mins: durs[0].mins };
    if (reps.length) {
      const r = reps[0];
      const hm = t ? clock(t, r.pod) : POD_AT[r.pod] || [9, 0];
      const days = r.days[0] === null ? [new Date(now).getDay()] : r.days;
      return { text: rest, repeat: { days: days.sort((a, b) => a - b), time: hhmm(hm[0], hm[1]) } };
    }
    const d = dates[0];
    if (d) {
      const [h, m] = t ? clock(t, d.pod) : POD_AT[d.pod] || [9, 0];
      const due = d.at(now, h, m);
      return due && due > now ? { text: rest, due: due.getTime() } : null;
    }
    // a time alone: today, or tomorrow once it has passed ("jam 8 malam ini": today only)
    const [h, m] = clock(t, null);
    const due = new Date(now); due.setHours(h, m, 0, 0);
    if (due <= now) { if (t.today) return null; due.setDate(due.getDate() + 1); }
    return { text: rest, due: due.getTime() };
  }

  window.poniTodoLanguage = { parse };
})();
