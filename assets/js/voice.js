/* ============================================================
   voice.js — Voice-first data entry engine
   ------------------------------------------------------------
   Works alongside the keyboard, never instead of it.

   Modes
     guided : walks the form field by field, prompts aloud, waits
     free   : say "<field name> <value>" in any order, any time

   Understands
     text · names · phone/Aadhaar digits · numbers & marks
     dates ("twelfth March two thousand ten") · selects · radios
     checkboxes (yes/no) · spelling mode ("spell K A R T H I K")

   Commands
     next · back · skip · repeat · clear · undo · save · cancel
     "go to <page>" · "select <option>" · "spell ..." · "stop"

   Fallback
     If the browser has no Web Speech API (Firefox/Safari), the dock
     turns into a typed command console driving the identical parser,
     so every feature stays demonstrable.
   ============================================================ */

const Voice = (() => {

  /* ────────────────────────── language packs ───────────────────────── */
  const LANGS = {
    'en-IN': { name: 'English', code: 'en-IN', tts: 'en-IN' },
    'ta-IN': { name: 'தமிழ்',   code: 'ta-IN', tts: 'ta-IN' }
  };

  const CMD = {
    next:    ['next', 'next field', 'ok next', 'continue', 'அடுத்து', 'அடுத்தது'],
    back:    ['back', 'previous', 'go back', 'previous field', 'பின்னால்', 'முந்தைய'],
    skip:    ['skip', 'skip this', 'leave blank', 'விடு', 'தவிர்'],
    repeat:  ['repeat', 'say again', 'what', 'pardon', 'மீண்டும்'],
    clear:   ['clear', 'clear this', 'erase', 'delete this', 'wrong', 'அழி', 'நீக்கு'],
    undo:    ['undo', 'undo that', 'go back one', 'செயல்தவிர்'],
    save:    ['save', 'submit', 'save it', 'save this', 'save form', 'சேமி', 'சேமிக்கவும்'],
    cancel:  ['cancel', 'close', 'close this', 'discard', 'ரத்து', 'மூடு'],
    stop:    ['stop', 'stop listening', 'quiet', 'mute', 'நிறுத்து'],
    help:    ['help', 'what can i say', 'commands', 'உதவி'],
    read:    ['read back', 'read it back', 'summary', 'படி']
  };

  /* ───────────────────────── number vocabulary ─────────────────────── */
  const NUM_WORDS = {
    zero:0, oh:0, o:0, nought:0, one:1, won:1, two:2, to:2, too:2, three:3, four:4, for:4, five:5,
    six:6, seven:7, eight:8, ate:8, nine:9, ten:10, eleven:11, twelve:12, thirteen:13,
    fourteen:14, fifteen:15, sixteen:16, seventeen:17, eighteen:18, nineteen:19,
    twenty:20, thirty:30, forty:40, fourty:40, fifty:50, sixty:60, seventy:70, eighty:80, ninety:90,
    // Tamil
    'பூஜ்யம்':0, 'ஒன்று':1, 'இரண்டு':2, 'மூன்று':3, 'நான்கு':4, 'ஐந்து':5,
    'ஆறு':6, 'ஏழு':7, 'எட்டு':8, 'ஒன்பது':9, 'பத்து':10
  };
  const SCALES = { hundred:100, thousand:1000, lakh:100000, lakhs:100000, crore:10000000, crores:10000000 };
  const ORDINALS = {
    first:1, second:2, third:3, fourth:4, fifth:5, sixth:6, seventh:7, eighth:8, ninth:9, tenth:10,
    eleventh:11, twelfth:12, thirteenth:13, fourteenth:14, fifteenth:15, sixteenth:16,
    seventeenth:17, eighteenth:18, nineteenth:19, twentieth:20, thirtieth:30
  };
  const MONTH_WORDS = {
    january:1, jan:1, february:2, feb:2, march:3, mar:3, april:4, apr:4, may:5,
    june:6, jun:6, july:7, jul:7, august:8, aug:8, september:9, sep:9, sept:9,
    october:10, oct:10, november:11, nov:11, december:12, dec:12,
    'ஜனவரி':1, 'பிப்ரவரி':2, 'மார்ச்':3, 'ஏப்ரல்':4, 'மே':5, 'ஜூன்':6,
    'ஜூலை':7, 'ஆகஸ்ட்':8, 'செப்டம்பர்':9, 'அக்டோபர்':10, 'நவம்பர்':11, 'டிசம்பர்':12
  };
  const YES = ['yes','yeah','yep','correct','true','right','ok','okay','tick','check','ஆம்','சரி'];
  const NO  = ['no','nope','false','wrong','uncheck','untick','இல்லை'];

  /* Spoken shorthands common in TN school offices */
  const PHRASE_FIX = [
    [/\bstd\b/g, 'standard'], [/\bd\.?o\.?b\.?\b/gi, 'date of birth'],
    [/\bs\/o\b/gi, 'son of'], [/\bd\/o\b/gi, 'daughter of'],
    [/\bm\.?b\.?c\.?\b/gi, 'mbc'], [/\bb\.?c\.?m\.?\b/gi, 'bcm'],
    [/\bs\.?c\.?\b/gi, 'sc'], [/\bs\.?t\.?\b/gi, 'st'], [/\bo\.?c\.?\b/gi, 'oc']
  ];

  /* ───────────────────────────── helpers ───────────────────────────── */
  const norm = s => String(s || '').toLowerCase()
    .replace(/[.,!?;:"'`]/g, ' ')
    .replace(/\s+/g, ' ').trim();

  const titleCase = s => s.replace(/\S+/g, w =>
    w.length <= 2 && /^[a-z]+$/i.test(w) ? w.toUpperCase()
      : w[0].toUpperCase() + w.slice(1).toLowerCase());

  /** Convert an English number phrase to an integer. Returns null if none. */
  function wordsToNumber(text) {
    const t = norm(text);
    if (/^\d+$/.test(t.replace(/\s/g, ''))) return parseInt(t.replace(/\s/g, ''), 10);
    const words = t.split(' ');
    let total = 0, current = 0, seen = false;
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (w === 'and' || w === 'a') continue;
      if (w === 'double' || w === 'triple') {
        const n = NUM_WORDS[words[i + 1]] ?? (/^\d$/.test(words[i + 1]) ? +words[i + 1] : null);
        if (n === null) continue;
        const rep = w === 'double' ? 2 : 3;
        current = current * Math.pow(10, rep) + Number(String(n).repeat(rep));
        seen = true; i++; continue;
      }
      if (w in NUM_WORDS) { current += NUM_WORDS[w]; seen = true; continue; }
      if (w in ORDINALS)  { current += ORDINALS[w];  seen = true; continue; }
      if (w in SCALES) {
        const s = SCALES[w];
        if (s === 100) current = (current || 1) * 100;
        else { total += (current || 1) * s; current = 0; }
        seen = true; continue;
      }
      if (/^\d+$/.test(w)) { current += parseInt(w, 10); seen = true; continue; }
      return seen ? total + current : null;
    }
    return seen ? total + current : null;
  }

  /** Convert a spoken digit string to digits only: "nine eight four three" → "9843" */
  function digitsOnly(text) {
    const t = norm(text);
    let out = '';
    const words = t.split(' ');
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (/^\d+$/.test(w)) { out += w; continue; }
      if (w === 'double' || w === 'triple') {
        const n = NUM_WORDS[words[i + 1]] ?? (/^\d$/.test(words[i + 1]) ? +words[i + 1] : null);
        if (n !== null) { out += String(n).repeat(w === 'double' ? 2 : 3); i++; }
        continue;
      }
      if (w in NUM_WORDS && NUM_WORDS[w] < 10) { out += NUM_WORDS[w]; continue; }
      if (w in NUM_WORDS) { out += NUM_WORDS[w]; continue; }
    }
    return out;
  }

  /** Parse a spoken date into yyyy-mm-dd. */
  function parseDate(text) {
    let t = norm(text).replace(/\bof\b|\bthe\b|\bon\b/g, ' ').replace(/\s+/g, ' ').trim();

    // numeric forms: 12/03/2010, 12-3-2010, 12 03 2010
    const numeric = t.match(/(\d{1,2})\s*[\/\-\s]\s*(\d{1,2})\s*[\/\-\s]\s*(\d{2,4})/);
    if (numeric) {
      let [, d, m, y] = numeric;
      y = +y < 100 ? (+y > 30 ? 1900 + +y : 2000 + +y) : +y;
      return iso(y, +m, +d);
    }
    // yyyy-mm-dd spoken back
    const isoM = t.match(/(\d{4})\s*[\-\/]\s*(\d{1,2})\s*[\-\/]\s*(\d{1,2})/);
    if (isoM) return iso(+isoM[1], +isoM[2], +isoM[3]);

    // word forms: "twelfth march two thousand ten" / "march 12 2010" / "12 march 2010"
    let month = null, day = null, year = null;
    const rest = [];
    t.split(' ').forEach(w => {
      if (month === null && w in MONTH_WORDS) { month = MONTH_WORDS[w]; return; }
      rest.push(w);
    });
    if (month === null) return null;

    /* Split what is left into independent number chunks. A bare digit token and an
       ordinal each terminate a chunk, so "12 2010" stays two numbers rather than
       collapsing into 2022, and "twenty fifth" stays one number (25). */
    const chunks = [];
    let buf = [];
    const flush = () => { if (buf.length) { chunks.push(buf.join(' ')); buf = []; } };
    rest.forEach(w => {
      if (/^\d+$/.test(w)) { flush(); chunks.push(w); return; }
      if (w in ORDINALS) { buf.push(w); flush(); return; }
      if (w in NUM_WORDS || w in SCALES) { buf.push(w); return; }
      flush();
    });
    flush();

    chunks.forEach(chunk => {
      const n = wordsToNumber(chunk);
      if (n === null) return;
      if (/^\d{4}$/.test(chunk) || n >= 1000) { if (year === null) year = n; return; }
      if (n >= 1 && n <= 31 && day === null) { day = n; return; }
      if (n > 31 && n < 100 && year === null) year = n > 30 ? 1900 + n : 2000 + n;
    });

    // "twenty ten" style year — wordsToNumber sums it to 30, so read it explicitly
    if (year === null) {
      const twenty = t.match(/\btwenty\s+([a-z]+)\b/);
      const n = twenty ? wordsToNumber(twenty[1]) : null;
      if (n !== null && n < 100) year = 2000 + n;
    }
    if (!day || !year || month < 1 || month > 12 || day > 31) return null;
    return iso(year, month, day);
  }
  const iso = (y, m, d) =>
    `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  /* ---------- how an option is actually said aloud ----------
     Nobody says “standard X” or “blood group O plus sign”. Expand each option
     into the forms a Tamil Nadu school office would speak. */
  const ROMAN = { I:1, II:2, III:3, IV:4, V:5, VI:6, VII:7, VIII:8, IX:9, X:10, XI:11, XII:12 };
  const CARDINAL = ['', 'one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve'];
  const ORDINAL_NAME = ['', 'first','second','third','fourth','fifth','sixth','seventh','eighth','ninth','tenth','eleventh','twelfth'];

  function spokenForms(text) {
    const raw = String(text || '').trim();
    const out = [norm(raw)];
    const up = raw.toUpperCase();

    if (up in ROMAN) {
      const n = ROMAN[up];
      out.push(String(n), CARDINAL[n], ORDINAL_NAME[n],
               'standard ' + CARDINAL[n], 'class ' + CARDINAL[n]);
      if (n === 11) out.push('plus one', 'eleventh standard');
      if (n === 12) out.push('plus two', 'twelfth standard');
    }
    const bg = up.match(/^(AB|A|B|O)\s*([+-])$/);
    if (bg) {
      const letter = bg[1].toLowerCase();
      const sign = bg[2] === '+' ? 'positive' : 'negative';
      const alt  = bg[2] === '+' ? 'plus' : 'minus';
      out.push(`${letter} ${sign}`, `${letter}${sign}`, `${letter} ${alt}`);
      if (letter === 'ab') out.push(`a b ${sign}`, `a b ${alt}`);
    }
    return [...new Set(out.filter(Boolean))];
  }

  /** Similarity 0..1 between two normalised strings. */
  function score(a, b) {
    if (a === b) return 1;
    if (!a || !b) return 0;
    if (b.startsWith(a) || a.startsWith(b)) return .92;
    if (b.includes(a) || a.includes(b)) return .8;
    const A = new Set(a.split(' ')), B = new Set(b.split(' '));
    let hit = 0; A.forEach(w => { if (B.has(w)) hit++; });
    if (!hit) return 0;
    return hit / Math.max(A.size, B.size) * .78;
  }

  /* ─────────────────────────── the engine ──────────────────────────── */
  const V = {
    supported: !!(window.SpeechRecognition || window.webkitSpeechRecognition),
    active: false,
    mode: 'free',              // 'free' | 'guided'
    lang: Store.get('voiceLang', 'en-IN'),
    speakPrompts: Store.get('voiceTTS', true),
    rec: null,
    speaking: false,
    container: null,           // form / section currently attached
    fields: [],
    idx: -1,
    undoStack: [],
    navMap: {},                // "attendance" -> route id
    onCommand: null,           // page hook: fn(text) -> true if handled
    onSave: null,              // page hook for "save"
    onCancel: null,
    log: [],

    /* ---------- lifecycle ---------- */
    init() {
      this.buildDock();
      if (this.supported) {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        this.rec = new SR();
        this.rec.continuous = true;
        this.rec.interimResults = true;
        this.rec.maxAlternatives = 3;
        this.rec.lang = this.lang;

        this.rec.onresult = e => {
          if (this.speaking) return;
          let interim = '';
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const r = e.results[i];
            if (r.isFinal) {
              const alts = [];
              for (let j = 0; j < r.length; j++) alts.push(r[j].transcript);
              this.handle(alts[0].trim(), alts, r[0].confidence);
            } else interim += r[0].transcript;
          }
          if (interim) this.showInterim(interim);
        };
        this.rec.onerror = e => {
          if (e.error === 'no-speech' || e.error === 'aborted') return;
          if (e.error === 'not-allowed') {
            this.stop();
            this.setStatus('Microphone blocked — allow access in the address bar', 'err');
            toast('Microphone permission denied. Use the typed command box instead.', 'err', 5000);
            this.showConsole(true);
          } else this.setStatus('Recogniser: ' + e.error, 'err');
        };
        this.rec.onend = () => { if (this.active) { try { this.rec.start(); } catch {} } };
      } else {
        this.showConsole(true);
      }

      addEventListener('keydown', e => {
        if (e.ctrlKey && e.shiftKey && (e.key === 'V' || e.key === 'v')) {
          e.preventDefault();
          this.container ? this.startGuided() : this.toggle();
        }
        if (e.ctrlKey && e.shiftKey && (e.key === 'M' || e.key === 'm')) {
          e.preventDefault(); this.toggle();
        }
      });
      return this;
    },

    /* ---------- attach a form ---------- */
    attach(container, opts = {}) {
      this.container = container;
      this.onSave = opts.onSave || null;
      this.onCancel = opts.onCancel || null;
      this.scan();
      this.renderFieldList();
      if (this.fields.length) {
        this.dock.classList.add('open');
        this.setStatus(`${this.fields.length} fields ready for voice — press Ctrl+Shift+V for guided entry`, '');
      } else {
        this.setStatus(opts.hint || 'Press the microphone and speak a command.', '');
      }
      return this;
    },
    detach() {
      this.clearHighlight();
      this.container = null; this.fields = []; this.idx = -1;
      this.onSave = this.onCancel = null;
      this.renderFieldList();
    },

    /** Build the field registry from the attached container. */
    scan() {
      if (!this.container) { this.fields = []; return; }
      const els = [...this.container.querySelectorAll('[data-v]')].filter(isUsable);
      this.fields = els.map(el => {
        const labelEl = el.closest('.field')?.querySelector('label')
          || (el.id ? this.container.querySelector(`label[for="${el.id}"]`) : null);
        const label = (labelEl?.textContent || el.name || el.id || 'field').replace(/\*/g, '').trim();
        const aliases = [
          ...String(el.dataset.v || '').split('|'),
          label, el.name, el.placeholder
        ].map(norm).filter(Boolean);
        const taAliases = String(el.dataset.vTa || '').split('|').map(s => s.trim()).filter(Boolean);
        return {
          el, label,
          aliases: [...new Set([...aliases, ...taAliases])],
          kind: kindOf(el),
          options: el.tagName === 'SELECT'
            ? [...el.options].filter(o => o.value !== '').map(o => ({ value: o.value, text: o.textContent.trim() }))
            : []
        };
      });
    },

    /* ---------- start / stop ---------- */
    toggle() { this.active ? this.stop() : this.start(); },

    start(mode) {
      if (mode) this.mode = mode;
      if (!this.supported) {
        this.showConsole(true);
        document.getElementById('vConsoleIn')?.focus();
        toast('This browser has no speech recognition — type commands instead.', 'warn', 4500);
        return;
      }
      this.active = true;
      this.rec.lang = this.lang;
      try { this.rec.start(); } catch {}
      this.dock.classList.add('listening', 'open');
      this.dock.classList.remove('minimised');
      this.setStatus(this.mode === 'guided' ? 'Guided entry — listening…' : 'Listening… say a field name and its value', 'live');
      this.paintMic();
    },

    stop() {
      this.active = false;
      this.mode = 'free';
      try { this.rec?.stop(); } catch {}
      this.dock.classList.remove('listening');
      this.clearHighlight();
      this.setStatus('Stopped. Press the mic or Ctrl+Shift+M to resume.', '');
      this.paintMic();
    },

    startGuided() {
      if (!this.container) { toast('Open a form first, then start guided entry.', 'warn'); return; }
      this.scan();
      if (!this.fields.length) { toast('No voice-enabled fields on this screen.', 'warn'); return; }
      this.mode = 'guided';
      this.idx = -1;
      this.start('guided');
      this.next();
    },

    /* ---------- guided navigation ---------- */
    next() {
      this.idx++;
      if (this.idx >= this.fields.length) {
        this.idx = this.fields.length - 1;
        this.clearHighlight();
        this.say('That is the last field. Say save to submit, or name any field to correct it.');
        this.setStatus('End of form — say “save”', 'ok');
        this.mode = 'free';
        return;
      }
      this.focusField(this.idx, true);
    },
    back() {
      this.idx = Math.max(0, this.idx - 1);
      this.focusField(this.idx, true);
    },

    focusField(i, prompt) {
      const f = this.fields[i];
      if (!f) return;
      this.clearHighlight();
      f.el.closest('.field')?.classList.add('v-active');
      f.el.focus({ preventScroll: true });
      f.el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      this.setCurrent(f);
      if (prompt) {
        let q = f.label;
        if (f.kind === 'select' && f.options.length)
          q += '. Options: ' + f.options.slice(0, 6).map(o => o.text).join(', ');
        if (f.kind === 'check') q += '? Say yes or no.';
        this.say(q);
      }
    },
    clearHighlight() {
      this.container?.querySelectorAll('.v-active').forEach(e => e.classList.remove('v-active'));
      this.setCurrent(null);
    },

    /* ---------- speech output ---------- */
    say(text, cb) {
      this.pushLog('prompt', text);
      if (!this.speakPrompts || !window.speechSynthesis) { cb?.(); return; }
      try {
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = LANGS[this.lang].tts;
        u.rate = 1.06; u.pitch = 1;
        this.speaking = true;
        const done = () => { this.speaking = false; cb?.(); };
        u.onend = done; u.onerror = done;
        speechSynthesis.speak(u);
        setTimeout(() => { if (this.speaking) done(); }, 6000);
      } catch { this.speaking = false; cb?.(); }
    },

    /* ═══════════════════ the parser — heart of the engine ═══════════════════ */
    handle(raw, alts = [], conf = 0) {
      if (!raw) return;
      let text = raw;
      PHRASE_FIX.forEach(([re, to]) => text = text.replace(re, to));
      const n = norm(text);
      this.pushLog('heard', raw, conf);
      this.showInterim('');

      /* 1 — global commands */
      const cmd = matchCommand(n);
      if (cmd) return this.runCommand(cmd, n);

      /* 2 — page-specific hook (roll call, search, filters…) */
      if (this.onCommand && this.onCommand(n, raw)) {
        this.setStatus('✓ ' + raw, 'ok');
        return;
      }

      /* 3 — navigation: "go to attendance" */
      const nav = n.match(/^(?:go to|open|show me|show|navigate to|take me to)\s+(.+)$/);
      if (nav) {
        const target = this.findRoute(nav[1]);
        if (target) { this.pushLog('did', 'Navigated to ' + target.label); location.hash = '#' + target.id; return; }
      }

      /* 4 — spelling mode: "spell k a r t h i k" */
      const sp = n.match(/^spell(?:ing)?\s+(.+)$/);
      if (sp) {
        const letters = sp[1].split(' ').filter(w => w.length === 1 || /^[a-z]$/.test(w)).join('');
        const f = this.fields[this.idx];
        if (f && letters) { this.setValue(f, titleCase(letters)); this.afterFill(f); }
        return;
      }

      /* 5 — "<field name> <value>" free targeting */
      const hit = this.matchField(n);
      if (hit && hit.confidence >= .55) {
        this.applyTo(hit.field, hit.rest, raw);
        return;
      }

      /* 6 — guided mode: the whole utterance is the value for the current field */
      if (this.mode === 'guided' && this.fields[this.idx]) {
        this.applyTo(this.fields[this.idx], text, raw);
        return;
      }

      /* 7 — a field is focused by keyboard/click: fill it */
      const focused = this.fields.find(f => f.el === document.activeElement);
      if (focused) { this.applyTo(focused, text, raw); return; }

      /* 8 — try lower-confidence field match before giving up */
      if (hit && hit.confidence >= .38) { this.applyTo(hit.field, hit.rest, raw); return; }

      this.setStatus(`Not understood: “${raw}”. Say a field name first, e.g. “student name Karthik”.`, 'warn');
      this.pushLog('miss', raw);
    },

    /** Find "<alias> <value>" inside an utterance. */
    matchField(n) {
      let best = null;
      this.fields.forEach(field => {
        field.aliases.forEach(alias => {
          if (!alias) return;
          // alias at the start of the utterance
          if (n.startsWith(alias + ' ') || n === alias) {
            const c = .6 + Math.min(.4, alias.length / 30);
            if (!best || c > best.confidence)
              best = { field, rest: n.slice(alias.length).trim(), confidence: c };
            return;
          }
          // "<alias> is <value>" / "<alias> as <value>"
          const m = n.match(new RegExp('^' + alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s+(?:is|as|equals|will be)\\s+(.+)$'));
          if (m) {
            const c = .75 + Math.min(.25, alias.length / 30);
            if (!best || c > best.confidence) best = { field, rest: m[1], confidence: c };
            return;
          }
          // fuzzy: alias words appear near the start
          const s = score(alias, n.split(' ').slice(0, alias.split(' ').length + 1).join(' '));
          if (s > .6) {
            const words = alias.split(' ').length;
            const c = s * .72;
            if (!best || c > best.confidence)
              best = { field, rest: n.split(' ').slice(words).join(' '), confidence: c };
          }
        });
      });
      return best;
    },

    /* ---------- write a value into a field ---------- */
    applyTo(field, value, raw) {
      value = String(value || '').trim();
      if (!value) { this.focusField(this.fields.indexOf(field), true); return; }
      const ok = this.setValue(field, value);
      if (ok === false) {
        this.setStatus(`Could not read “${raw}” as ${field.label}.`, 'warn');
        this.say('Sorry, say that again for ' + field.label);
        return;
      }
      this.afterFill(field);
    },

    setValue(field, spoken) {
      const el = field.el, prev = el.type === 'checkbox' ? el.checked : el.value;
      let v;

      switch (field.kind) {
        case 'date': {
          v = parseDate(spoken);
          if (!v) return false;
          break;
        }
        case 'digits': {
          const d = digitsOnly(spoken);
          if (!d) return false;
          v = el.maxLength > 0 ? d.slice(0, el.maxLength) : d;
          break;
        }
        case 'number': {
          const n = wordsToNumber(spoken);
          if (n === null) return false;
          if (el.max !== '' && n > +el.max) {
            this.setStatus(`${n} is above the maximum of ${el.max} for ${field.label}.`, 'warn');
            return false;
          }
          v = String(n);
          break;
        }
        case 'select': {
          const s = norm(spoken).replace(/\b(select|choose|set|it is|is)\b/g, '').replace(/\s+/g, ' ').trim();
          const tight = s.replace(/\s/g, '');
          let best = null;
          field.options.forEach(o => {
            let c = 0;
            [...spokenForms(o.text), ...spokenForms(o.value)].forEach(form => {
              c = Math.max(c, score(s, form), score(tight, form.replace(/\s/g, '')));
            });
            if (!best || c > best.c) best = { o, c };
          });
          if (!best || best.c < .5) return false;
          v = best.o.value;
          break;
        }
        case 'check': {
          const s = norm(spoken);
          if (YES.some(y => s.startsWith(y))) v = true;
          else if (NO.some(y => s.startsWith(y))) v = false;
          else return false;
          break;
        }
        case 'name':
          v = titleCase(norm(spoken).replace(/\b(is|the|my|name)\b/g, ' ').replace(/\s+/g, ' ').trim());
          if (!v) return false;
          break;
        default:
          v = spoken.replace(/^(is|it is|the)\s+/i, '').trim();
          v = v.charAt(0).toUpperCase() + v.slice(1);
      }

      this.undoStack.push({ el, prev, isCheck: field.kind === 'check' });
      if (field.kind === 'check') { el.checked = v; }
      else { el.value = v; }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      flash(el);
      this.pushLog('did', `${field.label} → ${field.kind === 'check' ? (v ? 'Yes' : 'No') : displayOf(field, v)}`);
      return true;
    },

    afterFill(field) {
      const el = field.el;
      const shown = field.kind === 'check' ? (el.checked ? 'Yes' : 'No') : displayOf(field, el.value);
      this.setStatus(`✓ ${field.label} → ${shown}`, 'ok');
      this.renderFieldList();
      if (this.mode === 'guided') {
        const i = this.fields.indexOf(field);
        if (i === this.idx) setTimeout(() => this.next(), 320);
        else this.focusField(this.idx, false);
      }
    },

    /* ---------- commands ---------- */
    runCommand(cmd, n) {
      switch (cmd) {
        case 'next':   this.mode = 'guided'; this.next(); break;
        case 'back':   this.mode = 'guided'; this.back(); break;
        case 'skip':   this.pushLog('did', 'Skipped ' + (this.fields[this.idx]?.label || '')); this.next(); break;
        case 'repeat': this.focusField(this.idx, true); break;
        case 'clear': {
          const f = this.fields[this.idx];
          if (f) {
            this.undoStack.push({ el: f.el, prev: f.el.value, isCheck: f.kind === 'check' });
            if (f.kind === 'check') f.el.checked = false; else f.el.value = '';
            f.el.dispatchEvent(new Event('input', { bubbles: true }));
            flash(f.el, true);
            this.pushLog('did', 'Cleared ' + f.label);
            this.setStatus('Cleared ' + f.label + ' — say it again.', 'warn');
            this.renderFieldList();
          }
          break;
        }
        case 'undo': {
          const u = this.undoStack.pop();
          if (!u) { this.setStatus('Nothing to undo.', 'warn'); break; }
          if (u.isCheck) u.el.checked = u.prev; else u.el.value = u.prev;
          u.el.dispatchEvent(new Event('input', { bubbles: true }));
          flash(u.el, true);
          this.pushLog('did', 'Undone');
          this.setStatus('Undone.', 'ok');
          this.renderFieldList();
          break;
        }
        case 'save':
          this.pushLog('did', 'Save requested');
          if (this.onSave) { this.say('Saving.'); this.onSave(); }
          else { const btn = this.container?.querySelector('[type=submit],.js-save'); btn ? btn.click() : this.setStatus('Nothing to save here.', 'warn'); }
          break;
        case 'cancel':
          this.pushLog('did', 'Cancelled');
          this.onCancel ? this.onCancel() : this.container?.querySelector('.js-cancel')?.click();
          break;
        case 'stop':  this.say('Stopping.'); setTimeout(() => this.stop(), 400); break;
        case 'help':  this.showHelp(); break;
        case 'read':  this.readBack(); break;
      }
    },

    readBack() {
      const filled = this.fields.filter(f => f.kind === 'check' ? f.el.checked : f.el.value);
      if (!filled.length) { this.say('Nothing filled in yet.'); return; }
      const text = filled.map(f => `${f.label}, ${f.kind === 'check' ? 'yes' : displayOf(f, f.el.value)}`).join('. ');
      this.say(text);
      this.setStatus('Read back ' + filled.length + ' fields.', 'ok');
    },

    findRoute(q) {
      const s = norm(q);
      let best = null;
      Object.entries(this.navMap).forEach(([id, label]) => {
        const c = Math.max(score(s, norm(label)), score(s, norm(id)));
        if (c > .5 && (!best || c > best.c)) best = { id, label, c };
      });
      return best;
    },
    registerNav(map) { this.navMap = map; },

    /* ═══════════════════════════ dock UI ═══════════════════════════ */
    buildDock() {
      const d = document.createElement('div');
      d.id = 'voiceDock';
      d.className = 'v-dock';
      d.innerHTML = `
        <button class="v-fab" id="vFab" title="Voice entry (Ctrl+Shift+M)">
          <span class="v-fab-ico">🎙</span>
          <span class="v-pulse"></span>
        </button>
        <div class="v-panel">
          <div class="v-head">
            <div class="row" style="gap:.5rem">
              <span class="v-wave"><i></i><i></i><i></i><i></i><i></i></span>
              <strong>Voice Entry</strong>
              <span class="badge badge-voice" id="vModeBadge">Free</span>
            </div>
            <div class="row" style="gap:.15rem">
              <button class="btn btn-quiet btn-icon" id="vHelpBtn" title="Commands">?</button>
              <button class="btn btn-quiet btn-icon" id="vMinBtn" title="Minimise">－</button>
            </div>
          </div>

          <div class="v-status" id="vStatus">Press the microphone to begin.</div>
          <div class="v-interim" id="vInterim"></div>

          <div class="v-current hidden" id="vCurrent">
            <span class="tiny muted">Now answering</span>
            <strong id="vCurrentLabel"></strong>
            <span class="tiny" id="vCurrentHint"></span>
          </div>

          <div class="v-controls">
            <button class="btn btn-voice btn-sm" id="vGuided">▶ Guided</button>
            <button class="btn btn-ghost btn-sm" id="vFree">Free</button>
            <select class="select v-lang" id="vLang">
              ${Object.entries(LANGS).map(([k, l]) => `<option value="${k}">${l.name}</option>`).join('')}
            </select>
            <button class="btn btn-ghost btn-sm" id="vTTS" title="Speak prompts">🔊</button>
          </div>

          <div class="v-fields" id="vFields"></div>

          <div class="v-console hidden" id="vConsole">
            <span class="tiny muted">Type a command (same parser as speech)</span>
            <div class="row" style="gap:.4rem;margin-top:.3rem">
              <input class="input" id="vConsoleIn" placeholder="e.g. student name Karthik Raja">
              <button class="btn btn-primary btn-sm" id="vConsoleGo">Run</button>
            </div>
          </div>

          <div class="v-log" id="vLog"></div>
        </div>`;
      document.body.appendChild(d);
      this.dock = d;

      d.querySelector('#vFab').onclick = () => {
        if (!d.classList.contains('open')) { d.classList.add('open'); d.classList.remove('minimised'); }
        this.toggle();
      };
      d.querySelector('#vMinBtn').onclick = () => { d.classList.remove('open'); this.stop(); };
      d.querySelector('#vHelpBtn').onclick = () => this.showHelp();
      d.querySelector('#vGuided').onclick = () => this.startGuided();
      d.querySelector('#vFree').onclick = () => { this.mode = 'free'; this.start('free'); this.paintMode(); };
      d.querySelector('#vLang').value = this.lang;
      d.querySelector('#vLang').onchange = e => {
        this.lang = e.target.value; Store.set('voiceLang', this.lang);
        if (this.rec) this.rec.lang = this.lang;
        if (this.active) { try { this.rec.stop(); } catch {} }
        this.setStatus('Language set to ' + LANGS[this.lang].name, 'ok');
      };
      const ttsBtn = d.querySelector('#vTTS');
      const paintTTS = () => {
        ttsBtn.textContent = this.speakPrompts ? '🔊' : '🔇';
        ttsBtn.classList.toggle('on', this.speakPrompts);
      };
      ttsBtn.onclick = () => { this.speakPrompts = !this.speakPrompts; Store.set('voiceTTS', this.speakPrompts); paintTTS(); };
      paintTTS();

      const runConsole = () => {
        const inp = d.querySelector('#vConsoleIn');
        if (!inp.value.trim()) return;
        this.handle(inp.value.trim(), [], 1);
        inp.value = '';
      };
      d.querySelector('#vConsoleGo').onclick = runConsole;
      d.querySelector('#vConsoleIn').onkeydown = e => { if (e.key === 'Enter') runConsole(); };

      if (!this.supported) this.setStatus('Speech recognition unavailable in this browser — use the typed console below.', 'warn');
    },

    showConsole(on) { this.dock?.querySelector('#vConsole')?.classList.toggle('hidden', !on); },
    paintMic() { this.dock.querySelector('#vFab').classList.toggle('on', this.active); },
    paintMode() {
      const b = this.dock.querySelector('#vModeBadge');
      b.textContent = this.mode === 'guided' ? 'Guided' : 'Free';
      this.dock.querySelector('#vGuided').classList.toggle('on', this.mode === 'guided');
    },

    setStatus(msg, kind = '') {
      const el = this.dock?.querySelector('#vStatus');
      if (!el) return;
      el.textContent = msg;
      el.className = 'v-status ' + kind;
      this.paintMode();
    },
    showInterim(t) {
      const el = this.dock?.querySelector('#vInterim');
      if (el) { el.textContent = t ? '“' + t + '…”' : ''; el.classList.toggle('on', !!t); }
    },
    setCurrent(f) {
      const box = this.dock?.querySelector('#vCurrent');
      if (!box) return;
      box.classList.toggle('hidden', !f);
      if (!f) return;
      box.querySelector('#vCurrentLabel').textContent = f.label;
      box.querySelector('#vCurrentHint').textContent = {
        date: 'say e.g. “twelfth March two thousand ten”',
        digits: 'say the digits one by one',
        number: 'say a number',
        select: 'options: ' + f.options.slice(0, 4).map(o => o.text).join(', '),
        check: 'say yes or no',
        name: 'say the full name',
        text: 'say the value'
      }[f.kind] || '';
    },

    renderFieldList() {
      const host = this.dock?.querySelector('#vFields');
      if (!host) return;
      if (!this.fields.length) { host.innerHTML = ''; return; }
      host.innerHTML = this.fields.map((f, i) => {
        const val = f.kind === 'check' ? (f.el.checked ? 'Yes' : '') : f.el.value;
        return `<button class="v-chip ${val ? 'done' : ''} ${i === this.idx ? 'cur' : ''}" data-i="${i}">
          <span>${esc(f.label)}</span>${val ? `<b>${esc(String(displayOf(f, val)).slice(0, 18))}</b>` : ''}
        </button>`;
      }).join('');
      host.querySelectorAll('.v-chip').forEach(b => b.onclick = () => {
        this.idx = +b.dataset.i; this.mode = 'guided'; this.focusField(this.idx, true);
      });
    },

    pushLog(kind, text, conf) {
      this.log.unshift({ kind, text, conf, t: Date.now() });
      this.log = this.log.slice(0, 40);
      const host = this.dock?.querySelector('#vLog');
      if (!host) return;
      host.innerHTML = this.log.slice(0, 7).map(l => `
        <div class="v-log-row ${l.kind}">
          <span class="v-log-tag">${{ heard: 'heard', did: 'done', prompt: 'ask', miss: '??' }[l.kind] || l.kind}</span>
          <span>${esc(l.text)}</span>
          ${l.conf ? `<span class="tiny muted">${Math.round(l.conf * 100)}%</span>` : ''}
        </div>`).join('');
    },

    showHelp() {
      const rows = [
        ['Fill a field', '“student name Karthik Raja” · “father name Murugesan”'],
        ['Dates', '“date of birth twelfth March two thousand ten” · “12 03 2010”'],
        ['Numbers & marks', '“mathematics eighty seven” · “total nine hundred fifty”'],
        ['Phone / Aadhaar', '“phone nine eight four three double one two three”'],
        ['Dropdowns', '“community M B C” · “medium Tamil” · “group Bio-Maths”'],
        ['Yes / No', '“R T E yes” · “transport no”'],
        ['Spelling', '“spell K A R T H I K”'],
        ['Move about', '“next” · “back” · “skip” · “repeat” · “read back”'],
        ['Fix mistakes', '“clear” · “undo”'],
        ['Finish', '“save” · “cancel”'],
        ['Navigate', '“go to attendance” · “open fees” · “show students”'],
        ['Roll call', 'On the attendance screen: “present” · “absent” · “late” · “roll twelve absent”'],
        ['Stop', '“stop listening” · Ctrl + Shift + M']
      ];
      openModal({
        title: '🎙 What you can say',
        wide: true,
        body: `<p class="small muted" style="margin-bottom:1rem">Voice never replaces the keyboard — every field still accepts typing. Guided mode reads each question aloud and waits; free mode lets you jump anywhere.</p>
          <div class="table-scroll"><table class="table"><tbody>
          ${rows.map(([a, b]) => `<tr><td style="white-space:nowrap"><strong>${a}</strong></td><td class="muted">${b}</td></tr>`).join('')}
          </tbody></table></div>
          <p class="tiny muted" style="margin-top:1rem">Shortcuts — <strong>Ctrl+Shift+V</strong> guided entry on the open form · <strong>Ctrl+Shift+M</strong> toggle the microphone.</p>`,
        actions: [{ label: 'Got it', cls: 'btn-primary', fn: closeModal }]
      });
    }
  };

  /* ---------- can this control take a spoken value right now? ---------- */
  function isUsable(el) {
    if (el.disabled || el.readOnly) return false;
    if (el.hidden || el.closest('[hidden],.hidden')) return false;
    /* getClientRects() is a truer hidden-test than offsetParent, which is also
       null for position:fixed content such as our modals. Only trust it when the
       document actually has layout, so headless runs do not reject everything. */
    if (el.getClientRects && el.getClientRects().length === 0 &&
        document.body.getClientRects().length > 0) return false;
    return true;
  }

  /* ---------- field kind detection ---------- */
  function kindOf(el) {
    if (el.tagName === 'SELECT') return 'select';
    if (el.type === 'checkbox') return 'check';
    if (el.type === 'date') return 'date';
    if (el.type === 'number') return 'number';
    if (el.dataset.vKind) return el.dataset.vKind;
    if (el.type === 'tel' || /phone|mobile|aadhaar|aadhar|contact/i.test(el.name + el.id)) return 'digits';
    if (/name|father|mother|guardian/i.test(el.name + el.id)) return 'name';
    return 'text';
  }
  function displayOf(field, v) {
    if (field.kind === 'select') {
      const o = field.options.find(o => o.value === v);
      return o ? o.text : v;
    }
    if (field.kind === 'date') return fmtDate(v);
    return v;
  }
  function matchCommand(n) {
    for (const [cmd, list] of Object.entries(CMD))
      if (list.some(w => n === w || n === w + ' please')) return cmd;
    return null;
  }
  function flash(el, bad) {
    const box = el.closest('.field') || el;
    box.classList.remove('v-filled', 'v-cleared');
    void box.offsetWidth;
    box.classList.add(bad ? 'v-cleared' : 'v-filled');
    setTimeout(() => box.classList.remove('v-filled', 'v-cleared'), 1100);
  }

  /* expose parsers for reuse / testing */
  V.parse = { wordsToNumber, digitsOnly, parseDate, norm, titleCase, score, spokenForms };
  return V;
})();
