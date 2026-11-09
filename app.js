/* Body tracker: a private cycle and symptom tracker.
   All data lives in this browser (localStorage). No accounts, no servers. */
(function () {
  'use strict';

  /* ---------- Dates ---------- */
  var DAY = 86400000;
  var MONTHS, MON_SHORT, WEEKDAYS, DOWS;
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parse(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function todayIso() { return iso(new Date()); }
  function diffDays(a, b) { return Math.round((parse(a) - parse(b)) / DAY); }
  function addDays(s, n) { var d = parse(s); d.setDate(d.getDate() + n); return iso(d); }
  function shortDate(s) { var d = parse(s); return d.getDate() + ' ' + MON_SHORT[d.getMonth()]; }
  function longToday() { var d = new Date(); return cap(WEEKDAYS[d.getDay()]) + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()]; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function uid() { return Math.random().toString(36).slice(2, 10); }

  /* ---------- Language (English or Italian) ---------- */
  var LANG_KEY = 'healthtracker.lang';
  var I18N = window.I18N || { it: {}, months: {}, monShort: {}, weekdays: {}, dows: {} };
  var lang = 'en';
  function detectLang() {
    try { var s = localStorage.getItem(LANG_KEY); if (s === 'en' || s === 'it') return s; } catch (e) { /* ignore */ }
    var n = String((navigator.languages && navigator.languages[0]) || navigator.language || 'en').toLowerCase();
    return n.indexOf('it') === 0 ? 'it' : 'en';
  }
  /* tr('English text', {name: value}) returns the text in the chosen language. Unknown text (e.g. typed by the user) is returned as is. */
  function tr(s, v) {
    var o = s;
    if (lang !== 'en' && I18N[lang] && Object.prototype.hasOwnProperty.call(I18N[lang], s)) o = I18N[lang][s];
    if (v) o = o.replace(/\{(\w+)\}/g, function (m, k) { return v[k] !== undefined ? v[k] : m; });
    return o;
  }
  /* Singular or plural form of a counted phrase: tn('{n} day', '{n} days', 3). */
  function tn(one, many, n, v) { var o = { n: n }; if (v) for (var k in v) o[k] = v[k]; return tr(n === 1 ? one : many, o); }
  function applyLang(l) {
    lang = l;
    MONTHS = I18N.months[l] || I18N.months.en; MON_SHORT = I18N.monShort[l] || I18N.monShort.en;
    WEEKDAYS = I18N.weekdays[l] || I18N.weekdays.en; DOWS = I18N.dows[l] || I18N.dows.en;
    document.documentElement.lang = l;
  }
  applyLang(detectLang());

  /* ---------- Storage ---------- */
  var KEY = 'healthtracker.v1';
  function defaultIssues() {
    return [
      { id: 'period', name: 'My period started today', sub: 'Tap once to mark today as day 1', kind: 'period', icon: 'drop', tile: 'tile-pink', pinned: true },
      { id: 'poop', name: 'Poo tracker', sub: 'Bristol scale, or note that you didn’t poo', kind: 'poop', icon: 'poop', tile: 'tile-orange', pinned: true }
    ];
  }
  /* Ready-made issues offered under "Add an issue". */
  var PRESETS = [
    { id: 'back', name: 'Lower back pain', kind: 'pain', icon: 'spine', tile: 'tile-yellow', where: ['Left', 'Right'] },
    { id: 'headache', name: 'Headache', kind: 'pain', icon: 'headache', tile: 'tile-yellow' },
    { id: 'neck', name: 'Neck pain', kind: 'pain', icon: 'neck', tile: 'tile-yellow' },
    { id: 'cramps', name: 'Period cramps', kind: 'pain', icon: 'uterus', tile: 'tile-pink', where: ['Lower belly', 'Left side', 'Right side', 'Lower back'] },
    { id: 'breast', name: 'Breast tenderness', kind: 'pain', icon: 'breast', tile: 'tile-pink', where: ['Left', 'Right', 'Both'] },
    { id: 'gut', name: 'Gut pain', sub: 'Bloating, stomach burning, nausea', kind: 'gut', icon: 'gut', tile: 'tile-lilac', symptoms: ['Bloating', 'Stomach burning', 'Nausea'] },
    { id: 'cystitis', name: 'Cystitis', kind: 'pain', icon: 'bladder', tile: 'tile-lilac' },
    { id: 'seizure', name: 'Epileptic seizure', kind: 'seizure', icon: 'pulse', tile: 'tile-green', whereLabel: 'Type', where: ['Total', 'Partial'] },
    { id: 'tiredness', name: 'Tiredness', kind: 'custom', icon: 'moon', tile: 'tile-blue' },
    { id: 'irritability', name: 'Irritability', kind: 'custom', icon: 'bolt', tile: 'tile-blue' }
  ];
  function defaultDb() {
    return { settings: { cycleLength: 28, periodLength: 5, birthControl: 'none' }, periodStarts: [], issues: defaultIssues().concat(PRESETS.map(function (c) { var x = JSON.parse(JSON.stringify(c)); x.hidden = true; return x; })), entries: [] };
  }
  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(KEY));
      if (s && s.settings && s.issues && s.entries && s.periodStarts) {
        // Keep names and subtitles of built-in issues current.
        var canon = defaultIssues().concat(PRESETS);
        s.issues.forEach(function (i) {
          canon.forEach(function (c) { if (c.id === i.id) { i.name = c.name; i.sub = c.sub; i.where = c.where ? c.where.slice() : undefined; i.whereLabel = c.whereLabel; i.kind = c.kind; i.pinned = !!c.pinned; if (c.icon) { i.icon = c.icon; i.tile = c.tile; } } });
        });
        // Older entries used a 1-5 strength; convert to the 0-10 scale.
        s.entries.forEach(function (e) { if (typeof e.strength === 'number' && e.scale !== 10) { e.strength = e.strength * 2; e.scale = 10; } });
        // Period and Poo tracker are always present and pinned.
        defaultIssues().filter(function (c) { return c.pinned; }).reverse().forEach(function (c) {
          if (!s.issues.some(function (i) { return i.id === c.id; })) s.issues.unshift(c);
        });
        // Pre-create the library so every common pain is always in the log list.
        s.issues.forEach(function (i) { if (i.hidden === undefined) i.hidden = false; });
        PRESETS.forEach(function (c) { if (!s.issues.some(function (i) { return i.id === c.id; })) { var x = JSON.parse(JSON.stringify(c)); x.hidden = true; s.issues.push(x); } });
        var rank = function (i) { var p = ['period', 'poop'].indexOf(i.id); if (i.pinned) return p === -1 ? 2 : p; var o = ['back', 'headache', 'neck', 'cramps', 'breast', 'gut', 'cystitis', 'seizure', 'tiredness', 'irritability'].indexOf(i.id); return o === -1 ? 100 : 3 + o; };
        s.issues.sort(function (a, b) { return s.customOrder && !a.pinned && !b.pinned ? 0 : rank(a) - rank(b); });
        return s;
      }
    } catch (e) { /* ignore */ }
    return defaultDb();
  }
  var db = load();
  function save() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { toast(tr('Could not save. Storage may be full or blocked.')); } }
  function issueById(id) { for (var i = 0; i < db.issues.length; i++) if (db.issues[i].id === id) return db.issues[i]; return null; }

  /* ---------- Icons ---------- */
  var ICONS = {
    drop: '<path d="M12 3c3 4 6 7 6 11a6 6 0 0 1-12 0c0-4 3-7 6-11z"/>',
    poop: '<rect x="3" y="9" width="18" height="7" rx="3.5"/>',
    cyst: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>',
    pulse: '<path d="M3 12h4l2-5 4 10 2-5h6"/>',
    bloat: '<circle cx="12" cy="12" r="9"/><path d="M8 13c1.3-1.3 2.7 1.3 4 0s2.7 1.3 4 0"/>',
    heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
    bolt: '<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>',
    moon: '<path d="M20 14A8 8 0 1 1 10 4a6 6 0 0 0 10 10z"/>',
    sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.500M12 7.800h.01"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    chevR: '<path d="M9 5l7 7-7 7"/>',
    minus: '<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>',
    grip: '<g fill="currentColor" stroke="none"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></g>',
    leaf: '<path d="M5 19c0-9 5-14 14-14 0 9-5 14-14 14zM5 19l8-8"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
    trend: '<path d="M3 17l6-6 4 4 8-8"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    head: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    ear: '<path d="M7 10a5 5 0 0 1 10 0c0 3-3 3-3 6a2.5 2.5 0 0 1-5 0"/><path d="M12 10a2 2 0 0 1 2 2"/>',
    tooth: '<path d="M7 3c-2 0-3 2-3 4 0 3 2 4 2 7 0 3 1 7 3 7 2 0 1-4 3-4s1 4 3 4c2 0 3-4 3-7 0-3 2-4 2-7 0-2-1-4-3-4-2 0-3 1-5 1S9 3 7 3z"/>',
    lungs: '<path d="M12 4v8M10 9C6 9 4 14 4 18c0 1.5 1.5 2 3 1.5L10 18zM14 9c4 0 6 5 6 9 0 1.5-1.5 2-3 1.5L14 18z"/>',
    stomach: '<path d="M9 3v4c-3 2-4 5-4 8a5 5 0 0 0 10 0c0-2-2-3-4-3-1 0-2-1-2-3V3"/>',
    bone: '<path d="M8 16L16 8"/><circle cx="6" cy="16" r="2"/><circle cx="8" cy="18" r="2"/><circle cx="16" cy="6" r="2"/><circle cx="18" cy="8" r="2"/>',
    womb: '<path d="M12 21v-5M8 4c-3 0-4 3-4 5s2 3 4 3M16 4c3 0 4 3 4 5s-2 3-4 3M8 12c0 3 1.5 4 4 4s4-1 4-4"/>',
    spine: '<rect x="6.5" y="1.8" width="8" height="3.6" rx="1.8" fill="currentColor" fill-opacity=".22"/><rect x="6.5" y="6.3" width="8" height="3.6" rx="1.8" fill="currentColor" fill-opacity=".22"/><rect x="6.5" y="10.8" width="8" height="3.6" rx="1.8" fill="currentColor" fill-opacity=".22"/><rect x="6.5" y="15.3" width="8" height="3.6" rx="1.8" fill="currentColor" fill-opacity=".22"/><path d="M14.5 3.6h3.5M14.5 8.1h3.5M14.5 12.6h3.5M14.5 17.1h3.5"/><path d="M8 20.2h5l-2.5 3z" fill="currentColor" fill-opacity=".22"/>',
    headache: '<path d="M7 21.5v-4.3C4.8 15.8 3.5 13.6 3.5 10.8A8 8 0 0 1 12 3a8 8 0 0 1 8 7.8c0 1 .5 1.7 1.2 2.7l-1.7 1v2.8l-2.5.5v3.7z" fill="currentColor" fill-opacity=".22"/><path d="M12.8 6.3L9.3 11.3h3.4l-2.5 4.9"/>',
    neck: '<circle cx="12" cy="5.2" r="2.8" fill="currentColor" fill-opacity=".22"/><rect x="10.3" y="8.2" width="3.4" height="6.2" rx=".8" fill="currentColor" fill-opacity=".22"/><path d="M10.6 10.3h2.8M10.6 12.3h2.8"/><path d="M3 21c0-3.600 2.800-5.600 7.300-6.300h3.400c4.500.7 7.300 2.700 7.300 6.300z" fill="currentColor" fill-opacity=".22"/>',
    uterus: '<path d="M12 3.500c-2.800 0-4.200 1.800-4.200 4 0 2.800 1.800 4.200 1.800 6.700h4.800c0-2.500 1.800-3.900 1.800-6.700 0-2.200-1.400-4-4.200-4z" fill="currentColor" fill-opacity=".22"/><path d="M12 14.200V21M7.900 7.200C5.400 6.700 3.800 8.200 3.800 10.400M16.100 7.200c2.500-.5 4.100 1 4.100 3.200"/><circle cx="3.800" cy="12.700" r="2" fill="currentColor" fill-opacity=".22"/><circle cx="20.200" cy="12.700" r="2" fill="currentColor" fill-opacity=".22"/>',
    breast: '<path d="M4 11.500C4 7 7.600 4.500 12 4.500s8 2.500 8 7c0 4.500-3.500 8-8 8s-8-3.500-8-8z" fill="currentColor" fill-opacity=".22"/><circle cx="12" cy="12" r="3.200" fill="currentColor" fill-opacity=".22"/><circle cx="12" cy="12" r="1" fill="currentColor"/><path d="M3.200 3.800L4.800 5.400M20.800 3.800L19.200 5.400M12 1.500v1.800"/>',
    gut: '<defs><mask id="gutm"><rect width="24" height="24" fill="#fff"/><path d="M7 3.8h10a3.2 3.2 0 0 1 0 6.4H7a3.2 3.2 0 0 0 0 6.4h8a1.9 1.9 0 0 1 0 3.8h-3" fill="none" stroke="#000" stroke-width="1.8"/></mask></defs><path d="M7 3.8h10a3.2 3.2 0 0 1 0 6.4H7a3.2 3.2 0 0 0 0 6.4h8a1.9 1.9 0 0 1 0 3.8h-3" fill="none" stroke-width="4" mask="url(#gutm)"/><path d="M7 3.8h10a3.2 3.2 0 0 1 0 6.4H7a3.2 3.2 0 0 0 0 6.4h8a1.9 1.9 0 0 1 0 3.8h-3" fill="none" stroke-width="1.8" stroke-opacity=".22"/>',
    bladder: '<path d="M12 2.500V6M7.500 9C7.500 7 9.300 6 12 6s4.500 1 4.500 3c0 4.500-1 8.500-2 11.500h-5c-1-3-2-7-2-11.500z" fill="currentColor" fill-opacity=".22"/><path d="M9.500 12.500c1-1 2 1 3 0s2 1 2.500 0M7.800 7.800L4.800 4.500M16.200 7.800l3-3.300"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'
  };
  var FINE = ['spine', 'headache', 'neck', 'uterus', 'breast', 'gut', 'bladder'];
  function icon(name) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (FINE.indexOf(name) !== -1 ? '1.5' : '2') + '"' + (FINE.indexOf(name) !== -1 ? ' class="fine"' : '') + ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || ICONS.pulse) + '</svg>'; }

  /* ---------- Cycle maths ---------- */
  var PHASES = {
    period: { label: 'Period', color: 'var(--period)', hex: '#8B3A5A' },
    follicular: { label: 'Follicular', color: 'var(--follicular)', hex: '#3F7A63' },
    ovulation: { label: 'Ovulation', color: 'var(--ovulation)', hex: '#B8862F' },
    luteal: { label: 'Luteal', color: 'var(--luteal)', hex: '#4B4BA0' }
  };
  function pl(k) { return tr(PHASES[k].label); }
  function pt(k) { return tr(PHASES[k].label + ' phase'); }
  function iname(i) { return tr(i.name); }
  function strengthWord(v) { return v === 0 ? tr('None') : v <= 3 ? tr('Mild') : v <= 6 ? tr('Medium') : tr('Strong'); }
  function phaseLayout() {
    var cl = db.settings.cycleLength, pl = Math.min(db.settings.periodLength, cl - 8);
    var ov = cl - 14;
    var ovStart = Math.max(pl + 1, ov - 1), ovEnd = Math.min(cl - 1, ov + 1);
    return [
      { key: 'period', from: 1, to: pl },
      { key: 'follicular', from: pl + 1, to: ovStart - 1 },
      { key: 'ovulation', from: ovStart, to: ovEnd },
      { key: 'luteal', from: ovEnd + 1, to: cl }
    ].filter(function (p) { return p.to >= p.from; });
  }
  function phaseOfDay(day) {
    var L = phaseLayout();
    for (var i = 0; i < L.length; i++) if (day >= L[i].from && day <= L[i].to) return L[i].key;
    return 'luteal';
  }
  function lastStartOnOrBefore(d) {
    var best = null;
    db.periodStarts.forEach(function (s) { if (s <= d && (!best || s > best)) best = s; });
    return best;
  }
  function cycleInfo(dateIso) {
    var st = lastStartOnOrBefore(dateIso);
    if (!st) return null;
    var cl = db.settings.cycleLength;
    var raw = diffDays(dateIso, st) + 1;
    var late = raw > cl;
    var day = late ? cl : raw;
    return { start: st, rawDay: raw, day: day, late: late, phase: late ? 'luteal' : phaseOfDay(day), toPeriod: cl - raw + 1, cl: cl };
  }
  function isHormonal() { return ['combined', 'progestin', 'patch', 'hiud', 'implant', 'injection'].indexOf(db.settings.birthControl) !== -1; }

  var PHASE_TEXT = {
    period: {
      likely: 'Hormone levels are at their lowest and the lining of the womb is shedding. Cramps, tiredness and a dip in energy are common.',
      notice: ['Cramps', 'Lower back ache', 'Tiredness', 'Headache', 'Heavier flow', 'Low mood'],
      know: [
        ['Body', ['The length, heaviness and pain of your period can reflect how the past month went', 'Very painful, heavy or missing periods are worth talking to a doctor about']],
        ['Eat', ['Iron-rich foods: lentils, red meat, dark leafy greens', 'Anti-inflammatory foods may help']],
        ['Sleep', ['Lie down and rest instead of pushing through']],
        ['Mind', ['Good for planning and reflecting: lists, big-picture thinking', 'Do not force social events or presentations']]
      ],
      todo: [
        ['Eat', 'Iron-rich foods like lentils, eggs and leafy greens, with something vitamin C-rich alongside to help absorption.'],
        ['Move', 'Gentle walks or stretching. Heat on your belly or back can ease cramps.'],
        ['Sleep', 'You may need a little more rest. An earlier night can help.'],
        ['Mind', 'Be kind to yourself. It is fine to say no to extras.'],
        ['Plan', 'Keep the first couple of days light if you can.']
      ]
    },
    follicular: {
      likely: 'Oestrogen is rising. Energy, focus and mood often pick up, and skin tends to feel calmer.',
      notice: ['Rising energy', 'Clearer head', 'Better mood', 'Feeling social'],
      know: [
        ['Eat', ['Iron-rich foods to replace what you lost: lentils, red meat, dark leafy greens']],
        ['Move', ['Good time for harder workouts']],
        ['Mind', ['Motivation and clarity tend to rise', 'Good for demanding projects, social plans and learning something new', 'Brainstorming and drafting feel easier']]
      ],
      todo: [
        ['Eat', 'Fresh, lighter meals with plenty of vegetables, plus protein to rebuild after your period.'],
        ['Move', 'A good time to try something new or push a little harder.'],
        ['Sleep', 'Sleep is often deeper now. Keep a steady bedtime.'],
        ['Mind', 'Good days for learning, starting things and making plans.'],
        ['Plan', 'Schedule the demanding or social things here.']
      ]
    },
    ovulation: {
      likely: 'Oestrogen peaks and an egg is released. Many people feel energetic and social. Some notice a one-sided twinge or more discharge.',
      notice: ['High energy', 'One-sided twinge', 'More discharge', 'Higher libido'],
      know: [
        ['Move', ['Intense workouts often feel good']],
        ['Mind', ['Energy and confidence often peak', 'Good for presentations and negotiations', 'Watch for impulsive spending, snacking or decisions', 'Save pitches and social plans for now, not lonely, dull work']]
      ],
      todo: [
        ['Eat', 'Fibre, fruit and veg, and plenty of water.'],
        ['Move', 'Strong, energetic workouts often feel good. Warm up well.'],
        ['Sleep', 'Sleep can be a little lighter. Keep evenings calm.'],
        ['Mind', 'Confidence is often high, so good timing for important conversations.'],
        ['Plan', 'Make the most of the extra energy.']
      ]
    },
    luteal: {
      likely: 'Progesterone is high, then starts to fall. Energy and mood can dip, sleep gets lighter, and bloating or sore breasts are common.',
      notice: ['Bloating', 'Sore breasts', 'Cravings', 'Lighter sleep', 'Low energy', 'Irritability'],
      know: [
        ['Body', ['Early: progesterone rises, so you feel warmer, sleepier and hungrier', 'Digestion slows, so bloating and constipation are common', 'Late: hormones drop before your period, which can feel turbulent', 'You burn a bit more energy and blood sugar is touchier', 'Cardio feels harder than usual', 'Stress tolerance may be lower', 'Low progesterone, often from stress or undereating, can bring anxiety or irritability']],
        ['Eat', ['Warm meals with slow carbs (sweet potato, oats)', 'Add protein and magnesium-rich foods', 'Pair carbs with protein or fat', 'Eat every 3 to 4 hours, do not skip meals', 'Less caffeine late in the phase if PMS is strong', 'Cut back on alcohol and ultra-processed food, which can worsen PMS', 'Protein- and fibre-rich snacks steady blood sugar', 'Healthy fats (seeds, avocado, olive oil) support hormones']],
        ['Move', ['Steady cardio instead of HIIT', 'Moderate weights, more reps', 'Take an extra rest day if you need it']],
        ['Sleep', ['Earlier bedtime, a calm wind-down', 'You may need more sleep, and that is normal', 'Aim for 7 to 9 hours']],
        ['Mind', ['Feeling more sensitive or less social is common', 'Strong feelings are not always "just hormones"', 'Ask what the feeling is telling you', 'Good time to notice what drains you and set boundaries', 'Journal instead of pushing the feeling away', 'Stress and poor sleep hit harder now, so rest more and say no more often', 'Cut back on social commitments', 'Delay big decisions if emotions run high']],
        ['Plan', ['Finish demanding tasks early', 'Tidy up and prepare for your period', 'Organise your home and routines', 'Keep the first days of your period light']]
      ],
      todo: [
        ['Eat', 'Eat regularly, pairing carbs with protein or fat. Add fibre and magnesium-rich foods like greens, nuts and seeds, and go easy on salt if you bloat.'],
        ['Move', 'Keep it gentle: walks, yoga, lighter strength sessions. Steady cardio and moderate weights suit better than HIIT. Hard cardio can feel tougher now.'],
        ['Sleep', 'Keep a steady bedtime and a cool room. Sleep can get lighter before your period.'],
        ['Mind', 'Mood can dip, so go easy on yourself and avoid stacking demanding plans.'],
        ['Plan', 'Finish demanding tasks early and keep the first two days of your period light if you can.']
      ]
    }
  };

  /* ---------- Entries ---------- */
  function entryDays(e, limitIso) {
    var out = [], t = limitIso || todayIso();
    var end = e.end || t;
    if (end > t) end = t;
    var d = e.start, n = 0;
    while (d <= end && n < 400) { out.push(d); d = addDays(d, 1); n++; }
    return out;
  }
  function dayLevels(onlyIssueId) {
    var map = {};
    db.entries.forEach(function (e) {
      if (onlyIssueId && e.issueId !== onlyIssueId) return;
      entryDays(e).forEach(function (d) { if (!map[d] || map[d] < e.level) map[d] = e.level; });
    });
    return map;
  }
  function firstDataDate() {
    var first = null;
    db.entries.forEach(function (e) { if (!first || e.start < first) first = e.start; });
    db.periodStarts.forEach(function (s) { if (!first || s < first) first = s; });
    return first;
  }
  function lastLoggedText(issueId) {
    var last = null;
    db.entries.forEach(function (e) { if (e.issueId === issueId) { var d = e.end || todayIso(); if (!last || d > last) last = d; } });
    if (!last) return tr('Not logged yet');
    var n = diffDays(todayIso(), last);
    return n <= 0 ? tr('Last logged today') : n === 1 ? tr('Last logged yesterday') : tr('Last logged {n} days ago', { n: n });
  }
  function levelFor(issue, draft) {
    if (issue.kind === 'bloat') return draft.bloat || 2;
    if (issue.kind === 'poop') return draft.noPoo ? 2 : { 1: 3, 2: 2, 3: 1, 4: 1, 5: 2, 6: 3, 7: 3 }[draft.bristol] || 1;
    var s = typeof draft.strength === 'number' ? draft.strength : 5;
    return s <= 3 ? 1 : s <= 6 ? 2 : 3;
  }

  /* ---------- UI state ---------- */
  var ui = { view: 'today', patMonth: null, patIssue: null, patCycle: true, eatMonth: null, draft: null };
  var app = document.getElementById('app');

  function go(view, extra) {
    if (view === 'settings') ui.bcOpen = false;
    if (view === 'eat') ui.eatMore = false;
    if (view !== ui.view) { ui.dayPick = null; ui.reorder = false; }
    ui.view = view;
    if (extra) for (var k in extra) ui[k] = extra[k];
    render();
    window.scrollTo(0, 0);
  }

  var toastTimer = null, toastUndo = null;
  function toast(msg, undoFn) {
    var el = document.getElementById('toast');
    toastUndo = undoFn || null;
    el.innerHTML = '<span>' + esc(msg) + '</span>' + (undoFn ? '<button data-act="undo">' + tr('Undo') + '</button>' : '');
    el.className = 'show';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = ''; }, 4500);
  }

  /* ---------- Views ---------- */
  function navBar(active) {
    function tab(v, ic, label) {
      return '<button class="' + (active === v ? 'on' : '') + '" data-act="go" data-v="' + v + '"' + (active === v ? ' aria-current="page"' : '') + '>' + icon(ic) + '<span>' + tr(label) + '</span></button>';
    }
    return '<nav class="nav" aria-label="' + tr('Main') + '">' +
      tab('today', 'target', 'Today') + tab('eat', 'leaf', 'Eat') +
      '<button class="fab" data-act="go" data-v="log" aria-label="' + tr('Log something') + '">' + icon('plus') + '</button>' +
      tab('patterns', 'trend', 'Patterns') + tab('settings', 'sliders', 'Settings') +
      '</nav>';
  }

  function arc(cx, cy, r, a0, a1) {
    function p(a) { var t = (a - 90) * Math.PI / 180; return [cx + r * Math.cos(t), cy + r * Math.sin(t)]; }
    var s = p(a0), e = p(a1), large = (a1 - a0) > 180 ? 1 : 0;
    return 'M' + s[0].toFixed(2) + ' ' + s[1].toFixed(2) + ' A' + r + ' ' + r + ' 0 ' + large + ' 1 ' + e[0].toFixed(2) + ' ' + e[1].toFixed(2);
  }
  function donut(info) {
    var cl = info.cl, per = 360 / cl, gap = 3, parts = '';
    phaseLayout().forEach(function (ph) {
      var a0 = (ph.from - 1) * per + gap / 2, a1 = ph.to * per - gap / 2;
      parts += '<path d="' + arc(150, 150, 108, a0, a1) + '" stroke="' + PHASES[ph.key].hex + '" stroke-width="30" fill="none"/>';
    });
    var ma = (info.day - 0.5) * per, t = (ma - 90) * Math.PI / 180;
    var mx = 150 + 108 * Math.cos(t), my = 150 + 108 * Math.sin(t);
    return '<svg class="donut" viewBox="0 0 300 300" role="img" aria-label="' + tr('Cycle day {d} of about {cl}', { d: info.rawDay, cl: cl }) + '">' + parts +
      '<circle cx="' + mx.toFixed(1) + '" cy="' + my.toFixed(1) + '" r="13" fill="#fff" stroke="' + PHASES[info.phase].hex + '" stroke-width="3"/>' +
      '<text x="150" y="152" text-anchor="middle" font-size="44" font-weight="700" fill="#2A2433">' + tr('Day {n}', { n: info.rawDay }) + '</text>' +
      '<text x="150" y="182" text-anchor="middle" font-size="16" fill="#5F5868">' + tr('of about {n}', { n: cl }) + '</text></svg>';
  }

  /* ---------- Moon ring and hormone chart ---------- */
  function moonPath(cx, cy, r, k, waning) {
    if (k <= 0.02) return '';
    if (k >= 0.98) return 'M' + (cx - r) + ' ' + cy + 'A' + r + ' ' + r + ' 0 1 1 ' + (cx + r) + ' ' + cy + 'A' + r + ' ' + r + ' 0 1 1 ' + (cx - r) + ' ' + cy + 'Z';
    var rx = Math.abs(1 - 2 * k) * r, top = cy - r, bot = cy + r, s = waning ? -1 : 1;
    var x = cx;
    // lit side is right (waxing) or left (waning)
    var outer = 'M' + x + ' ' + top + 'A' + r + ' ' + r + ' 0 0 ' + (waning ? 0 : 1) + ' ' + x + ' ' + bot;
    var sweep = k < 0.5 ? (waning ? 1 : 0) : (waning ? 0 : 1);
    return outer + 'A' + rx.toFixed(2) + ' ' + r + ' 0 0 ' + sweep + ' ' + x + ' ' + top + 'Z';
  }
  function moonRing(info, whenShort, compact) {
    var cl = info.cl, R = 140, C = 170, mr = Math.min(13.5, 0.4 * 2 * Math.PI * R / cl), parts = '';
    var pick = compact && ui.dayPick && ui.dayPick !== info.day ? ui.dayPick : null;
    for (var d = 1; d <= cl; d++) {
      var a = (d - 0.5) / cl * 2 * Math.PI - Math.PI / 2, cx = C + R * Math.cos(a), cy = C + R * Math.sin(a);
      var f = (d - 0.5) / cl, k = (1 - Math.cos(f * 2 * Math.PI)) / 2, waning = f > 0.5;
      var col = PHASES[phaseOfDay(d)].hex;
      if (compact) parts += '<g data-act="moonDay" data-d="' + d + '" style="cursor:pointer" role="button" aria-label="' + tr('Cycle day {n}', { n: d }) + '">';
      parts += '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="' + mr.toFixed(1) + '" fill="#FBF3EA" stroke="' + col + '" stroke-width="2"/>';
      var p = moonPath(0, 0, mr - 1, k, waning);
      if (p) parts += '<path transform="translate(' + cx.toFixed(1) + ' ' + cy.toFixed(1) + ')" d="' + p + '" fill="' + col + '"/>';
      if (d === info.day) parts += '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="' + (mr + 6).toFixed(1) + '" fill="none" stroke="#2A2433" stroke-width="' + (pick ? 1.5 : 3) + '"' + (pick ? ' stroke-dasharray="3 3"' : '') + '/>';
      if (d === pick) parts += '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="' + (mr + 6).toFixed(1) + '" fill="none" stroke="#2A2433" stroke-width="3"/>';
      if (compact) parts += '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="' + (mr + 6).toFixed(1) + '" fill="transparent"/></g>';
    }
    var ph = PHASES[info.phase];
    if (compact) return '<svg class="donut" viewBox="0 0 340 340" role="img" aria-label="' + tr('Cycle day {d} of about {cl}, {phase}', { d: info.rawDay, cl: cl, phase: pt(info.phase) }) + '">' + parts +
      '<text x="170" y="150" text-anchor="middle" font-size="26" font-weight="500" fill="#2A2433" pointer-events="none">' + tr('Day') + '</text>' +
      '<text x="170" y="214" text-anchor="middle" font-size="76" font-weight="700" fill="#2A2433" pointer-events="none">' + (pick || info.rawDay) + '</text></svg>';
    return '<svg class="donut" viewBox="0 0 340 340" role="img" aria-label="' + tr('Cycle day {d} of about {cl}, {phase}', { d: info.rawDay, cl: cl, phase: pt(info.phase) }) + '">' + parts +
      '<text x="170" y="138" text-anchor="middle" font-size="15" font-weight="700" letter-spacing="2" fill="' + ph.hex + '">' + pt(info.phase).toUpperCase() + '</text>' +
      '<text x="170" y="192" text-anchor="middle" font-size="56" font-weight="700" fill="#2A2433">' + tr('Day {n}', { n: info.rawDay }) + '</text>' +
      '<text x="170" y="224" text-anchor="middle" font-size="16" fill="#2A2433">' + esc(whenShort) + '</text></svg>';
  }
  function gauss(t, mu, sl, sr) { var s = t < mu ? sl : sr, z = (t - mu) / s; return Math.exp(-z * z / 2); }
  var HORMONES = [
    { key: 'Estrogen', hex: '#E4572E', area: true, f: function (t, od) { return 0.1 + 0.9 * gauss(t, od - 1, 4.4, 2) + 0.5 * gauss(t, od + 7, 3.6, 3.6); } },
    { key: 'Progesterone', hex: '#D6479B', area: true, f: function (t, od) { return 0.03 + 0.85 * gauss(t, od + 7, 3.4, 3.6); } },
    { key: 'Testosterone', hex: '#5F6B7A', area: false, f: function (t, od) { return 0.2 + 0.14 * gauss(t, od, 3, 3); } },
    { key: 'LH', hex: '#1EA3C2', area: true, f: function (t, od) { return 0.04 + 0.96 * gauss(t, od - 0.5, 0.9, 0.9); } }
  ];
  function hormoneNote(info) {
    var od = info.cl - 14, d = info.rawDay;
    if (info.late) return 'Your period is a little late, so hormone levels are likely still low and about to turn over.';
    if (info.phase === 'period') return 'Both main hormones are at their lowest, which is why energy can dip.';
    if (info.phase === 'follicular') return 'Estrogen is climbing, which often brings more energy and a clearer head.';
    if (info.phase === 'ovulation') return 'Estrogen peaks and LH spikes briefly, which triggers ovulation.';
    return d <= od + 8 ? 'Progesterone is rising and high, which can make you warmer, sleepier and hungrier.' : 'Both main hormones are falling before your period.';
  }
  function hormoneCard(info) {
    var cl = info.cl, od = cl - 14, W = 340, H = 92, x0 = 4, x1 = W - 4, yb = 76, yt = 10;
    function X(t) { return x0 + (t - 1) / (cl - 1) * (x1 - x0); }
    function Y(v) { return yb - v * (yb - yt); }
    var svg = '', i, t, pts, dpath;
    var sel = ui.hSel || null;
    var ordered = HORMONES.slice().sort(function (a, b) { return (a.key === sel) - (b.key === sel); });
    ordered.forEach(function (hm) {
      var line = '', dim = sel && sel !== hm.key, on = sel === hm.key;
      for (t = 1, i = 0; t <= cl + 0.001; t += 0.25, i++) line += (i ? 'L' : 'M') + X(t).toFixed(1) + ' ' + Y(hm.f(t, od)).toFixed(1);
      if (hm.area) svg += '<path d="' + line + 'L' + X(cl).toFixed(1) + ' ' + yb + 'L' + X(1).toFixed(1) + ' ' + yb + 'Z" fill="' + hm.hex + '" opacity="' + (dim ? 0.03 : on ? 0.28 : 0.14) + '"/>';
      svg += '<path d="' + line + '" fill="none" stroke="' + hm.hex + '" stroke-width="' + (on ? 3.5 : 2.5) + '" stroke-linejoin="round" opacity="' + (dim ? 0.18 : 1) + '"/>';
    });
    var mx = X(Math.min(info.day, cl)).toFixed(1);
    svg += '<line x1="' + mx + '" y1="' + (yt - 2) + '" x2="' + mx + '" y2="' + yb + '" stroke="#2A2433" stroke-width="2"/><circle cx="' + mx + '" cy="' + (yt - 2) + '" r="5" fill="#2A2433"/>';
    var bars = phaseLayout().map(function (p) {
      var a = X(p.from - 0.5 < 1 ? 1 : p.from - 0.5), b = X(p.to + 0.5 > cl ? cl : p.to + 0.5);
      return '<rect x="' + (a + 1).toFixed(1) + '" y="' + (yb + 6) + '" width="' + Math.max(2, b - a - 2).toFixed(1) + '" height="7" rx="3.5" fill="' + PHASES[p.key].hex + '"/><text x="' + ((a + b) / 2).toFixed(1) + '" y="' + (yb + 24) + '" text-anchor="middle" font-size="9.5" font-weight="700" fill="#6B6573">' + pl(p.key) + '</text>';
    }).join('');
    var legend = HORMONES.map(function (hm) { return '<button class="hleg' + (sel === hm.key ? ' on' : sel ? ' off' : '') + '" data-act="hormone" data-k="' + hm.key + '" aria-pressed="' + (sel === hm.key) + '"><i style="background:' + hm.hex + '"></i>' + tr(hm.key) + '</button>'; }).join('');
    return '<section class="card hpage"><div class="legend">' + legend + '</div>' +
      '<svg viewBox="0 0 ' + W + ' ' + (H + 22) + '" class="hchart" data-act="chart" role="img" aria-label="' + tr('Typical hormone levels across your cycle') + '">' + svg + bars + '</svg>' +
      hormoneDesc(info) +
      '</section>';
  }

  var HORMONE_INFO = [
    ['Estrogen', '#E4572E', 'The main growth hormone of the cycle. It builds up the womb lining, helps an egg mature, and supports bone strength, skin, and mood-lifting brain chemicals like serotonin. It is also why many people feel brighter and more social when it is high.'],
    ['Progesterone', '#D6479B', 'The calming, protective hormone. It prepares and holds the womb lining in place in case of pregnancy, and it raises body temperature slightly. It also acts on the brain in a sedating way, which is why it can bring sleepiness, a bigger appetite, bloating and sore breasts.'],
    ['Testosterone', '#5F6B7A', 'Yes, you make it too, in smaller amounts. It supports sex drive, muscle and bone, and motivation and energy. It is fairly steady through the cycle, with a small lift around ovulation.'],
    ['LH', '#1EA3C2', 'Short for luteinizing hormone. It is the trigger that makes the ovary release a mature egg, which is ovulation. After that it helps the empty follicle turn into the structure that makes progesterone.']
  ];
  function highestText(hm, info) {
    var cl = info.cl, od = cl - 14, vals = [], t;
    for (t = 1; t <= cl; t++) vals.push(hm.f(t, od));
    var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
    var hit = phaseLayout().filter(function (p) {
      var pk = 0; for (var d = p.from; d <= p.to; d++) pk = Math.max(pk, hm.f(d, od));
      return (pk - mn) / (mx - mn) >= 0.85;
    });
    if (!hit.length) return '';
    var from = hit[0].from, to = hit[hit.length - 1].to;
    return tr(hit.length > 1 ? 'Highest in the {phases} phases, around days {a} to {b}.' : 'Highest in the {phases} phase, around days {a} to {b}.', { phases: hit.map(function (p) { return pl(p.key).toLowerCase(); }).join(tr(' and ')), a: from, b: to });
  }
  function hormoneDesc(info) {
    var sel = ui.hSel, r = HORMONE_INFO.filter(function (x) { return x[0] === sel; })[0], hm = HORMONES.filter(function (x) { return x.key === sel; })[0];
    if (!r || !hm) return '<p class="hhint">' + tr('Tap a hormone, or a line on the chart, to see what it does.') + '</p>';
    return '<div class="hdesc" style="border-left-color:' + r[1] + '"><b style="color:' + r[1] + '">' + esc(tr(r[0])) + '</b><p>' + esc(tr(r[2])) + '</p><p class="hhigh">' + esc(highestText(hm, info)) + '</p></div>';
  }
  function viewHormones() {
    var info = cycleInfo(todayIso());
    var h = banner('Learn', 'Your hormones', 'today');
    if (!info) return h + '<p class="sub">' + tr('Add your last period start on the Today screen to see your hormone chart.') + '</p>' + navBar('today');
    h += '<p class="sub">' + tr('A typical pattern across a {n}-day cycle. The black line shows where you are today. Everyone is different, so treat it as a guide.', { n: info.cl }) + '</p>';
    h += hormoneCard(info);
    return h + navBar('today');
  }
  function hasGroups(T, body) { return !!T.know && T.know.some(function (g) { return (g[0] === 'Body') === body; }); }
  function phaseTxt(info) {
    if (ui.dayPick && ui.dayPick !== info.day) return dayDetails(info, ui.dayPick);
    var ph = PHASES[info.phase];
    var whenShort = info.late ? tr('Period may be late') : info.phase === 'period' ? tr('Period day {n} of about {m}', { n: info.rawDay, m: db.settings.periodLength }) : tn('Period in about {n} day', 'Period in about {n} days', info.toPeriod);
    return '<span class="plabel" style="color:' + ph.hex + '">' + pt(info.phase) + '</span><span class="pwhen">' + esc(whenShort) + '</span>';
  }
  /* Drag around the moon ring to scrub through the cycle days. Updates in place so the dragged element survives. */
  var scrub = null, suppressClick = false;
  function scrubTo(svg, ev) {
    var info = cycleInfo(todayIso()); if (!info) return;
    var r = svg.getBoundingClientRect(), dx = ev.clientX - (r.left + r.width / 2), dy = ev.clientY - (r.top + r.height / 2);
    var ang = Math.atan2(dy, dx) + Math.PI / 2; if (ang < 0) ang += 2 * Math.PI;
    var d = Math.min(info.cl, Math.floor(ang / (2 * Math.PI) * info.cl) + 1);
    var want = d === info.day ? null : d;
    if (want === (ui.dayPick || null)) return;
    ui.dayPick = want;
    var tmp = document.createElement('div'); tmp.innerHTML = moonRing(info, '', true);
    svg.innerHTML = tmp.firstChild.innerHTML;
    var txt = document.querySelector('.phase-txt'); if (txt) txt.innerHTML = phaseTxt(info);
  }
  document.addEventListener('pointerdown', function (ev) {
    var svg = ev.target.closest && ev.target.closest('.ring svg.donut');
    if (!svg) return;
    scrub = { svg: svg, x: ev.clientX, y: ev.clientY, moved: false, id: ev.pointerId };
  });
  document.addEventListener('pointermove', function (ev) {
    if (!scrub || ev.pointerId !== scrub.id) return;
    if (!scrub.moved) {
      if (Math.abs(ev.clientX - scrub.x) + Math.abs(ev.clientY - scrub.y) < 8) return;
      scrub.moved = true;
      try { scrub.svg.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
    }
    scrubTo(scrub.svg, ev);
  });
  function endScrub() { if (scrub && scrub.moved) { suppressClick = true; setTimeout(function () { suppressClick = false; }, 50); } scrub = null; }
  document.addEventListener('pointerup', endScrub);
  document.addEventListener('pointercancel', endScrub);
  document.addEventListener('click', function (ev) { if (suppressClick) { ev.stopPropagation(); ev.preventDefault(); } }, true);

  /* ---------- Drag to reorder issues ---------- */
  var drag = null;
  function saveOrder() {
    var list = document.getElementById('sortList'); if (!list) return;
    var ids = [].map.call(list.querySelectorAll('.sortable'), function (r) { return r.getAttribute('data-id'); });
    var moved = ids.map(function (id) { return issueById(id) || JSON.parse(JSON.stringify(PRESETS.filter(function (p) { return p.id === id; })[0] || null)); }).filter(Boolean);
    var rest = db.issues.filter(function (i) { return ids.indexOf(i.id) === -1; });
    db.issues = rest.concat(moved); db.customOrder = true; save();
  }
  function moveRow(row, y) {
    var sibs = [].filter.call(row.parentNode.querySelectorAll('.sortable'), function (r) { return r !== row; });
    var before = null;
    for (var k = 0; k < sibs.length; k++) { var b = sibs[k].getBoundingClientRect(); if (y < b.top + b.height / 2) { before = sibs[k]; break; } }
    row.parentNode.insertBefore(row, before);
  }
  document.addEventListener('pointerdown', function (ev) {
    var g = ev.target.closest && ev.target.closest('[data-grip]');
    if (!g) return;
    var row = g.closest('.sortable'); if (!row) return;
    ev.preventDefault();
    drag = { row: row, grip: g, id: ev.pointerId };
    row.classList.add('dragging');
    try { g.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
  });
  document.addEventListener('pointermove', function (ev) {
    if (!drag || ev.pointerId !== drag.id) return;
    moveRow(drag.row, ev.clientY);
    if (ev.clientY < 70) window.scrollBy(0, -12); else if (ev.clientY > window.innerHeight - 70) window.scrollBy(0, 12);
  });
  function endDrag(ev) {
    if (!drag || (ev && ev.pointerId !== drag.id)) return;
    drag.row.classList.remove('dragging'); drag = null; saveOrder();
  }
  document.addEventListener('pointerup', endDrag);
  document.addEventListener('pointercancel', endDrag);
  document.addEventListener('keydown', function (ev) {
    var g = ev.target.closest && ev.target.closest('[data-grip]');
    if (!g || (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown')) return;
    ev.preventDefault();
    var row = g.closest('.sortable'), other = ev.key === 'ArrowUp' ? row.previousElementSibling : row.nextElementSibling;
    if (!other) return;
    if (ev.key === 'ArrowUp') row.parentNode.insertBefore(row, other); else row.parentNode.insertBefore(other, row);
    g.focus(); saveOrder();
  });
  function dayDetails(info, d) {
    var cl = info.cl, od = cl - 14, ph = PHASES[phaseOfDay(d)], date = addDays(info.start, d - 1), n = diffDays(date, todayIso());
    var when = shortDate(date) + (n === 0 ? ' · ' + tr('today') : n === 1 ? ' · ' + tr('tomorrow') : n === -1 ? ' · ' + tr('yesterday') : n > 0 ? ' · ' + tr('in {n} days', { n: n }) : ' · ' + tr('{n} days ago', { n: -n }));
    var high = HORMONES.filter(function (hm) {
      var mn = 9, mx = -9, t; for (t = 1; t <= cl; t++) { var v = hm.f(t, od); mn = Math.min(mn, v); mx = Math.max(mx, v); }
      return (hm.f(d, od) - mn) / (mx - mn) >= 0.7;
    }).map(function (hm) { return hm.key; });
    return '<span class="plabel" style="color:' + ph.hex + '">' + pt(phaseOfDay(d)) + '</span><span class="pwhen sm">' + esc(when) + '</span>' +
      (n <= 0 ? '<span class="pmini">' + esc(tr('Next one on {d}', { d: shortDate(addDays(info.start, cl + d - 1)) })) + '</span>' : '') +

      '<button class="plink" data-act="moonDay" data-d="' + d + '">' + tr('Back to today') + '</button>';
  }
  function viewToday() {
    var info = cycleInfo(todayIso());
    var h = '<div class="banner"><div><small>' + esc(longToday()) + '</small><h1>' + tr('Today') + '</h1></div></div>';
    if (!info) {
      return h + '<div class="card setup">' + langPicker('margin-top:0') + '<h2 style="margin-top:20px">' + tr('When did your last period start?') + '</h2><p>' + tr('Add the first day and I will work out where you are in your cycle. You can change it any time.') + '</p>' +
        '<input type="date" id="firstStart" max="' + todayIso() + '" value="' + todayIso() + '">' +
        '<button class="btn" data-act="firstStart">' + tr('Save') + '</button></div>' +
        '<p class="quiet">' + tr('Your data stays on this device.') + '</p>' + navBar('today');
    }
    var T = PHASE_TEXT[info.phase], ph = PHASES[info.phase];
    var legend = phaseLayout().map(function (p) { return '<span><i style="background:' + PHASES[p.key].hex + '"></i>' + pl(p.key) + '</span>'; }).join('');
    h += '<section class="hero phase-hero"><div class="ph-top"><div class="ring">' + moonRing(info, '', true) + '</div><div class="phase-txt">' + phaseTxt(info) + '</div></div>' +
      '<button class="info-btn" data-act="hormones" aria-label="' + tr('Your hormones') + '">' + icon('info') + '</button></section>';
    if (isHormonal()) h += '<p class="quiet hbc"><b>' + tr('Hormonal method:') + '</b> ' + tr('phases are only a rough guide.') + '</p>';
    var gTap = hasGroups(T, false);
    h += '<section class="card combo"><div class="blk likely tap" data-act="learn" data-k="going" role="button" tabindex="0"><div class="bh"><h2>' + tr('What’s likely going on') + '</h2><span class="more">' + tr('Read more') + ' ' + icon('chevR') + '</span></div><p class="clamp">' + esc(tr(T.likely)) + '</p></div>' +
      '<div class="blk doing' + (gTap ? ' tap" data-act="learn" data-k="do" role="button" tabindex="0' : '') + '"><div class="bh"><h2>' + tr('Worth doing') + '</h2>' + (gTap ? '<span class="more">' + tr('Read more') + ' ' + icon('chevR') + '</span>' : '') + '</div><div class="do-list">' +
      T.todo.map(function (r) { var tx = tr(r[1]); return '<div class="do-row"><span class="tag ' + r[0] + '">' + tr(r[0]) + '</span><p>' + esc(T.know ? tx.split('. ')[0].replace(/\.$/, '') + '.' : tx) + '</p></div>'; }).join('') + '</div></div></section>';
    return h + navBar('today');
  }

  function banner(small, title, backTo) {
    return '<div class="banner' + (backTo ? ' has-back' : '') + '">' +
      (backTo ? '<button class="round-btn back-btn" data-act="go" data-v="' + backTo + '" aria-label="' + tr('Go back') + '">' + icon('back') + '</button>' : '') +
      '<div><small>' + esc(tr(small)) + '</small><h1>' + esc(tr(title)) + '</h1></div></div>';
  }
  function viewLog() {
    function row(i) {
      var sub = (i.pinned && i.sub) ? tr(i.sub) : lastLoggedText(i.id);
      if (ui.reorder && !i.pinned) return '<div class="big-row sortable" data-id="' + esc(i.id) + '"><span class="icon-tile ' + i.tile + '">' + icon(i.icon) + '</span><span><span class="t">' + esc(iname(i)) + '</span></span><button class="hide-btn" data-act="hide" data-id="' + esc(i.id) + '" aria-label="' + esc(tr('Hide from my list') + ': ' + iname(i)) + '">' + icon('minus') + '</button><button class="grip" data-grip="1" aria-label="' + esc(tr('Drag to reorder') + ': ' + iname(i)) + '">' + icon('grip') + '</button></div>';
      return '<button class="big-row" data-act="pick" data-id="' + esc(i.id) + '"' + (i.preset ? ' data-preset="1"' : '') + '><span class="icon-tile ' + i.tile + '">' + icon(i.icon) + '</span><span><span class="t">' + esc(iname(i)) + '</span><span class="s">' + esc(sub) + '</span></span>' +
        (i.kind === 'period' || i.kind === 'tap' ? '' : '<span class="chev">' + icon('chevR') + '</span>') + '</button>';
    }
    var pinned = db.issues.filter(function (i) { return i.pinned; });
    var yours = db.issues.filter(function (i) { return !i.pinned && !i.hidden; });
    var h = banner('Log', 'What’s worth noting?', 'today') +
      '<p class="sub" style="margin-top:8px">' + tr('Everything here is optional. Only log what you want to remember.') + '</p>' +
      '<div class="section-h" style="color:var(--muted);font-weight:500">' + tr('Pinned') + '</div>' + pinned.map(row).join('');
    if (!yours.length) ui.reorder = false;
    h += '<div class="section-h section-row" style="color:var(--muted);font-weight:500"><span>' + tr('Your issues') + '</span>' + (yours.length ? '<button class="link-btn" data-act="reorder">' + (ui.reorder ? tr('Done') : tr('Edit')) + '</button>' : '') + '</div>';
    if (ui.reorder) h += '<p class="sub" style="margin:0 0 8px">' + tr('Drag the handles to reorder, or tap the minus to take an issue off your list.') + '</p>';
    if (!yours.length) h += '<p class="sub" style="margin:0 0 8px">' + tr('Nothing here yet. Tap Add to choose what you want to keep track of.') + '</p>';
    h += '<div id="sortList">' + yours.map(row).join('') + '</div>';
    h += '<button class="dashed" data-act="addPick">' + icon('plus') + ' ' + tr('Add an issue') + '</button>';
    h += '<p class="quiet">' + tr('No streaks, no reminders. Nothing is ever overdue.') + '</p>';
    return h;
  }

  var BRISTOL = [
    [1, 'Separate hard lumps', 'Constipated'],
    [2, 'Lumpy sausage', 'Leaning constipated'],
    [3, 'Sausage with cracks', 'Typical'],
    [4, 'Smooth, soft sausage', 'Typical'],
    [5, 'Soft blobs', 'Leaning loose'],
    [6, 'Mushy, ragged pieces', 'Loose'],
    [7, 'Watery, no solid pieces', 'Diarrhoea']
  ];
  function bristolArt(n) {
    var c = '#7A4A26', s;
    if (n === 1) s = '<circle cx="8" cy="12" r="4" fill="' + c + '"/><circle cx="22" cy="12" r="4" fill="' + c + '"/><circle cx="36" cy="12" r="4" fill="' + c + '"/>';
    else if (n === 2) s = '<rect x="4" y="6" width="36" height="12" rx="6" fill="' + c + '"/><path d="M12 6v12M22 6v12M31 6v12" stroke="#F4E6D7" stroke-width="2"/>';
    else if (n === 3) s = '<rect x="4" y="6" width="36" height="12" rx="6" fill="' + c + '"/><path d="M14 6l2 5M26 18l2-5" stroke="#F4E6D7" stroke-width="2"/>';
    else if (n === 4) s = '<rect x="4" y="6" width="36" height="12" rx="6" fill="' + c + '"/>';
    else if (n === 5) s = '<ellipse cx="9" cy="12" rx="5" ry="5" fill="' + c + '"/><ellipse cx="22" cy="12" rx="5" ry="5" fill="' + c + '"/><ellipse cx="35" cy="12" rx="5" ry="5" fill="' + c + '"/>';
    else if (n === 6) s = '<path d="M4 18c2-10 8-14 14-8 4-8 12-6 14 2 3-2 7 2 8 6z" fill="' + c + '"/>';
    else s = '<path d="M3 14c6-6 8 2 13-2s8 4 13 0 8 2 12-2v7H3z" fill="' + c + '" opacity=".8"/>';
    return '<svg viewBox="0 0 44 24" aria-hidden="true">' + s + '</svg>';
  }

  function calendarHtml(d) {
    var m = d.calMonth.split('-'), y = +m[0], mo = +m[1] - 1;
    var first = new Date(y, mo, 1), startOffset = (first.getDay() + 6) % 7;
    var days = new Date(y, mo + 1, 0).getDate(), t = todayIso();
    var thisMonth = t.slice(0, 7) === d.calMonth;
    var cells = DOWS.map(function (w) { return '<div class="dow">' + w + '</div>'; }).join('');
    for (var i = 0; i < startOffset; i++) cells += '<div></div>';
    for (var n = 1; n <= days; n++) {
      var ds = y + '-' + pad(mo + 1) + '-' + pad(n), cls = '', dis = ds > t;
      var end = d.end || (d.ongoing ? t : d.start);
      if (ds === d.start || ds === d.end) cls = 'sel';
      else if (d.start && ds > d.start && ds < end) cls = 'mid';
      if (ds === t && !cls) cls = 'today';
      cells += '<button class="' + cls + '" ' + (dis ? 'disabled' : 'data-act="day" data-d="' + ds + '"') + '>' + n + '</button>';
    }
    return '<div class="cal"><div class="cal-head"><button data-act="month" data-n="-1" aria-label="' + tr('Previous month') + '">' + icon('back') + '</button><span>' + cap(MONTHS[mo]) + ' ' + y + '</span>' +
      '<button data-act="month" data-n="1" ' + (thisMonth ? 'disabled' : '') + ' aria-label="' + tr('Next month') + '">' + icon('chevR') + '</button></div><div class="cal-grid">' + cells + '</div></div>';
  }
  function dayWord(s) {
    var n = diffDays(todayIso(), s);
    return n === 0 ? tr('Today') : n === 1 ? tr('Yesterday') : shortDate(s);
  }
  function whenText(d) {
    if (d.ongoing) return tr('{a} to now, ongoing', { a: shortDate(d.start) });
    if (!d.end || d.end === d.start) return dayWord(d.start);
    return tr('{a} to {b}', { a: shortDate(d.start), b: shortDate(d.end) });
  }
  function insightText(issue) {
    var cl = db.settings.cycleLength, since = addDays(todayIso(), -cl * 3);
    var list = db.entries.filter(function (e) { return e.issueId === issue.id && e.start >= since; });
    if (!list.length) return '';
    var cycles = Math.max(1, Math.min(3, Math.ceil(diffDays(todayIso(), firstDataDate() || todayIso()) / cl) || 1));
    var durs = list.map(function (e) { return entryDays(e).length; });
    var lo = Math.min.apply(null, durs), hi = Math.max.apply(null, durs);
    var txt;
    if (issue.kind === 'bloat') {
      var totalDays = durs.reduce(function (a, b) { return a + b; }, 0);
      txt = tr('So far: {n} ' + (totalDays === 1 ? 'day' : 'days') + ' in {c} ' + (cycles === 1 ? 'cycle' : 'cycles'), { n: totalDays, c: cycles });
      var pre = list.filter(function (e) { var c = cycleInfo(e.start); return c && c.rawDay > cl - 7; }).length;
      if (db.periodStarts.length && pre / list.length >= 0.6) txt += tr(', mostly before your period');
    } else {
      txt = tr('So far: {n} ' + (list.length === 1 ? 'time' : 'times') + ' in {c} ' + (cycles === 1 ? 'cycle' : 'cycles') + ', usually {r}', { n: list.length, c: cycles, r: tn('{n} day', '{n} days', hi, { n: lo === hi ? lo : lo + '–' + hi }) });
    }
    return '<div class="insight">' + esc(txt) + '</div>';
  }

  function historyCard(issue) {
    var list = db.entries.filter(function (e) { return e.issueId === issue.id; }).sort(function (a, b) { return a.start < b.start ? 1 : a.start > b.start ? -1 : 0; });
    if (!list.length) return '<div class="last-card"><b>' + tr('First time logging this') + '</b><span>' + tr('Next time you will see your history here.') + '</span></div>';
    var l = list[0], last = l.end || todayIso(), n = diffDays(todayIso(), last);
    var ago = n <= 0 ? tr('Today') : n === 1 ? tr('Yesterday') : tr('{n} days ago', { n: n });
    var head = (n <= 0 && !l.end) ? tr('Still going since {d}', { d: shortDate(l.start) }) : tr('Last time: {ago}', { ago: ago.toLowerCase() });
    var rows = list.slice(0, 5).map(function (e) {
      var dt = e.end && e.end !== e.start ? tr('{a} to {b}', { a: shortDate(e.start), b: shortDate(e.end) }) : shortDate(e.start);
      return '<li><span>' + esc(dt) + '</span><em>' + esc(describeEntry(e).detail || '—') + '</em></li>';
    }).join('');
    return '<div class="last-card"><b>' + esc(head) + '</b><span>' + tn('{n} time logged in total', '{n} times logged in total', list.length) + '</span><ul>' + rows + '</ul></div>';
  }
  function viewIssue() {
    var d = ui.draft, issue = issueById(d.issueId);
    var h = banner('Log', iname(issue), 'log');
    h += insightText(issue);
    if (issue.kind !== 'poop' && issue.kind !== 'period') h += historyCard(issue);

    if (issue.kind === 'poop') {
      h += '<button class="btn-outline warn ' + (d.noPoo ? 'on' : '') + '" style="margin-top:18px" data-act="noPoo">' + (d.noPoo ? '✓ ' : '') + tr('I didn’t poo') + '</button>';
    }
    if (issue.kind === 'poop' && !d.noPoo) {
      h += '<div class="label">' + tr('What did it look like?') + '</div>';
      h += BRISTOL.map(function (b) { return '<button class="bristol t-' + ({ 1: 'red', 2: 'yellow', 3: 'green', 4: 'green', 5: 'yellow', 6: 'red', 7: 'red' }[b[0]]) + ' ' + (d.bristol === b[0] ? 'on' : '') + '" data-act="bristol" data-n="' + b[0] + '"><span class="art">' + bristolArt(b[0]) + '</span><span><span class="n">' + tr(b[1]) + '</span><span class="d">' + tr(b[2]) + '</span></span></button>'; }).join('');
    }
    if (issue.where && issue.where.length) {
      h += '<div class="label">' + tr(issue.whereLabel || 'Where') + '</div><div class="opts">' + issue.where.map(function (w) { return '<button class="opt ' + (d.where === w ? 'on' : '') + '" data-act="where" data-w="' + esc(w) + '">' + esc(tr(w)) + '</button>'; }).join('') + '</div>';
    }
    if (issue.symptoms && issue.symptoms.length) {
      h += '<div class="label">' + tr('What are you feeling? Pick any') + '</div><div class="opts">' + issue.symptoms.map(function (s) { return '<button class="opt ' + (d.symptoms.indexOf(s) !== -1 ? 'on' : '') + '" data-act="symptom" data-s="' + esc(s) + '">' + esc(tr(s)) + '</button>'; }).join('') + '</div>';
    }
    if (issue.kind === 'pain' || issue.kind === 'custom' || issue.kind === 'gut' || issue.kind === 'seizure') {
      var word = strengthWord(d.strength);
      h += '<div class="strong-label"><span>' + (issue.kind === 'pain' ? tr('How bad is the pain') : issue.kind === 'seizure' ? tr('How severe') : tr('How strong')) + '</span><b id="strengthLabel">' + word + '</b></div>';
      h += '<div class="slider-wrap"><div class="bubble" id="bubble" style="--v:' + d.strength + '">' + d.strength + '</div>' +
        '<input type="range" class="slider" min="0" max="10" step="1" value="' + d.strength + '" data-range="strength" aria-label="' + tr('Strength from 0 to 10') + '"></div>';
      h += '<div class="scale-cap"><span>' + (issue.kind === 'pain' ? tr('No pain') : issue.kind === 'seizure' ? tr('Mild') : tr('None')) + '</span><span>' + tr('Worst ever') + '</span></div>';
    }
    if (issue.kind === 'bloat') {
      h += '<div class="label">' + tr('How bloated') + '</div><div class="scale scale3">' + [[1, 'Mild'], [2, 'Noticeable'], [3, 'Heavy']].map(function (o) { return '<button class="opt ' + (d.bloat === o[0] ? 'on' : '') + '" data-act="bloat" data-n="' + o[0] + '">' + tr(o[1]) + '</button>'; }).join('') + '</div>';
    }
    h += '<div class="label" style="margin-bottom:4px">' + tr('When') + '</div><div class="when-row"><div class="when">' + esc(whenText(d)) + '</div>' +
      '<button class="link-btn" data-act="toggleCal">' + (d.showCal ? tr('Done') : tr('Change date or range')) + '</button></div>';
    if (d.showCal) h += '<p class="sub" style="margin:2px 0 0">' + tr('Tap a day. Tap a later day to make it a range.') + '</p>' + calendarHtml(d);
    if (issue.kind === 'seizure') {
      h += '<div class="label">' + tr('Start time') + '</div><input type="time" data-input="time" value="' + esc(d.time || '') + '">';
      h += '<div class="label">' + tr('Duration') + '</div><div class="dur-row">' +
        '<label><input type="number" inputmode="numeric" min="0" max="999" data-input="durMin" placeholder="0" value="' + esc(d.durMin || '') + '"><span>' + tr('Minutes') + '</span></label></div>';
    }
    h += '<div class="label">' + tr('Note for yourself') + '</div><textarea data-input="note" placeholder="' + esc(tr('What you ate, stress, travel, anything')) + '">' + esc(d.note) + '</textarea>';
    h += '<button class="btn" data-act="saveEntry">' + tr('Save') + '</button>';
    return h;
  }

  function viewAddPick() {
    var avail = db.issues.filter(function (i) { return !i.pinned && i.hidden; });
    var h = banner('Log', 'Add an issue', 'log') +
      '<p class="sub">' + tr('Choose what you want to keep track of. You can take any of them off your list again with Edit.') + '</p>';
    if (!avail.length) return h + '<div class="card empty"><p>' + tr('Everything is already on your list.') + '</p></div>';
    return h + avail.map(function (i) {
      return '<button class="big-row" data-act="unhide" data-id="' + esc(i.id) + '"><span class="icon-tile ' + i.tile + '">' + icon(i.icon) + '</span><span><span class="t">' + esc(iname(i)) + '</span>' + (i.sub ? '<span class="s">' + esc(tr(i.sub)) + '</span>' : '') + '</span><span class="chev">' + icon('plus') + '</span></button>';
    }).join('');
  }
  function viewAddIssue() {
    var d = ui.draft;
    var tiles = ISSUE_TILES;
    return banner('Log', 'Add an issue', 'log') +
      '<p class="sub">' + tr('For something that is not in the list. It will then stay there for next time.') + '</p>' +
      '<div class="label" style="margin-top:6px">' + tr('Name') + '</div><input type="text" data-input="name" maxlength="40" placeholder="' + esc(tr('e.g. Headache')) + '" value="' + esc(d.name) + '">' +
      '<div class="label">' + tr('Icon') + '</div><div class="icon-pick">' + tiles.map(function (t, i) { return '<button class="' + (d.tileIdx === i ? 'on' : '') + '" data-act="tile" data-n="' + i + '" aria-label="' + tl(t[2]) + '"><span class="icon-tile ' + t[1] + '">' + icon(t[0]) + '</span><span class="lbl">' + tl(t[2]) + '</span></button>'; }).join('') + '</div>' +
      '<button class="btn" data-act="saveIssue">' + tr('Add issue') + '</button>';
  }
  var ISSUE_TILES = [['headache', 'tile-yellow', 'Head'], ['neck', 'tile-yellow', 'Neck'], ['spine', 'tile-yellow', 'Back'], ['lungs', 'tile-blue', 'Chest'], ['heart', 'tile-pink', 'Heart'],
    ['breast', 'tile-pink', 'Breast'], ['gut', 'tile-lilac', 'Gut'], ['uterus', 'tile-pink', 'Womb'], ['bladder', 'tile-blue', 'Bladder'], ['eye', 'tile-orange', 'Eyes']];

  var BC = [
    ['none', 'No method', 'Natural cycle', 'Cycle phases and phase-based tips work as shown.'],
    ['combined', 'Combined pill', 'Hormonal method', 'Hormones keep ovulation quiet, so phases are only a rough guide. The monthly bleed is a withdrawal bleed.'],
    ['progestin', 'Progestin-only pill', 'Hormonal method', 'Ovulation and bleeding can vary a lot, so phases are only a rough guide.'],
    ['patch', 'Patch or ring', 'Hormonal method', 'Hormones keep ovulation quiet, so phases are only a rough guide.'],
    ['hiud', 'Hormonal IUD', 'Hormonal method', 'Bleeding often gets lighter or stops. Phases are only a rough guide.'],
    ['copper', 'Copper IUD', 'Natural cycle', 'Your hormones are not changed, so phases and tips work as shown. Periods can be heavier.'],
    ['implant', 'Implant', 'Hormonal method', 'Bleeding can be irregular, so phases are only a rough guide.'],
    ['injection', 'Injection', 'Hormonal method', 'Bleeding often becomes irregular or stops. Phases are only a rough guide.'],
    ['other', 'Other or not sure', 'Rough guide', 'Phases are shown as a rough guide.']
  ];
  var SOURCES = [
    ['Roots to Leaves', 'If Your Luteal Phase Sucks, Then Read This', 'https://rootstoleaves.substack.com/p/if-your-luteal-phase-sucks-then-read'],
    ['Sabrina Rose', 'The Transformative Power of the Luteal Phase', 'https://moonbeambysabrina.substack.com/p/the-transformative-power-of-the-luteal'],
    ['Bhielle', 'softening into your luteal phase', 'https://bhielle.substack.com/p/softening-into-your-luteal-phase'],
    ['Valerie Ribon', 'Your Cycle Gives You Superpowers (A Guide)', 'https://valerieribon.substack.com/p/your-cycle-gives-you-superpowers'],
    ['Sophie Trotman', '10 Things I Wish Women Knew About Their Menstrual Cycle', 'https://sophietrotmannutrition.substack.com/p/10-things-i-wish-women-knew-about']
  ];
  function langPicker(style) {
    return '<div class="label" style="' + (style || '') + '">' + tr('Language and seasonal produce') + '</div><div class="lang-row">' +
      '<button class="opt ' + (lang === 'en' ? 'on' : '') + '" data-act="setLang" data-l="en" aria-label="English, Dutch seasonal produce" aria-pressed="' + (lang === 'en') + '">EN / NL</button>' +
      '<button class="opt ' + (lang === 'it' ? 'on' : '') + '" data-act="setLang" data-l="it" aria-label="Italiano, prodotti di stagione italiani" aria-pressed="' + (lang === 'it') + '">IT / IT</button></div>';
  }
  function viewSettings() {
    var s = db.settings, cur = BC.filter(function (b) { return b[0] === s.birthControl; })[0] || BC[0];
    var h = banner('Your cycle and data', 'Settings') +
      langPicker('margin-top:14px') +
      '<div class="label">' + tr('Your cycle') + '</div><div class="stepper-card">' +
      '<div class="stepper"><span>' + tr('Cycle length') + '</span><span class="ctl"><button data-act="step" data-k="cycleLength" data-n="-1" aria-label="' + tr('Shorter') + '">−</button><span>' + tr('{n} days', { n: s.cycleLength }) + '</span><button data-act="step" data-k="cycleLength" data-n="1" aria-label="' + tr('Longer') + '">+</button></span></div>' +
      '<div class="stepper"><span>' + tr('Period length') + '</span><span class="ctl"><button data-act="step" data-k="periodLength" data-n="-1" aria-label="' + tr('Shorter') + '">−</button><span>' + tr('{n} days', { n: s.periodLength }) + '</span><button data-act="step" data-k="periodLength" data-n="1" aria-label="' + tr('Longer') + '">+</button></span></div></div>';
    h += '<div class="label">' + tr('Birth control') + '</div>';
    h += '<button class="bc-row ' + (ui.bcOpen ? 'open' : '') + '" data-act="bcToggle" aria-expanded="' + (ui.bcOpen ? 'true' : 'false') + '"><span>' + tr(cur[1]) + '</span>' + icon('chevR') + '</button>';
    if (ui.bcOpen) h += '<div style="margin-top:10px">' + BC.map(function (b) { return '<button class="radio ' + (s.birthControl === b[0] ? 'on' : '') + '" data-act="bc" data-v="' + b[0] + '"><i></i>' + tr(b[1]) + '</button>'; }).join('') + '</div>';
    h += '<div class="note-card"><div class="small">' + tr('What changes in the app') + '</div><span class="chip">' + tr(cur[2]) + '</span><p>' + tr(cur[3]) + '</p></div>';
    h += '<div class="label">' + tr('Last period started') + '</div>';
    var ls = db.periodStarts.slice().sort().pop() || '';
    h += '<input type="date" id="lastStart" max="' + todayIso() + '" value="' + ls + '"><button class="btn secondary" data-act="saveLastStart">' + tr('Update date') + '</button>';
    h += '<div class="label">' + tr('Your data') + '</div><p class="sub">' + tr('Everything is stored only on this device. Make a backup now and then, because clearing browser data would erase it.') + '</p>' +
      '<button class="btn secondary" data-act="importNotes">' + tr('Import data') + '</button>' +
      '<button class="btn secondary" data-act="export">' + tr('Download backup') + '</button>' +
      '<button class="btn danger" data-act="wipe">' + tr('Delete all my data') + '</button>';
    h += '<div class="label">' + tr('Sources') + '</div><p class="sub">' + tr('Personal perspectives, not medical advice. The tips in the app are my own summaries of:') + '</p><ul class="know" style="margin-bottom:16px">' + SOURCES.map(function (r) { return '<li><a href="' + r[2] + '" target="_blank" rel="noopener">' + esc(r[1]) + '</a> (' + esc(r[0]) + ')</li>'; }).join('') + '</ul>';
    return h + navBar('settings');
  }

  function daysIn(issueId, days) {
    var set = {};
    db.entries.forEach(function (e) { if (e.issueId === issueId) entryDays(e).forEach(function (d) { set[d] = 1; }); });
    return days.filter(function (d) { return set[d]; }).length;
  }
  function monthDays(ym) {
    var n = new Date(+ym.slice(0, 4), +ym.slice(5, 7), 0).getDate(), out = [];
    for (var i = 1; i <= n; i++) out.push(ym + '-' + pad(i));
    return out;
  }
  function shiftMonth(ym, n) {
    var d = new Date(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + n, 1);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1);
  }
  function viewPatterns() {
    var t = todayIso(), first = firstDataDate();
    var h = '<div class="banner"><div><small>' + (first ? tr('Your days at a glance') : tr('Nothing yet')) + '</small><h1>' + tr('Patterns') + '</h1></div></div>';
    if (!first || !db.entries.length) {
      return h + '<div class="card empty"><h2>' + tr('No patterns yet') + '</h2><p>' + tr('Log a few days with the + button and your patterns will show up here.') + '</p></div>' + navBar('patterns');
    }
    var cur = t.slice(0, 7), ym = ui.patMonth || cur;
    if (ym > cur) ym = cur;
    var firstYm = first.slice(0, 7);
    if (ym < firstYm) ym = firstYm;
    var all = monthDays(ym);
    var days = all.filter(function (d) { return d <= t && d >= first; }), N = days.length;
    var prevAll = monthDays(shiftMonth(ym, -1)), comparable = first <= prevAll[0];
    var offset = (new Date(+ym.slice(0, 4), +ym.slice(5, 7) - 1, 1).getDay() + 6) % 7;
    var dows = DOWS.map(function (w) { return '<div class="dow">' + w + '</div>'; }).join('');
    var colors = ['#B04F1E', '#4B4BA0', '#3F7A63', '#8B3A5A', '#B8862F', '#1F4A78'];

    h += '<div class="cal-head standalone"><button data-act="patMonth" data-n="-1" ' + (ym <= firstYm ? 'disabled' : '') + ' aria-label="' + tr('Previous month') + '">' + icon('back') + '</button>' +
      '<span>' + cap(MONTHS[+ym.slice(5, 7) - 1]) + ' ' + ym.slice(0, 4) + '</span>' +
      '<button data-act="patMonth" data-n="1" ' + (ym >= cur ? 'disabled' : '') + ' aria-label="' + tr('Next month') + '">' + icon('chevR') + '</button></div>';
    h += '<button class="opt sm toggle ' + (ui.patCycle ? 'on' : '') + '" data-act="patCycle" aria-pressed="' + (ui.patCycle ? 'true' : 'false') + '">' + (ui.patCycle ? '✓ ' : '') + tr('Show my cycle') + '</button>';

    // One section per logged issue, never mixed together.
    var logged = {};
    db.entries.forEach(function (e) { logged[e.issueId] = 1; });
    var issues = db.issues.filter(function (x) { return x.kind !== 'period' && logged[x.id]; });
    issues.forEach(function (x, idx) {
      var levels = dayLevels(x.id), n = daysIn(x.id, days), p = comparable ? daysIn(x.id, prevAll) : null;
      var cells = dows;
      for (var b = 0; b < offset; b++) cells += '<div></div>';
      all.forEach(function (d, i) {
        var cls = d > t ? 'future' : d < first ? 'before' : 'l' + (levels[d] || 0);
        if (d === t) cls += ' today';
        var phStyle = '', phName = '';
        if (ui.patCycle && d <= t) {
          var ci = cycleInfo(d);
          if (ci) { cls += ' hasph'; phStyle = ' style="--ph:' + PHASES[ci.phase].hex + '"'; phName = ' · ' + pl(ci.phase); }
        }
        cells += '<div class="pcell ' + cls + '"' + phStyle + ' title="' + shortDate(d) + phName + '">' + (i + 1) + '</div>';
      });
      var cmp = p === null ? '' : n === p ? tr('Same as last month') : n < p ? tr('{n} fewer than last month', { n: p - n }) : tr('{n} more than last month', { n: n - p });
      h += '<section class="card"><div class="issue-row" style="margin-bottom:14px"><div class="top"><span>' + esc(iname(x)) + '</span><span>' + tn('{n} day', '{n} days', n) + '</span></div>' +
        (N ? '<div class="bar"><i style="width:' + (n ? Math.max(2, Math.round(n / N * 100)) : 0) + '%;background:' + colors[idx % colors.length] + '"></i></div>' : '') +
        (cmp ? '<small>' + cmp + '</small>' : '') + '</div>' +
        '<div class="pgrid">' + cells + '</div>' +
        '<div class="hlegend"><span><i class="l0"></i>' + tr('Good') + '</span><span><i class="l1"></i>' + tr('Mild') + '</span><span><i class="l2"></i>' + tr('Medium') + '</span><span><i class="l3"></i>' + tr('Strong') + '</span></div>';

      if (db.periodStarts.length) {
        var phDays = { period: 0, follicular: 0, ovulation: 0, luteal: 0 }, total = 0, seen = {};
        db.entries.forEach(function (e) {
          if (e.issueId !== x.id) return;
          entryDays(e).forEach(function (d) {
            if (seen[d]) return; seen[d] = 1;
            var ci = cycleInfo(d); if (!ci) return;
            phDays[ci.phase]++; total++;
          });
        });
        if (total) {
          h += '<div class="label" style="margin-top:18px">' + tr('When it tends to happen') + '</div>' + phaseLayout().map(function (ph) {
            var c = phDays[ph.key], pct = Math.round(c / total * 100);
            return '<div class="issue-row"><div class="top"><span>' + pl(ph.key) + '</span><span>' + tn('{n} day', '{n} days', c) + '</span></div><div class="bar"><i style="width:' + (c ? Math.max(2, pct) : 0) + '%;background:' + PHASES[ph.key].hex + '"></i></div><small>' + tr('{n}% of your logged days', { n: pct }) + '</small></div>';
          }).join('') + '<p class="sub" style="margin:12px 0 0;font-size:14px">' + tr('Based on everything you have logged for this. More cycles make it more reliable.') + '</p>';
        }
      }

      var notes = db.entries.filter(function (e) { return e.issueId === x.id && e.note && e.start.slice(0, 7) === ym; }).sort(function (a, b) { return a.start < b.start ? 1 : -1; });
      if (notes.length) {
        h += '<div class="label" style="margin-top:18px">' + tr('Your notes') + '</div>' + notes.map(function (e) {
          return '<div class="note-item"><small>' + shortDate(e.start) + (e.symptoms && e.symptoms.length ? ' · ' + esc(e.symptoms.map(function (z) { return tr(z); }).join(', ')) : e.noPoo ? ' · ' + tr('Didn’t poo') : e.where ? ' · ' + esc(tr(e.where)) : '') + '</small>' + esc(e.note) + '</div>';
        }).join('');
      }
      h += '</section>';
    });
    h += '<button class="btn secondary" data-act="history" data-from="patterns">' + tr('See all entries') + '</button>';
    return h + navBar('patterns');
  }

  function describeEntry(e) {
    var iss = issueById(e.issueId), bits = [];
    if (e.symptoms && e.symptoms.length) bits.push(e.symptoms.map(function (z) { return tr(z); }).join(', '));
    if (e.where) bits.push(tr(e.where));
    if (e.time) bits.push(e.time);
    if (e.durationSec) bits.push(Math.floor(e.durationSec / 60) ? Math.floor(e.durationSec / 60) + ' min' + (e.durationSec % 60 ? ' ' + e.durationSec % 60 + ' s' : '') : e.durationSec + ' s');
    if (e.noPoo) bits.push(tr('Didn’t poo'));
    else if (e.bristol) bits.push(tr('Type {n}: {name}', { n: e.bristol, name: tr(BRISTOL[e.bristol - 1][1]) }));
    if (e.bloat) bits.push(tr(['', 'Mild', 'Noticeable', 'Heavy'][e.bloat]));
    if (typeof e.strength === 'number') bits.push(e.strength + '/10');
    return { title: iss ? iname(iss) : tr('Deleted issue'), detail: bits.join(' · ') };
  }
  function viewHistory() {
    var rows = [];
    db.entries.forEach(function (e) { rows.push({ type: 'entry', date: e.start, e: e }); });
    db.periodStarts.forEach(function (s) { rows.push({ type: 'period', date: s }); });
    rows.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
    var h = banner('Everything you logged', 'All entries', ui.histFrom) +
      '<p class="sub">' + tr('Newest first. Tap the bin to delete something you logged by mistake. You can undo straight after.') + '</p>';
    if (!rows.length) return h + '<div class="card empty"><p>' + tr('Nothing logged yet.') + '</p></div>';
    return h + rows.map(function (r) {
      var title, detail, when, note = '', key;
      if (r.type === 'period') { title = tr('Period started'); detail = ''; when = shortDate(r.date); key = 'data-act="delPeriod" data-d="' + r.date + '"'; }
      else {
        var d = describeEntry(r.e); title = d.title; detail = d.detail; note = r.e.note || '';
        when = whenText({ start: r.e.start, end: r.e.end, ongoing: !r.e.end }); key = 'data-act="delEntry" data-id="' + r.e.id + '"';
      }
      return '<div class="hist"><div class="hist-main"><b>' + esc(title) + '</b><small>' + esc(when + (detail ? ' · ' + detail : '')) + '</small>' + (note ? '<em>' + esc(note) + '</em>' : '') + '</div>' +
        '<button class="hist-del" ' + key + ' aria-label="' + esc(tr('Delete {title} from {when}', { title: title, when: when })) + '">' + icon('trash') + '</button></div>';
    }).join('');
  }

  /* ---------- Eat: seasonal produce (grown in the Netherlands) ---------- */
  var VEG_ALL = ['mushrooms'];
  var SEASON = {
    1: { veg: ['kale', 'Brussels sprouts', 'chicory', 'leek', 'red cabbage', 'white cabbage', 'savoy cabbage', 'carrot', 'parsnip', 'celeriac', 'beetroot', 'onion', 'salsify', "lamb's lettuce"], fruit: ['apple', 'pear'] },
    2: { veg: ['kale', 'Brussels sprouts', 'chicory', 'leek', 'red cabbage', 'white cabbage', 'savoy cabbage', 'carrot', 'parsnip', 'celeriac', 'beetroot', 'onion', 'salsify', "lamb's lettuce"], fruit: ['apple', 'pear'] },
    3: { veg: ['chicory', 'leek', 'red cabbage', 'white cabbage', 'carrot', 'parsnip', 'celeriac', 'beetroot', 'onion', "lamb's lettuce", 'spinach'], fruit: ['apple', 'pear'] },
    4: { veg: ['spinach', 'radish', 'spring onion', 'lettuce', "lamb's lettuce", 'leek', 'carrot', 'white asparagus'], fruit: ['rhubarb', 'apple'] },
    5: { veg: ['white asparagus', 'green asparagus', 'spinach', 'radish', 'lettuce', 'spring onion', 'new potatoes', 'sorrel'], fruit: ['strawberry', 'rhubarb'] },
    6: { veg: ['green asparagus', 'peas', 'broad beans', 'courgette', 'cucumber', 'tomato', 'lettuce', 'radish', 'spinach', 'new potatoes', 'kohlrabi', 'cauliflower', 'broccoli', 'fennel', 'spring onion'], fruit: ['strawberry', 'cherry', 'raspberry', 'gooseberry', 'redcurrant', 'rhubarb'] },
    7: { veg: ['courgette', 'cucumber', 'tomato', 'bell pepper', 'aubergine', 'green beans', 'peas', 'cauliflower', 'broccoli', 'fennel', 'beetroot', 'carrot', 'lettuce', 'kohlrabi', 'new potatoes'], fruit: ['strawberry', 'raspberry', 'blueberry', 'cherry', 'redcurrant', 'blackcurrant', 'gooseberry'] },
    8: { veg: ['tomato', 'courgette', 'bell pepper', 'aubergine', 'cucumber', 'sweetcorn', 'green beans', 'broccoli', 'cauliflower', 'fennel', 'lettuce', 'beetroot', 'carrot', 'onion', 'leek', 'celery'], fruit: ['plum', 'blackberry', 'blueberry', 'raspberry', 'redcurrant', 'blackcurrant', 'elderberry', 'apple', 'pear'] },
    9: { veg: ['pumpkin', 'sweetcorn', 'tomato', 'bell pepper', 'aubergine', 'courgette', 'broccoli', 'cauliflower', 'savoy cabbage', 'red cabbage', 'white cabbage', 'leek', 'celeriac', 'beetroot', 'carrot', 'onion', 'fennel', 'green beans', 'lettuce'], fruit: ['apple', 'pear', 'plum', 'grapes', 'blackberry', 'raspberry', 'blueberry', 'elderberry'] },
    10: { veg: ['pumpkin', 'Brussels sprouts', 'red cabbage', 'white cabbage', 'savoy cabbage', 'leek', 'celeriac', 'beetroot', 'carrot', 'parsnip', 'chicory', 'fennel', 'cauliflower', 'broccoli', "lamb's lettuce", 'salsify'], fruit: ['apple', 'pear', 'quince', 'grapes', 'medlar'] },
    11: { veg: ['kale', 'Brussels sprouts', 'pumpkin', 'red cabbage', 'white cabbage', 'savoy cabbage', 'leek', 'celeriac', 'parsnip', 'beetroot', 'carrot', 'chicory', 'salsify', "lamb's lettuce", 'onion', 'cauliflower'], fruit: ['apple', 'pear'] },
    12: { veg: ['kale', 'Brussels sprouts', 'pumpkin', 'red cabbage', 'white cabbage', 'savoy cabbage', 'leek', 'celeriac', 'parsnip', 'beetroot', 'carrot', 'chicory', 'salsify', "lamb's lettuce", 'onion'], fruit: ['apple', 'pear'] }
  };
  /* Italian seasonal produce, used when the language is Italian. */
  var SEASON_IT = {
    1: { veg: ['cauliflower', 'broccoli', 'kale', 'savoy cabbage', 'red cabbage', 'white cabbage', 'fennel', 'carrot', 'radicchio', 'chicory', 'spinach', 'chard', 'leek', 'celery', 'pumpkin', 'beetroot', 'cardoon'], fruit: ['orange', 'mandarin', 'clementine', 'lemon', 'grapefruit', 'kiwi', 'apple', 'pear'] },
    2: { veg: ['cauliflower', 'broccoli', 'kale', 'savoy cabbage', 'fennel', 'carrot', 'radicchio', 'chicory', 'spinach', 'chard', 'leek', 'celery', 'artichoke', 'beetroot', 'cardoon'], fruit: ['orange', 'blood orange', 'mandarin', 'clementine', 'lemon', 'grapefruit', 'kiwi', 'apple', 'pear'] },
    3: { veg: ['artichoke', 'spinach', 'chard', 'fennel', 'radicchio', 'leek', 'carrot', 'cauliflower', 'broccoli', 'green asparagus', 'peas', 'lettuce', 'spring onion', 'radish'], fruit: ['orange', 'blood orange', 'lemon', 'grapefruit', 'kiwi', 'apple', 'pear'] },
    4: { veg: ['green asparagus', 'artichoke', 'peas', 'broad beans', 'spinach', 'chard', 'lettuce', 'radish', 'spring onion', 'fennel', 'carrot', 'new potatoes'], fruit: ['strawberry', 'loquat', 'orange', 'lemon', 'kiwi', 'apple'] },
    5: { veg: ['green asparagus', 'artichoke', 'peas', 'broad beans', 'courgette', 'lettuce', 'radish', 'spring onion', 'spinach', 'chard', 'fennel', 'new potatoes', 'cucumber'], fruit: ['strawberry', 'cherry', 'apricot', 'loquat'] },
    6: { veg: ['courgette', 'tomato', 'cucumber', 'bell pepper', 'aubergine', 'green beans', 'peas', 'lettuce', 'carrot', 'fennel', 'new potatoes', 'chard', 'spring onion'], fruit: ['cherry', 'apricot', 'peach', 'nectarine', 'strawberry', 'watermelon', 'melon', 'plum', 'raspberry', 'blueberry'] },
    7: { veg: ['tomato', 'courgette', 'aubergine', 'bell pepper', 'cucumber', 'green beans', 'lettuce', 'carrot', 'chard', 'sweetcorn', 'onion'], fruit: ['peach', 'nectarine', 'apricot', 'watermelon', 'melon', 'plum', 'fig', 'blackberry', 'blueberry', 'raspberry', 'grapes'] },
    8: { veg: ['tomato', 'aubergine', 'bell pepper', 'courgette', 'cucumber', 'green beans', 'sweetcorn', 'carrot', 'lettuce', 'chard', 'onion'], fruit: ['peach', 'nectarine', 'watermelon', 'melon', 'fig', 'plum', 'grapes', 'blackberry', 'pear'] },
    9: { veg: ['tomato', 'aubergine', 'bell pepper', 'pumpkin', 'green beans', 'courgette', 'fennel', 'chard', 'spinach', 'carrot', 'celery', 'sweetcorn', 'broccoli', 'cauliflower'], fruit: ['grapes', 'fig', 'apple', 'pear', 'plum', 'melon', 'peach', 'pomegranate', 'blackberry'] },
    10: { veg: ['pumpkin', 'cauliflower', 'broccoli', 'fennel', 'chard', 'spinach', 'radicchio', 'chicory', 'savoy cabbage', 'kale', 'celery', 'carrot', 'beetroot', 'leek'], fruit: ['apple', 'pear', 'grapes', 'pomegranate', 'persimmon', 'chestnut', 'quince', 'kiwi', 'fig'] },
    11: { veg: ['pumpkin', 'cauliflower', 'broccoli', 'fennel', 'chard', 'spinach', 'radicchio', 'chicory', 'savoy cabbage', 'kale', 'celery', 'carrot', 'beetroot', 'leek', 'cardoon', 'white cabbage', 'red cabbage'], fruit: ['apple', 'pear', 'persimmon', 'kiwi', 'pomegranate', 'clementine', 'mandarin', 'orange', 'chestnut', 'quince'] },
    12: { veg: ['cauliflower', 'broccoli', 'kale', 'savoy cabbage', 'red cabbage', 'white cabbage', 'fennel', 'carrot', 'radicchio', 'chicory', 'spinach', 'chard', 'leek', 'celery', 'pumpkin', 'beetroot', 'cardoon'], fruit: ['orange', 'mandarin', 'clementine', 'lemon', 'kiwi', 'apple', 'pear', 'persimmon', 'pomegranate', 'chestnut'] }
  };
  var IMPORT_IT = ['banana', 'pineapple', 'mango', 'avocado'];
var IMPORT = {
  1: ['clementine', 'orange', 'lemon', 'grapefruit', 'kiwi', 'pomegranate', 'persimmon'],
  2: ['clementine', 'orange', 'lemon', 'grapefruit', 'kiwi', 'blood orange'],
  3: ['orange', 'lemon', 'grapefruit', 'kiwi', 'blood orange'],
  4: ['orange', 'lemon', 'kiwi', 'pineapple'],
  5: ['cherry', 'apricot', 'kiwi', 'pineapple'],
  6: ['cherry', 'apricot', 'peach', 'nectarine', 'watermelon', 'melon'],
  7: ['peach', 'nectarine', 'apricot', 'watermelon', 'melon', 'cherry'],
  8: ['peach', 'nectarine', 'watermelon', 'melon', 'fig', 'grapes'],
  9: ['fig', 'grapes', 'peach', 'melon'],
  10: ['fig', 'pomegranate', 'kiwi', 'persimmon', 'clementine'],
  11: ['clementine', 'orange', 'lemon', 'kiwi', 'pomegranate', 'persimmon'],
  12: ['clementine', 'orange', 'lemon', 'grapefruit', 'kiwi', 'pomegranate', 'persimmon']
};
  var EAT_PHASE = {
    period: {
      why: 'You lose iron with your flow. Pair iron-rich greens with something vitamin C-rich so you absorb more of it. Warm, cooked meals often feel best.',
      foods: ['spinach', 'kale', 'beetroot', "lamb's lettuce", 'broccoli', 'Brussels sprouts', 'sorrel', 'peas', 'broad beans', 'strawberry', 'bell pepper', 'blackcurrant', 'redcurrant', 'cabbage', 'orange', 'kiwi', 'clementine', 'grapefruit', 'lemon', 'chard', 'mandarin']
    },
    follicular: {
      why: 'Energy is building. Fresh, light, crunchy food works well, with some protein to go with it.',
      foods: ['white asparagus', 'green asparagus', 'radish', 'spinach', 'lettuce', 'spring onion', 'peas', 'broccoli', 'cauliflower', 'cucumber', 'kohlrabi', 'rhubarb', 'strawberry', 'fennel', 'sorrel', 'artichoke', 'chard']
    },
    ovulation: {
      why: 'Fibre, colour and plenty of water. Berries, tomatoes and veg with lots of antioxidants are a good fit.',
      foods: ['tomato', 'courgette', 'bell pepper', 'fennel', 'cucumber', 'raspberry', 'blueberry', 'strawberry', 'blackberry', 'cherry', 'broccoli', 'cauliflower', 'green beans', 'lettuce', 'radish', 'apricot', 'peach', 'nectarine', 'watermelon']
    },
    luteal: {
      why: 'Your body burns a bit more energy now, so regular meals with some slow carbs, fibre and magnesium help keep mood and cravings steadier. Try not to skip meals.',
      foods: ['pumpkin', 'sweetcorn', 'spinach', 'kale', 'parsnip', 'carrot', 'beetroot', 'leek', 'celeriac', 'savoy cabbage', 'red cabbage', 'white cabbage', 'cauliflower', 'broccoli', 'apple', 'pear', 'plum', 'new potatoes', 'chestnut', 'chard', 'fennel', 'celery']
    }
  };
  var GUT_FOODS = ['carrot', 'pumpkin', 'courgette', 'parsnip', 'cucumber', 'blueberry', 'strawberry', 'spinach', 'new potatoes', 'sweetcorn'];
  var EAT_WHY = {
    period: {
      spinach: 'Iron, folate', kale: 'Iron, vitamin C', beetroot: 'Iron, folate', "lamb's lettuce": 'Iron, vitamin C', broccoli: 'Iron, vitamin C',
      'Brussels sprouts': 'Vitamin C, iron', sorrel: 'Iron', peas: 'Plant iron, protein', 'broad beans': 'Plant iron, protein', strawberry: 'Vitamin C',
      'bell pepper': 'Vitamin C', blackcurrant: 'Vitamin C', redcurrant: 'Vitamin C', cabbage: 'Vitamin C, fibre',
      orange: 'Vitamin C', kiwi: 'Vitamin C', clementine: 'Vitamin C', grapefruit: 'Vitamin C', lemon: 'Vitamin C', chard: 'Iron, folate', mandarin: 'Vitamin C'
    },
    follicular: {
      'white asparagus': 'Light, folate', 'green asparagus': 'Light, folate', radish: 'Fresh, vitamin C', spinach: 'Folate, iron',
      lettuce: 'Light, hydrating', 'spring onion': 'Light, fresh', peas: 'Protein, fibre', broccoli: 'Fibre, folate',
      cauliflower: 'Fibre, vitamin C', cucumber: 'Hydrating', kohlrabi: 'Vitamin C', rhubarb: 'Fibre',
      strawberry: 'Vitamin C', fennel: 'Gentle digestion', sorrel: 'Fresh greens', artichoke: 'Gentle digestion', chard: 'Folate, iron'
    },
    ovulation: {
      tomato: 'Lycopene', courgette: 'Light, fibre', 'bell pepper': 'Antioxidants, vitamin C', fennel: 'Fibre',
      cucumber: 'Hydrating', raspberry: 'Fibre, antioxidants', blueberry: 'Fibre, antioxidants', strawberry: 'Antioxidants, vitamin C', blackberry: 'Fibre, antioxidants',
      cherry: 'Antioxidants', broccoli: 'Fibre, vitamin C', cauliflower: 'Fibre', 'green beans': 'Fibre', lettuce: 'Water-rich', radish: 'Water-rich', apricot: 'Antioxidants', peach: 'Antioxidants', nectarine: 'Antioxidants', watermelon: 'Hydrating'
    },
    luteal: {
      pumpkin: 'Slow carbs, magnesium', sweetcorn: 'Slow carbs', spinach: 'Magnesium, iron', kale: 'Magnesium, calcium',
      parsnip: 'Slow carbs, fibre', carrot: 'Fibre', beetroot: 'Fibre, iron', leek: 'Gentle fibre', celeriac: 'Fibre',
      cabbage: 'Fibre', cauliflower: 'Fibre, B vitamins', broccoli: 'Fibre, B vitamins', apple: 'Fibre', pear: 'Fibre',
      plum: 'Fibre', 'new potatoes': 'Slow carbs', chestnut: 'Slow carbs, fibre', chard: 'Magnesium, iron', fennel: 'Gentle digestion', celery: 'Fibre'
    }
  };
  
function whyFor(phase, n) {
    var w = EAT_WHY[phase] || {};
    if (w[n]) return tr(w[n]);
    for (var k in w) { if (k.length > 4 && n.indexOf(k) !== -1) return tr(w[k]); }
    return '';
  }
  function tl(s) { return tr(s); }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function pills(list, cls, hi) {
    return '<div class="chips">' + list.map(function (n) {
      return '<span class="chip pr ' + cls + (hi && hi.indexOf(n) !== -1 ? ' hi' : '') + '">' + esc(cap(tr(n))) + '</span>';
    }).join('') + '</div>';
  }
  function recentGut() {
    var from = addDays(todayIso(), -14);
    return db.entries.some(function (e) {
      var i = issueById(e.issueId);
      return i && (i.kind === 'gut' || i.kind === 'bloat' || i.kind === 'poop') && (e.end || todayIso()) >= from;
    });
  }
  function viewEat() {
    var nowM = new Date().getMonth() + 1, m = nowM, itl = lang === 'it', S = (itl ? SEASON_IT : SEASON)[m], IMP = itl ? IMPORT_IT : IMPORT[m];
    var info = cycleInfo(todayIso());
    var h = '<div class="banner"><div><small>' + tr(itl ? 'Grown in Italy' : 'Grown in the Netherlands') + '</small><h1>' + tr('Eat') + '</h1></div></div>';
    var all = S.veg.concat(S.fruit, VEG_ALL, IMP);
    var fp = null;
    if (info) {
      fp = EAT_PHASE[info.phase];
      var match = all.filter(function (n) { return fp.foods.indexOf(n) !== -1 || fp.foods.some(function (f) { return n.indexOf(f) !== -1 && f.length > 4; }); });
      h += '<section class="card"><h2>' + tr('For your {phase}', { phase: pt(info.phase).toLowerCase() }) + '</h2><p>' + esc(tr(fp.why)) + '</p>';
      h += match.length ? '<p class="muted" style="margin:10px 0 8px">' + tr('In season in {m} and a good fit:', { m: MONTHS[m - 1] }) + '</p>' + '<div class="why-list">' + (ui.eatMore ? match : match.slice(0, 6)).map(function (n) { return '<div class="why-row"><b>' + esc(cap(tr(n))) + '</b><span>' + esc(whyFor(info.phase, n)) + '</span></div>'; }).join('') + '</div>' + (match.length > 6 ? '<button class="more" data-act="eatMore">' + (ui.eatMore ? tr('Show less') : tr('Show {n} more', { n: match.length - 6 })) + '</button>' : '') : '<p class="muted" style="margin-top:8px">' + tr('Nothing on the list below is a standout for this phase this month, so just eat what you enjoy.') + '</p>';
      h += '</section>';
    }
    if (recentGut()) {
      var gm = all.filter(function (n) { return GUT_FOODS.indexOf(n) !== -1; });
      if (gm.length) h += '<section class="card"><h2>' + tr('If your tummy is touchy') + '</h2><p>' + tr('You logged gut or poo notes recently. Cooked veg is usually gentler than raw, and these are in season and mild:') + '</p><div style="height:8px"></div>' + pills(gm, 'mild') + '</section>';
    }
    h += '<section class="card"><h2>' + tr('Vegetables in {m}', { m: MONTHS[m - 1] }) + '</h2>' + pills(S.veg.concat(VEG_ALL), 'veg', fp ? fp.foods : null) + '</section>';
    h += '<section class="card"><h2>' + tr('Fruit in {m}', { m: MONTHS[m - 1] }) + '</h2>' + pills(S.fruit, 'fruit', fp ? fp.foods : null) + '</section>';
    h += '<section class="card"><h2>' + tr('Imported fruit in {m}', { m: MONTHS[m - 1] }) + '</h2><p class="muted" style="margin-bottom:8px">' + tr(itl ? 'Not grown in Italy, or only in small amounts, so it is imported.' : 'Not grown here, but in season in southern Europe and elsewhere.') + '</p>' + pills(IMP, 'import', fp ? fp.foods : null) + '</section>';
    h += '<p class="quiet" style="margin-top:8px">' + tr(itl ? 'A general guide to Italian seasonal produce. Dates vary a little by year and by region. Not medical or dietary advice.' : 'A general guide to Dutch-grown seasonal produce. Dates vary a little by year and by greenhouse. Not medical or dietary advice.') + '</p>';
    return h + navBar('eat');
  }

function viewLearn() {
  var info = cycleInfo(todayIso());
  var key = info ? info.phase : 'luteal', T = PHASE_TEXT[key], ph = PHASES[key];
  var h = banner(ui.learnKind === 'going' ? 'More on what’s going on' : 'More on what to do', pt(key), 'today');
  if (ui.learnKind === 'going') h += '<section class="card"><h2>' + tr('You may notice') + '</h2><div class="chips">' + T.notice.map(function (n) { return '<span class="chip">' + esc(tr(n)) + '</span>'; }).join('') + '</div></section>';
  if (T.know) {
    T.know.filter(function (g) { return (g[0] === 'Body') === (ui.learnKind === 'going'); }).forEach(function (g) {
      h += '<section class="card">' + (g[0] === 'Body' ? '' : '<span class="tag ' + g[0] + ' grp">' + tr(g[0]) + '</span>') + '<ul class="know">' + g[1].map(function (k) { return '<li>' + esc(tr(k)) + '</li>'; }).join('') + '</ul></section>';
    });
  }
  return h + navBar('today');
}

  /* ---------- Import from notes ---------- */
  var MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  function mkIso(y, m, d) {
    if (y < 100) y += 2000;
    var dt = new Date(y, m, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== m || dt.getDate() !== d) return null;
    return iso(dt);
  }
  function looseDate(s) {
    s = String(s || '').trim().replace(/^"|"$/g, '');
    var m;
    if ((m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/))) return mkIso(+m[1], +m[2] - 1, +m[3]);
    if ((m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4}|\d{2})$/))) return mkIso(+m[3], +m[2] - 1, +m[1]);
    if ((m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/)) && MON[m[2].slice(0, 3).toLowerCase()] !== undefined) return mkIso(+m[3], MON[m[2].slice(0, 3).toLowerCase()], +m[1]);
    if ((m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/)) && MON[m[1].slice(0, 3).toLowerCase()] !== undefined) return mkIso(+m[3], MON[m[1].slice(0, 3).toLowerCase()], +m[2]);
    return null;
  }
  function parseNotes(text) {
    var out = { rows: [], errors: [], skipped: 0, newIssues: [], noRating: 0 };
    var today = todayIso(), seen = {}, newSeen = {};
    String(text || '').split(/\r?\n/).forEach(function (raw, idx) {
      var line = raw.trim();
      if (!line) return;
      var delim = line.indexOf('\t') > -1 ? '\t' : line.indexOf(';') > -1 ? ';' : ',';
      var p = line.split(delim).map(function (x) { return x.trim().replace(/^"(.*)"$/, '$1'); });
      if (/^date$/i.test(p[0])) return;
      var L = tr('Line {n}: ', { n: idx + 1 });
      var date = looseDate(p[0]);
      if (!date) { out.errors.push(L + tr('could not read the date "{d}". Use a full date like 2025-10-12 or 12/10/2025.', { d: p[0] })); return; }
      if (date > today) { out.errors.push(L + tr('that date is in the future.')); return; }
      var what = (p[1] || '').trim();
      if (!what) { out.errors.push(L + tr('add what it was after the date.')); return; }
      var rating = (p[2] || '').trim(), note = p.slice(3).join(delim).trim();
      var low = what.toLowerCase(), kind, issue = null, name = null;
      if (/^(period|periods|menstruation|menses|ciclo|mestruazioni|mestruazione)( start(ed)?| iniziato)?$/.test(low)) kind = 'period';
      else if (/^(poo|poop|pooping|bowel movement|bm|stool|bristol|cacca|feci)/.test(low)) { kind = 'poop'; issue = issueById('poop'); }
      else {
        issue = db.issues.filter(function (i) { return i.kind !== 'period' && i.kind !== 'poop' && (i.name.toLowerCase() === low || iname(i).toLowerCase() === low); })[0] ||
          db.issues.filter(function (i) { var n = i.name.toLowerCase(), n2 = iname(i).toLowerCase(); return i.kind !== 'period' && i.kind !== 'poop' && (n.indexOf(low) !== -1 || low.indexOf(n) !== -1 || n2.indexOf(low) !== -1 || low.indexOf(n2) !== -1); })[0];
        if (issue) kind = issue.kind; else { kind = 'custom'; name = what.charAt(0).toUpperCase() + what.slice(1); }
      }
      var row = { date: date, kind: kind, issueId: issue ? issue.id : null, name: name, note: note, label: issue ? iname(issue) : name || tr('Period started') };
      var key;
      if (kind === 'period') {
        key = 'period|' + date;
        if (seen[key] || db.periodStarts.indexOf(date) !== -1) { out.skipped++; return; }
        row.label = tr('Period started');
      } else if (kind === 'poop') {
        key = 'poop|' + date;
        if (/^(none|no|nothing|didn.?t.*|0|nessuna|niente|non.*)$/i.test(rating)) { row.noPoo = true; row.detail = tr('Didn’t poo'); }
        else {
          var b = parseInt(rating, 10);
          if (!(b >= 1 && b <= 7)) { out.errors.push(L + tr('for poo, write the type 1 to 7 (Bristol) or "none".')); return; }
          row.bristol = b; row.detail = tr('Type {n}', { n: b });
        }
        row.label = tr('Poo tracker');
        if (seen[key] || db.entries.some(function (e) { return e.issueId === 'poop' && e.start === date; })) { out.skipped++; return; }
      } else {
        key = (issue ? issue.id : 'new:' + low) + '|' + date;
        if (rating === '') { row.strength = 5; out.noRating++; row.detail = tr('no rating (set to 5)'); }
        else {
          var n = parseFloat(rating.replace(',', '.'));
          if (isNaN(n) || n < 0 || n > 10) { out.errors.push(L + tr('the rating must be a number from 0 to 10.')); return; }
          row.strength = Math.round(n); row.detail = row.strength + '/10';
        }
        if (seen[key] || (issue && db.entries.some(function (e) { return e.issueId === issue.id && e.start === date; }))) { out.skipped++; return; }
        if (!issue && !newSeen[low]) { newSeen[low] = 1; out.newIssues.push(name); }
      }
      seen[key] = 1;
      out.rows.push(row);
    });
    return out;
  }
  function commitNotes(rows) {
    var addedE = [], addedI = [], addedP = [], created = {};
    rows.forEach(function (r) {
      if (r.kind === 'period') { db.periodStarts.push(r.date); addedP.push(r.date); return; }
      var issueId = r.issueId;
      if (!issueId) {
        var k = r.name.toLowerCase();
        if (!created[k]) { var t = ISSUE_TILES[0], ni = { id: uid(), name: r.name, kind: 'custom', icon: t[0], tile: t[1] }; db.issues.push(ni); addedI.push(ni.id); created[k] = ni.id; }
        issueId = created[k];
      }
      var impIss = issueById(issueId); if (impIss && impIss.hidden) impIss.hidden = false;
      var issue = issueById(issueId);
      var draft = { strength: r.strength, bristol: r.bristol, noPoo: r.noPoo, bloat: r.strength <= 3 ? 1 : r.strength <= 6 ? 2 : 3 };
      var e = { id: uid(), issueId: issueId, start: r.date, end: r.date, level: levelFor(issue, draft), note: r.note || '' };
      if (issue.kind === 'poop') { if (r.noPoo) e.noPoo = true; else e.bristol = r.bristol; }
      else if (issue.kind === 'bloat') e.bloat = draft.bloat;
      else { e.strength = r.strength; e.scale = 10; }
      db.entries.push(e); addedE.push(e.id);
    });
    db.periodStarts.sort(); save();
    return function () {
      db.entries = db.entries.filter(function (x) { return addedE.indexOf(x.id) === -1; });
      db.issues = db.issues.filter(function (x) { return addedI.indexOf(x.id) === -1; });
      db.periodStarts = db.periodStarts.filter(function (x) { return addedP.indexOf(x) === -1; });
      save(); render();
    };
  }
  var AI_PROMPT = [
    'Convert my personal health notes into plain text lines for an import tool. Output only the lines in a code block, nothing else. One entry per line, in this exact format:',
    'date, what, rating, note',
    'Rules:',
    '- date: always a full date with the year, like 2025-10-12.',
    '- what: use "period" for the first day of a period, "poo" for a bowel movement, otherwise a short issue name such as "back pain", "cystitis", "gut issues" or "migraine". Use the same name every time for the same issue.',
    '- rating: for "period" leave it empty. For "poo" use the Bristol stool type from 1 to 7, or "none" if I did not poo. For anything else use a pain or strength number from 0 to 10 (0 = none, 10 = worst ever). If my notes give no number, estimate it from my words and tell me which lines you guessed.',
    '- note: optional short free text. It may contain commas.',
    '- One line per day per issue. If a day has no year in my notes, ask me which year it is.',
    'Example:',
    '2025-10-12, period',
    '2025-10-12, back pain, 6, after gym',
    '2025-10-13, poo, 4',
    '2025-10-14, poo, none',
    'My notes:'
  ].join('\n');
  function viewImportNotes() {
    var r = ui.imp;
    var h = banner('Settings', 'Import data', 'settings') +
      '<button class="btn secondary" data-act="copyPrompt">' + tr('Copy a prompt for an AI') + '</button>' +
      '<label class="btn secondary" style="display:block;text-align:center;cursor:pointer">' + tr('Choose a file') + '<input type="file" id="notesFile" accept=".txt,.csv,.tsv,text/plain,text/csv" style="display:none"></label>' +
      '<button class="btn secondary" data-act="import">' + tr('Restore from backup') + '</button>';
    if (r) {
      h += '<div class="card" style="margin-top:14px"><h2>' + (r.rows.length ? tn('{n} entry ready to import', '{n} entries ready to import', r.rows.length) : tr('Nothing to import yet')) + '</h2>';
      if (r.rows.length) {
        h += '<div class="hist">' + r.rows.slice(0, 8).map(function (x) { return '<div class="note-item"><small>' + shortDate(x.date) + '</small>' + esc(x.label) + (x.detail ? ' · ' + esc(x.detail) : '') + '</div>'; }).join('') + '</div>';
        if (r.rows.length > 8) h += '<p class="muted">' + tr('and {n} more', { n: r.rows.length - 8 }) + '</p>';
      }
      if (r.newIssues.length) h += '<p class="muted" style="margin-top:8px">' + tr('New issues will be added: ') + esc(r.newIssues.join(', ')) + '</p>';
      if (r.skipped) h += '<p class="muted" style="margin-top:8px">' + tr('{n} skipped because you already have them.', { n: r.skipped }) + '</p>';
      if (r.errors.length) h += '<p style="margin-top:10px;color:#B3362A;font-weight:700">' + tn('{n} line could not be read:', '{n} lines could not be read:', r.errors.length) + '</p><ul class="know">' + r.errors.slice(0, 8).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' + (r.errors.length > 8 ? '<p class="muted">' + tr('and {n} more', { n: r.errors.length - 8 }) + '</p>' : '');
      h += '</div>';
      if (r.rows.length) h += '<button class="btn" data-act="impGo">' + tn('Import {n} entry', 'Import {n} entries', r.rows.length) + '</button>';
    }
    return h;
  }

  function render() {
    var v = ui.view, html;
    if (v === 'today') html = viewToday();
    else if (v === 'patterns') html = viewPatterns();
    else if (v === 'eat') html = viewEat();
    else if (v === 'learn') html = viewLearn();
    else if (v === 'hormones') html = viewHormones();
    else if (v === 'importNotes') html = viewImportNotes();
    else if (v === 'log') html = viewLog();
    else if (v === 'issue') html = viewIssue();
    else if (v === 'addPick') html = viewAddPick();
    else if (v === 'addIssue') html = viewAddIssue();
    else if (v === 'history') html = viewHistory();
    else html = viewSettings();
    app.className = (v === 'today' ? 'today ' : '') + ((v === 'today' || v === 'patterns' || v === 'eat' || v === 'learn' || v === 'hormones' || v === 'settings') ? '' : 'noNav');
    app.innerHTML = html;
  }

  /* ---------- Actions ---------- */
  function addPeriodStart(dateIso, withUndo) {
    if (db.periodStarts.indexOf(dateIso) !== -1) { toast(tr('A period start is already logged for that day.')); return false; }
    db.periodStarts.push(dateIso); db.periodStarts.sort(); save();
    toast(tr('Period start logged for {d}', { d: shortDate(dateIso) }), withUndo ? function () {
      db.periodStarts = db.periodStarts.filter(function (s) { return s !== dateIso; }); save(); render();
    } : null);
    return true;
  }
  function newDraft(issue) {
    var t = todayIso();
    return { issueId: issue.id, where: null, strength: 5, bloat: 2, bristol: 4, noPoo: false, symptoms: [], time: '', durMin: '', start: t, end: t, ongoing: false, note: '', calMonth: t.slice(0, 7) };
  }

  var actions = {
    reorder: function () { ui.reorder = !ui.reorder; render(); },
    addPick: function () { go('addPick'); },
    hide: function (el) {
      var iss = issueById(el.getAttribute('data-id')); if (!iss) return;
      iss.hidden = true; save(); render();
      toast(tr('Taken off your list: {name}', { name: iname(iss) }), function () { iss.hidden = false; save(); render(); });
    },
    unhide: function (el) {
      var iss = issueById(el.getAttribute('data-id')); if (!iss) return;
      iss.hidden = false;
      db.issues = db.issues.filter(function (x) { return x !== iss; }); db.issues.push(iss); db.customOrder = true; save(); render();
      toast(tr('{name} added', { name: iname(iss) }), function () { iss.hidden = true; save(); render(); });
    },
    copyPrompt: function () {
      var done = function () { toast(tr('Prompt copied. Paste it into an AI, then add your notes.')); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(AI_PROMPT).then(done, function () { window.prompt(tr('Copy this prompt:'), AI_PROMPT); });
      else window.prompt(tr('Copy this prompt:'), AI_PROMPT);
    },
    importNotes: function () { ui.imp = null; ui.impText = ""; go("importNotes"); },
    eatMore: function () { ui.eatMore = !ui.eatMore; render(); },
impGo: function () {
  var r = ui.imp; if (!r || !r.rows.length) return;
  var undo = commitNotes(r.rows), n = r.rows.length;
  ui.imp = null; ui.impText = ""; go("today"); toast(tn('{n} entry imported', '{n} entries imported', n), undo);
},
    hormones: function () { ui.hSel = null; go('hormones'); },
    moonDay: function (el) {
      var d = +el.getAttribute('data-d');
      ui.dayPick = ui.dayPick === d ? null : d; render();
    },
    chart: function (el, ev) {
      var info = cycleInfo(todayIso()); if (!info) return;
      var r = el.getBoundingClientRect(), W = 340, H = 114, x0 = 4, x1 = W - 4, yb = 76, yt = 10, cl = info.cl, od = cl - 14;
      var vx = (ev.clientX - r.left) * W / r.width, vy = (ev.clientY - r.top) * H / r.height;
      var t0 = 1 + (vx - x0) / (x1 - x0) * (cl - 1), best = null, bd = 1e9;
      HORMONES.forEach(function (hm) {
        for (var dt = -1.5; dt <= 1.5; dt += 0.25) {
          var t = Math.min(cl, Math.max(1, t0 + dt)), px = x0 + (t - 1) / (cl - 1) * (x1 - x0), py = yb - hm.f(t, od) * (yb - yt);
          var d = Math.sqrt((px - vx) * (px - vx) + (py - vy) * (py - vy));
          if (d < bd) { bd = d; best = hm.key; }
        }
      });
      ui.hSel = bd <= 16 && best !== ui.hSel ? best : null; render();
    },
    hormone: function (el) { var k = el.getAttribute('data-k'); ui.hSel = ui.hSel === k ? null : k; render(); },
    learn: function (el) { go('learn', { learnKind: el.getAttribute('data-k') }); },
    go: function (el) { go(el.getAttribute('data-v')); },
    firstStart: function () {
      var v = document.getElementById('firstStart').value;
      if (!v || v > todayIso()) { toast(tr('Pick a date that is today or earlier.')); return; }
      db.periodStarts.push(v); save(); render();
    },
    pick: function (el) {
      var id = el.getAttribute('data-id'), issue = issueById(id);
      if (!issue) {
        var p = PRESETS.filter(function (x) { return x.id === id; })[0];
        if (!p) return;
        issue = JSON.parse(JSON.stringify(p)); db.issues.push(issue); save();
      }
      if (issue.kind === 'period') {
        if (addPeriodStart(todayIso(), true)) go('today');
      } else if (issue.kind === 'tap') {
        var e = { id: uid(), issueId: issue.id, start: todayIso(), end: todayIso(), level: 2, note: '' };
        db.entries.push(e); save(); go('today');
        toast(tr('{name} logged for today', { name: iname(issue) }), function () { db.entries = db.entries.filter(function (x) { return x.id !== e.id; }); save(); render(); });
      } else {
        go('issue', { draft: newDraft(issue) });
      }
    },
    where: function (el) { var w = el.getAttribute('data-w'); ui.draft.where = ui.draft.where === w ? null : w; render(); },
    strength: function (el) { ui.draft.strength = +el.getAttribute('data-n'); render(); },
    bloat: function (el) { ui.draft.bloat = +el.getAttribute('data-n'); render(); },
    bristol: function (el) { ui.draft.bristol = +el.getAttribute('data-n'); render(); },
    month: function (el) {
      var p = ui.draft.calMonth.split('-'), d = new Date(+p[0], +p[1] - 1 + (+el.getAttribute('data-n')), 1);
      ui.draft.calMonth = d.getFullYear() + '-' + pad(d.getMonth() + 1); render();
    },
    day: function (el) {
      var d = ui.draft, ds = el.getAttribute('data-d');
      if (d.start && d.end === d.start && !d.ongoing && ds > d.start && d.pickingEnd) { d.end = ds; d.pickingEnd = false; }
      else { d.start = ds; d.end = ds; d.ongoing = false; d.pickingEnd = true; }
      render();
    },
    toggleCal: function () { ui.draft.showCal = !ui.draft.showCal; render(); },
    saveEntry: function () {
      var d = ui.draft, issue = issueById(d.issueId);
      var e = { id: uid(), issueId: issue.id, start: d.start, end: d.ongoing ? null : (d.end || d.start), level: levelFor(issue, d), note: (d.note || '').trim() };
      if (d.where) e.where = d.where;
      if (issue.kind === 'gut' && !d.symptoms.length) { toast(tr('Pick at least one symptom.')); return; }
      if (issue.kind === 'pain' || issue.kind === 'custom' || issue.kind === 'gut' || issue.kind === 'seizure') { e.strength = d.strength; e.scale = 10; }
      if (issue.kind === 'seizure') {
        if (d.time) e.time = d.time;
        var secs = Math.max(0, Math.floor(+d.durMin || 0)) * 60;
        if (secs > 0) e.durationSec = secs;
      }
      if (issue.kind === 'gut') e.symptoms = d.symptoms.slice();
      if (issue.kind === 'bloat') e.bloat = d.bloat;
      if (issue.kind === 'poop') { if (d.noPoo) e.noPoo = true; else e.bristol = d.bristol; }
      db.entries.push(e); save(); go('today');
      toast(tr('{name} saved', { name: iname(issue) }), function () { db.entries = db.entries.filter(function (x) { return x.id !== e.id; }); save(); render(); });
    },
    history: function (el) { go('history', { histFrom: el.getAttribute('data-from') || 'patterns' }); },
    delEntry: function (el) {
      var id = el.getAttribute('data-id'), e = db.entries.filter(function (x) { return x.id === id; })[0];
      if (!e) return;
      db.entries = db.entries.filter(function (x) { return x.id !== id; }); save(); render();
      toast(tr('Entry deleted'), function () { db.entries.push(e); save(); render(); });
    },
    delPeriod: function (el) {
      var d = el.getAttribute('data-d');
      db.periodStarts = db.periodStarts.filter(function (s) { return s !== d; }); save(); render();
      toast(tr('Period start deleted'), function () { db.periodStarts.push(d); db.periodStarts.sort(); save(); render(); });
    },
    addPreset: function (el) {
      var p = PRESETS.filter(function (x) { return x.id === el.getAttribute('data-id'); })[0];
      if (!p || issueById(p.id)) return;
      db.issues.push(JSON.parse(JSON.stringify(p))); save(); go('log'); toast(tr('{name} added', { name: tr(p.name) }));
    },
    noPoo: function () { ui.draft.noPoo = !ui.draft.noPoo; render(); },
    symptom: function (el) {
      var s = el.getAttribute('data-s'), a = ui.draft.symptoms, i = a.indexOf(s);
      if (i === -1) a.push(s); else a.splice(i, 1); render();
    },
    addIssue: function () { go('addIssue', { draft: { name: '', tileIdx: 0 } }); },
    tile: function (el) { ui.draft.tileIdx = +el.getAttribute('data-n'); render(); var n = document.querySelector('[data-input=name]'); },
    saveIssue: function () {
      var name = (ui.draft.name || '').trim();
      if (!name) { toast(tr('Give it a name first.')); return; }
      var t = ISSUE_TILES[ui.draft.tileIdx];
      db.issues.push({ id: uid(), name: name, kind: 'custom', icon: t[0], tile: t[1] }); save(); go('log');
    },
    patIssue: function (el) { ui.patIssue = el.getAttribute('data-id') || null; render(); },
    patCycle: function () { ui.patCycle = !ui.patCycle; render(); },
    patMonth: function (el) { ui.patMonth = shiftMonth(ui.patMonth || todayIso().slice(0, 7), +el.getAttribute('data-n')); render(); },
    step: function (el) {
      var k = el.getAttribute('data-k'), n = +el.getAttribute('data-n'), lim = k === 'cycleLength' ? [21, 45] : [2, 10];
      db.settings[k] = Math.min(lim[1], Math.max(lim[0], db.settings[k] + n)); save(); render();
    },
    bc: function (el) { db.settings.birthControl = el.getAttribute('data-v'); ui.bcOpen = false; save(); render(); },
    bcToggle: function () { ui.bcOpen = !ui.bcOpen; render(); },
    saveLastStart: function () {
      var v = document.getElementById('lastStart').value;
      if (!v || v > todayIso()) { toast(tr('Pick a date that is today or earlier.')); return; }
      var latest = db.periodStarts.slice().sort().pop();
      if (v === latest) { toast(tr('That is already your last period start.')); return; }
      // Replace the most recent start with the new date (this is a correction, not a new period).
      db.periodStarts = db.periodStarts.filter(function (s) { return s !== latest && s !== v; });
      db.periodStarts.push(v); db.periodStarts.sort(); save();
      toast(tr('Last period start set to {d}', { d: shortDate(v) })); render();
    },
    export: function () {
      var blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'body-tracker-backup-' + todayIso() + '.json';
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    },
    import: function () { document.getElementById('importFile').click(); },
    wipe: function () {
      if (window.confirm(tr('Delete all your data from this device? This cannot be undone.'))) { db = defaultDb(); save(); go('today'); toast(tr('All data deleted')); }
    },
    setLang: function (el) {
      var l = el.getAttribute('data-l');
      if (l !== 'en' && l !== 'it') return;
      try { localStorage.setItem(LANG_KEY, l); } catch (e) { /* ignore */ }
      applyLang(l); render();
    },
    undo: function () { if (toastUndo) { toastUndo(); toastUndo = null; } document.getElementById('toast').className = ''; }
  };

  document.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-act]');
    if (el && actions[el.getAttribute('data-act')]) actions[el.getAttribute('data-act')](el, ev);
  });
  document.addEventListener('input', function (ev) {
    if (ev.target.getAttribute && ev.target.getAttribute('data-range') === 'strength' && ui.draft) {
      // Update in place (no re-render) so dragging the slider stays smooth.
      var v = +ev.target.value;
      ui.draft.strength = v;
      var bub = document.getElementById('bubble'), lab = document.getElementById('strengthLabel');
      if (bub) { bub.textContent = v; bub.style.setProperty('--v', v); }
      if (lab) lab.textContent = strengthWord(v);
      return;
    }
    var k = ev.target.getAttribute && ev.target.getAttribute('data-input');
    if (k && ui.draft) ui.draft[k] = ev.target.value;
  });
  document.addEventListener('change', function (ev) {
    if (!ev.target || ev.target.id !== 'notesFile') return;
    var f = ev.target.files && ev.target.files[0]; if (!f) return;
    var rd = new FileReader();
    rd.onload = function () { ui.impText = String(rd.result || ''); ui.imp = parseNotes(ui.impText); render(); };
    rd.readAsText(f);
  });
  document.getElementById('importFile').addEventListener('change', function (ev) {
    var f = ev.target.files[0]; if (!f) return;
    var r = new FileReader();
    r.onload = function () {
      try {
        var s = JSON.parse(r.result);
        if (!(s && s.settings && s.issues && s.entries && s.periodStarts)) throw new Error('bad');
        if (window.confirm(tr('Replace the data on this device with this backup?'))) { db = s; save(); go('today'); toast(tr('Backup restored')); }
      } catch (e) { toast(tr('That file is not a Body tracker backup.')); }
      ev.target.value = '';
    };
    r.readAsText(f);
  });

  render();
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(function () { /* offline support is optional */ });
  }
  /* Ask the browser to keep this data permanently (it may decline; that is fine). */
  try {
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(function () {});
    }
  } catch (e) { /* optional */ }
})();
