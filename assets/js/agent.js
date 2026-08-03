/* ============================================================
   agent.js — the voice agent, browser side
   ------------------------------------------------------------
   Speech → text → Gemini → actions on this page.

   The browser never decides what an utterance means. It does three
   things: capture speech, describe what the current screen can do,
   and execute the tool calls that come back.

   Each screen registers a manifest with Agent.screen({...}) —
   its routes, its buttons, its fields and filters. That manifest
   is the *only* thing sent to the model. Student records stay here.
   ============================================================ */

const Agent = (() => {

  const LANGS = {
    'en-IN': { name: 'English', tts: 'en-IN' },
    'ta-IN': { name: 'தமிழ்',   tts: 'ta-IN' }
  };

  const A = {
    supported: !!(window.SpeechRecognition || window.webkitSpeechRecognition),
    listening: false,
    busy: false,
    lang: Store.get('agentLang', 'en-IN'),
    speak: Store.get('agentTTS', true),
    rec: null,
    speaking: false,
    manifest: null,
    history: [],
    log: [],

    /* ═══════════════ screen manifest ═══════════════ */

    /**
     * Declare what this screen can do. Called by each route on render.
     *   screen      short id, e.g. 'attendance'
     *   description one line telling the model what this screen is for
     *   routes      [{id, label}]         navigable destinations
     *   actions     [{id, label, hint, run}]  buttons — run() executes it
     *   controls    [{id, label, el, type, options, hint}]  inputs & filters
     */
    screen(manifest) {
      this.manifest = manifest || null;
      this.render();
      return this;
    },
    clear() { this.manifest = null; this.render(); },

    /** Snapshot the manifest as the model sees it — shape only, never data. */
    context() {
      const m = this.manifest;
      if (!m) return { screen: 'unknown' };
      return {
        screen: m.screen,
        description: m.description,
        role: m.role,
        routes: (m.routes || []).map(r => ({ id: r.id, label: r.label })),
        actions: (m.actions || []).map(a => ({ id: a.id, label: a.label, hint: a.hint, arg: a.arg })),
        controls: (m.controls || []).map(c => {
          const el = typeof c.el === 'function' ? c.el() : c.el;
          const opts = c.options || (el && el.tagName === 'SELECT'
            ? [...el.options].filter(o => o.value !== '').map(o => o.value)
            : null);
          return {
            id: c.id,
            label: c.label,
            type: c.type || inferType(el),
            options: opts && opts.length ? opts.slice(0, 40) : undefined,
            value: el ? (el.type === 'checkbox' ? String(el.checked) : el.value || undefined) : undefined,
            hint: c.hint
          };
        })
      };
    },

    /* ═══════════════ the round trip ═══════════════ */

    /** Send an utterance to the agent and carry out whatever comes back. */
    async send(utterance) {
      if (!utterance || this.busy) return;
      this.busy = true;
      this.push('you', utterance);
      this.status('Thinking…', 'live');
      this.render();

      try {
        const res = await fetch('/api/agent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            utterance,
            context: this.context(),
            history: this.history
          })
        });
        const data = await res.json();

        if (!res.ok) {
          const msg = data.message || 'The agent could not be reached.';
          this.push('error', msg);
          this.status(msg, data.error === 'rate_limit' ? 'warn' : 'err');
          /* Say quota and auth problems out loud. On a free tier they are the
             two failures a user will actually hit, and a teacher mid-roll-call
             should not have to notice a small red line in a panel. */
          if (data.error === 'rate_limit' || data.error === 'auth') this.say(msg);
          if (data.error === 'no_api_key') this.showConsole(true);
          /* Stop listening on quota exhaustion — otherwise every further
             sentence fires another doomed request. */
          if (data.error === 'rate_limit') this.stop();
          return;
        }

        this.history.push({ role: 'user', content: utterance });
        this.lastCached = !!data.cached;
        await this.perform(data.calls || []);
        if (data.text && !(data.calls || []).some(c => c.tool === 'respond')) {
          this.push('agent', data.text);
          this.say(data.text);
        }
        if (!data.calls?.length && !data.text) {
          this.push('error', 'No action was taken.');
          this.status('The agent did not act on that. Try rephrasing.', 'warn');
        }
        this.usage = data.usage;
        this.cacheStats = data.cache;
      } catch (err) {
        this.push('error', err.message);
        this.status('Could not reach the agent: ' + err.message, 'err');
      } finally {
        this.busy = false;
        this.render();
      }
    },

    /** Execute the model's tool calls against this screen. */
    async perform(calls) {
      const m = this.manifest || {};
      const done = [];

      for (const call of calls) {
        const { tool, input } = call;

        if (tool === 'respond') {
          this.push('agent', input.message);
          this.say(input.message);
          this.status(input.message, '');
          done.push('replied');
          continue;
        }

        if (tool === 'navigate') {
          const route = (m.routes || []).find(r => r.id === input.route);
          if (!route) { this.miss(`route "${input.route}"`); continue; }
          this.push('did', `Opened ${route.label}`);
          done.push(route.label);
          route.go ? route.go() : (location.hash = '#' + route.id);
          continue;
        }

        if (tool === 'click') {
          const action = (m.actions || []).find(a => a.id === input.action);
          if (!action) { this.miss(`action "${input.action}"`); continue; }
          try {
            const outcome = await action.run(input.argument);
            const label = typeof outcome === 'string' ? outcome : action.label;
            this.push('did', label);
            done.push(label);
          } catch (e) { this.push('error', e.message); }
          continue;
        }

        if (tool === 'set_controls') {
          const applied = [];
          for (const u of input.updates || []) {
            const ctrl = (m.controls || []).find(c => c.id === u.control);
            if (!ctrl) { this.miss(`control "${u.control}"`); continue; }
            const el = typeof ctrl.el === 'function' ? ctrl.el() : ctrl.el;
            if (!el) { this.miss(`control "${u.control}"`); continue; }
            const shown = writeControl(el, u.value);
            if (shown === false) { this.miss(`value "${u.value}" for ${ctrl.label}`); continue; }
            flash(el);
            applied.push(`${ctrl.label} → ${shown}`);
          }
          if (applied.length) {
            applied.forEach(a => this.push('did', a));
            done.push(...applied);
          }
          continue;
        }

        this.miss(`tool "${tool}"`);
      }

      if (done.length) {
        this.status('✓ ' + done.slice(0, 3).join(' · ') + (done.length > 3 ? ` +${done.length - 3} more` : ''), 'ok');
        this.history.push({ role: 'assistant', content: 'Did: ' + done.join('; ') });
        this.history = this.history.slice(-8);
      }
    },

    miss(what) {
      this.push('error', `Could not find ${what} on this screen.`);
      this.status(`Could not find ${what} here.`, 'warn');
    },

    /* ═══════════════ speech in ═══════════════ */

    init() {
      this.buildDock();
      if (this.supported) {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        this.rec = new SR();
        this.rec.continuous = false;      // one utterance per turn — the agent replies between them
        this.rec.interimResults = true;
        this.rec.lang = this.lang;

        this.rec.onresult = e => {
          if (this.speaking) return;
          let interim = '', final = '';
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const r = e.results[i];
            if (r.isFinal) final += r[0].transcript; else interim += r[0].transcript;
          }
          if (interim) this.interim(interim);
          if (final.trim()) { this.interim(''); this.send(final.trim()); }
        };
        this.rec.onerror = e => {
          if (e.error === 'no-speech' || e.error === 'aborted') return;
          if (e.error === 'not-allowed') {
            this.stop();
            this.status('Microphone blocked — allow access in the address bar.', 'err');
            this.showConsole(true);
          } else this.status('Microphone: ' + e.error, 'err');
        };
        this.rec.onend = () => {
          if (this.listening && !this.busy) { try { this.rec.start(); } catch {} }
          else if (this.listening) setTimeout(() => { if (this.listening) try { this.rec.start(); } catch {} }, 600);
        };
      } else {
        this.showConsole(true);
        this.status('This browser has no speech recognition — type your request below.', 'warn');
      }

      addEventListener('keydown', e => {
        if (e.ctrlKey && e.shiftKey && (e.key === 'V' || e.key === 'v' || e.key === 'M' || e.key === 'm')) {
          e.preventDefault(); this.toggle();
        }
      });
      return this;
    },

    toggle() { this.listening ? this.stop() : this.start(); },

    start() {
      if (!this.supported) {
        this.showConsole(true);
        this.dock.classList.add('open');
        document.getElementById('agIn')?.focus();
        return;
      }
      this.listening = true;
      this.rec.lang = this.lang;
      try { this.rec.start(); } catch {}
      this.dock.classList.add('open', 'listening');
      this.status('Listening — say what you want to do.', 'live');
      this.render();
    },

    stop() {
      this.listening = false;
      try { this.rec?.stop(); } catch {}
      this.dock.classList.remove('listening');
      this.status('Stopped. Press the microphone or Ctrl+Shift+V.', '');
      this.render();
    },

    /* ═══════════════ speech out ═══════════════ */

    say(text) {
      if (!this.speak || !window.speechSynthesis || !text) return;
      try {
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = LANGS[this.lang].tts;
        u.rate = 1.06;
        this.speaking = true;
        const done = () => { this.speaking = false; };
        u.onend = done; u.onerror = done;
        speechSynthesis.speak(u);
        setTimeout(() => { if (this.speaking) done(); }, 8000);
      } catch { this.speaking = false; }
    },

    /* ═══════════════ dock UI ═══════════════ */

    buildDock() {
      const d = document.createElement('div');
      d.id = 'agentDock';
      d.className = 'ag-dock';
      d.innerHTML = `
        <button class="ag-fab" id="agFab" title="Talk to the assistant (Ctrl+Shift+V)">
          <span class="ag-fab-ico">🎙</span><span class="ag-pulse"></span>
        </button>
        <div class="ag-panel">
          <div class="ag-head">
            <div class="row" style="gap:.5rem">
              <span class="ag-wave"><i></i><i></i><i></i><i></i><i></i></span>
              <strong>Assistant</strong>
              <span class="ag-model">Gemini</span>
            </div>
            <div class="row" style="gap:.1rem">
              <button class="btn btn-quiet btn-icon" id="agHelp" title="What can I say?">?</button>
              <button class="btn btn-quiet btn-icon" id="agMin" title="Close">－</button>
            </div>
          </div>

          <div class="ag-status" id="agStatus">Press the microphone and say what you want.</div>
          <div class="ag-interim" id="agInterim"></div>
          <div class="ag-screen" id="agScreen"></div>
          <div class="ag-transcript" id="agLog"></div>

          <div class="ag-console" id="agConsole">
            <div class="row" style="gap:.4rem">
              <input class="input" id="agIn" placeholder="Type instead — “open the portal”">
              <button class="btn btn-primary btn-sm" id="agGo">Send</button>
            </div>
          </div>

          <div class="ag-foot">
            <select class="select ag-lang" id="agLang">
              ${Object.entries(LANGS).map(([k, l]) => `<option value="${k}">${l.name}</option>`).join('')}
            </select>
            <button class="btn btn-ghost btn-sm" id="agTTS" title="Speak replies">🔊</button>
            <div class="spacer"></div>
            <span class="tiny muted" id="agUsage"></span>
          </div>
        </div>`;
      document.body.appendChild(d);
      this.dock = d;

      d.querySelector('#agFab').onclick = () => {
        d.classList.add('open');
        this.toggle();
      };
      d.querySelector('#agMin').onclick = () => { d.classList.remove('open'); this.stop(); };
      d.querySelector('#agHelp').onclick = () => this.help();

      const go = () => {
        const inp = d.querySelector('#agIn');
        const v = inp.value.trim();
        if (!v) return;
        inp.value = '';
        this.send(v);
      };
      d.querySelector('#agGo').onclick = go;
      d.querySelector('#agIn').onkeydown = e => { if (e.key === 'Enter') go(); };

      const lang = d.querySelector('#agLang');
      lang.value = this.lang;
      lang.onchange = e => {
        this.lang = e.target.value; Store.set('agentLang', this.lang);
        if (this.rec) this.rec.lang = this.lang;
        this.status('Language set to ' + LANGS[this.lang].name, 'ok');
      };

      const tts = d.querySelector('#agTTS');
      const paint = () => { tts.textContent = this.speak ? '🔊' : '🔇'; tts.classList.toggle('on', this.speak); };
      tts.onclick = () => { this.speak = !this.speak; Store.set('agentTTS', this.speak); paint(); };
      paint();
    },

    showConsole(on) { this.dock?.querySelector('#agConsole')?.classList.toggle('always', !!on); },
    status(msg, kind = '') {
      const el = this.dock?.querySelector('#agStatus');
      if (el) { el.textContent = msg; el.className = 'ag-status ' + kind; }
    },
    interim(t) {
      const el = this.dock?.querySelector('#agInterim');
      if (el) { el.textContent = t ? '“' + t + '…”' : ''; el.classList.toggle('on', !!t); }
    },
    push(kind, text) {
      this.log.unshift({ kind, text });
      this.log = this.log.slice(0, 30);
      this.renderLog();
    },
    renderLog() {
      const host = this.dock?.querySelector('#agLog');
      if (!host) return;
      host.innerHTML = this.log.slice(0, 8).map(l => `
        <div class="ag-line ${l.kind}">
          <span class="ag-tag">${{ you: 'you', agent: 'said', did: 'did', error: '!' }[l.kind] || l.kind}</span>
          <span>${esc(l.text)}</span>
        </div>`).join('');
    },
    render() {
      const host = this.dock?.querySelector('#agScreen');
      if (host) {
        const c = this.context();
        const n = (c.controls?.length || 0) + (c.actions?.length || 0);
        host.innerHTML = this.manifest
          ? `<span class="tiny muted">On <strong>${esc(this.manifest.label || c.screen)}</strong> — ${n} thing${n === 1 ? '' : 's'} I can operate here.</span>`
          : '';
      }
      const u = this.dock?.querySelector('#agUsage');
      if (u) {
        const c = this.cacheStats;
        if (this.lastCached) {
          u.innerHTML = `<span class="ag-cached">↺ from memory</span>` +
            (c ? ` · ${c.calls_saved} call${c.calls_saved === 1 ? '' : 's'} saved` : '');
        } else if (this.usage) {
          u.textContent = `${this.usage.input + this.usage.output} tokens` +
            (c && c.calls_saved ? ` · ${c.calls_saved} saved so far` : '');
        }
      }
      this.dock?.querySelector('#agFab')?.classList.toggle('on', this.listening);
      this.dock?.classList.toggle('busy', this.busy);
    },

    help() {
      const c = this.context();
      openModal({
        title: '🎙 Talking to the assistant',
        wide: true,
        body: `
          <p class="small muted" style="margin-bottom:1rem">Speak naturally — you are not learning commands.
          The assistant reads whatever screen you are on and works out which buttons, filters and fields to use.
          The keyboard still does everything it always did.</p>
          <h4 style="margin-bottom:.4rem">Try saying</h4>
          <div class="table-scroll"><table class="table"><tbody>
            <tr><td style="white-space:nowrap"><strong>Navigate</strong></td><td class="muted">“Can you open the portal” · “show me attendance alerts” · “go to fee dues”</td></tr>
            <tr><td style="white-space:nowrap"><strong>Ask of a list</strong></td><td class="muted">“Show me all class ten students who are absent today” · “which eleventh standard girls are on MBC”</td></tr>
            <tr><td style="white-space:nowrap"><strong>Dictate a record</strong></td><td class="muted">“Student name Karthik Raja, father Murugesan, date of birth twelfth March two thousand ten, community M B C”</td></tr>
            <tr><td style="white-space:nowrap"><strong>Act</strong></td><td class="muted">“Mark everyone present” · “save this” · “export the list”</td></tr>
            <tr><td style="white-space:nowrap"><strong>Ask</strong></td><td class="muted">“What can I do on this screen?”</td></tr>
          </tbody></table></div>
          <h4 style="margin:1.2rem 0 .4rem">On this screen right now</h4>
          <p class="small muted">${c.actions?.length || 0} actions and ${c.controls?.length || 0} fields are available to it:
          ${esc([...(c.actions || []).map(a => a.label), ...(c.controls || []).map(x => x.label)].slice(0, 14).join(' · ')) || '—'}</p>
          <div class="ag-note" style="margin-top:1.2rem">
            <strong>What gets sent.</strong> Only the <em>shape</em> of this screen — the names of its buttons,
            filters and fields — plus what you said. Student records never leave this browser: when you ask
            which children are absent, the assistant replies “set class to ten, set status to absent”, and the
            filtering happens here. Under the DPDP Act every student here is a child, and that is the line
            this design is built around.
          </div>
          <p class="tiny muted" style="margin-top:.8rem">Shortcut — <strong>Ctrl+Shift+V</strong> starts and stops listening.</p>`,
        actions: [{ label: 'Got it', cls: 'btn-primary', fn: closeModal }]
      });
    }
  };

  /* ---------- writing a value into a control ---------- */
  function writeControl(el, value) {
    const v = String(value ?? '');
    if (el.type === 'checkbox') {
      el.checked = /^(true|yes|on|1)$/i.test(v);
      fire(el);
      return el.checked ? 'Yes' : 'No';
    }
    if (el.tagName === 'SELECT') {
      const opts = [...el.options];
      const want = v.trim().toLowerCase();
      const hit =
        opts.find(o => o.value.toLowerCase() === want) ||
        opts.find(o => o.textContent.trim().toLowerCase() === want) ||
        opts.find(o => o.textContent.trim().toLowerCase().startsWith(want)) ||
        opts.find(o => o.value.toLowerCase().includes(want) && want.length > 1);
      if (!hit) return false;
      el.value = hit.value;
      fire(el);
      return hit.textContent.trim();
    }
    el.value = v;
    fire(el);
    return v;
  }
  function fire(el) {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function inferType(el) {
    if (!el) return 'text';
    if (el.tagName === 'SELECT') return 'select';
    if (el.type === 'checkbox') return 'checkbox';
    if (el.type === 'date') return 'date';
    if (el.type === 'number') return 'number';
    return 'text';
  }
  function flash(el) {
    const box = el.closest('.field') || el;
    box.classList.remove('ag-filled');
    void box.offsetWidth;
    box.classList.add('ag-filled');
    setTimeout(() => box.classList.remove('ag-filled'), 1200);
    el.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }

  A.writeControl = writeControl;   // exposed for tests
  return A;
})();
