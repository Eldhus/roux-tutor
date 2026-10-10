// The Speed page: save-to-pixels timing, and a drag race two ways.
// roux dev says what its last pass cost (/_dev/stats) and races the app
// with roux-load (/_dev/race); the browser's own timings say the rest, and
// each answer's Server-Timing header says the app's time.
(() => {
  const $ = (name) => document.querySelector(`[data-roux="${name}"]`);
  const told = "roux-speed:told";
  const kept = "roux-speed:history";
  const ms = (x) => x < 1
    ? `${Math.max(1, Math.round(x * 1000))} µs`
    : `${x < 10 ? x.toFixed(1) : Math.round(x)} ms`;
  const load = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  };
  const sleep = (t) => new Promise((done) => setTimeout(done, t));

  // ── Save to pixels ──────────────────────────────────────────────────────
  // When this page goes (roux's own script reloads it when a new build
  // serves), the time is kept, and the next load measures from it. No
  // stream of our own: a browser has six connections a site, shared by tabs.
  const seenKey = "roux-speed:reread";
  addEventListener("pagehide", () => {
    sessionStorage.setItem(told, String(performance.timeOrigin + performance.now()));
  });

  const painted = () => new Promise((done) => {
    const paint = performance.getEntriesByName("first-contentful-paint")[0];
    if (paint) return done(paint.startTime);
    new PerformanceObserver((list, observer) => {
      observer.disconnect();
      done(list.getEntries()[0].startTime);
    }).observe({ type: "paint", buffered: true });
    setTimeout(() => done(performance.now()), 1500);
  });
  const loaded = () => new Promise((done) => {
    if (document.readyState === "complete") return done();
    addEventListener("load", () => done(), { once: true });
  });

  const show = (t) => {
    const total = t.roux + t.net + t.ready + t.paint;
    $("total").textContent = ms(total);
    $("roux").textContent = ms(t.roux);
    $("net").textContent = ms(t.net);
    $("ready").textContent = ms(t.ready);
    $("paint").textContent = ms(t.paint);
    const [r, n, d, p] = $("track").children;
    const share = (x) => `${(100 * x / Math.max(total, 0.001)).toFixed(2)}%`;
    r.style.width = share(t.roux); n.style.width = share(t.net);
    d.style.width = share(t.ready); p.style.width = share(t.paint);
  };

  const history = load(kept, []);
  const drawHistory = () => {
    const most = Math.max(1, ...history.map((h) => h.roux + h.net + h.ready + h.paint));
    $("history").innerHTML = history.map((h) => {
      const total = h.roux + h.net + h.ready + h.paint;
      const w = (x) => (100 * x / most).toFixed(2);
      return `<li><span class="mini"><i class="p-roux" style="width:${w(h.roux)}%"></i>` +
        `<i class="p-net" style="width:${w(h.net)}%"></i><i class="p-ready" style="width:${w(h.ready)}%"></i>` +
        `<i class="p-paint" style="width:${w(h.paint)}%"></i></span>${ms(total)}</li>`;
    }).join("");
  };

  (async () => {
    let stats = {};
    try {
      const answer = await fetch("/_dev/stats", { cache: "no-store" });
      if (answer.headers.get("content-type")?.startsWith("application/json")) stats = await answer.json();
    } catch {}
    if (stats.built === undefined) {
      $("note").textContent = "Run this under ./roux dev to time your edits.";
      drawHistory();
      return;
    }
    if (stats.built !== "templates") $("roc").textContent = ms(stats.micros / 1000);
    const at = Number(sessionStorage.getItem(told));
    sessionStorage.removeItem(told);
    // A reload roux asked for: a reread this page has not seen yet.
    const nav = performance.getEntriesByType("navigation")[0];
    const seen = sessionStorage.getItem(seenKey);
    const reread = `${stats.build}.${stats.reread}`;
    sessionStorage.setItem(seenKey, reread);
    if (at && stats.built === "templates" && nav.type === "reload" && seen !== null && seen !== reread) {
      await loaded();
      const paint = await painted();
      const timing = {
        roux: stats.micros / 1000,
        net: Math.max(0, performance.timeOrigin - at) + nav.responseEnd,
        ready: Math.max(0, nav.loadEventStart - nav.responseEnd),
        paint: Math.max(0, paint - nav.loadEventStart),
      };
      show(timing);
      history.unshift(timing);
      history.length = Math.min(history.length, 8);
      try { localStorage.setItem(kept, JSON.stringify(history)); } catch {}
      $("note").textContent = "Save again. Most of it is the browser: roux's part is the first sliver.";
    } else if (history.length > 0) {
      show(history[0]);
      $("note").textContent = "Your last edits, newest first. Save again to add one.";
    }
    drawHistory();
  })();

  // ── The drag race: one chart, two scales a unit ─────────────────────────
  // Each lane is raced by the browser, then by roux-load (through roux dev's
  // /_dev/race). The browser's bar grows left on its scale, roux-load's
  // right on its own.
  // Requests a second and events a second each have their own axes.
  const units = { requests: "requests a second", events: "events a second" };
  const lanes = [
    { name: "static file", note: "the host alone, no Roc", url: "/favicon.svg", unit: "requests" },
    { name: "template", note: "the menu, rendered", url: "/race/page", unit: "requests" },
    { name: "SQLite", note: "a query, then text", url: "/race/db", unit: "requests" },
    { name: "Datastar", note: "patches, 1,000 a stream", url: "/race/stream", unit: "events", stream: true },
  ];
  const results = lanes.map(() => ({ browser: 0, raw: 0 }));

  const axes = {};
  const rows = lanes.map((lane, i) => {
    if (!axes[lane.unit]) {
      const axis = document.createElement("div");
      axis.className = "axis";
      axis.innerHTML = `<div class="ticks browser"></div><div class="unit">${units[lane.unit]}</div>` +
        `<div class="ticks raw"></div>`;
      $("duel-rows").append(axis);
      axes[lane.unit] = axis;
    }
    const row = document.createElement("div");
    row.className = "duel-row";
    row.style.setProperty("--lane", `var(--lane-${i})`);
    row.innerHTML =
      `<div class="half browser"><span class="figure"><b class="n">–</b><small class="sub"></small></span>` +
      `<span class="bar"></span></div>` +
      `<div class="name"><b>${lane.name}</b><small>${lane.note}</small></div>` +
      `<div class="half raw"><span class="bar"></span>` +
      `<span class="figure"><b class="n">–</b><small class="sub"></small></span></div>`;
    $("duel-rows").append(row);
    return row;
  });
  const part = (i, side, name) => rows[i].querySelector(`.half.${side} .${name}`);

  // A round axis maximum: 1, 2 or 5 times a power of ten, at least `x`.
  const roundUp = (x) => {
    const power = 10 ** Math.floor(Math.log10(Math.max(x, 1)));
    return [1, 2, 5, 10].map((m) => m * power).find((m) => m >= x);
  };
  const compact = (x) => x >= 1e6 ? `${+(x / 1e6).toFixed(1)}M` : x >= 1e3 ? `${+(x / 1e3).toFixed(0)}k` : `${Math.round(x)}`;
  const draw = () => {
    const most = {};
    for (const [unit, axis] of Object.entries(axes)) {
      const of = (side) => results.filter((_, i) => lanes[i].unit === unit).map((r) => r[side]);
      most[unit] = {
        browser: roundUp(Math.max(100, ...of("browser"))),
        raw: roundUp(Math.max(1000, ...of("raw"))),
      };
      for (const side of ["browser", "raw"]) {
        axis.querySelector(`.ticks.${side}`).innerHTML = [0, 0.5, 1].map((f) =>
          `<span style="--at:${f * 100}%">${compact(f * most[unit][side])}</span>`).join("");
      }
    }
    results.forEach((r, i) => {
      for (const side of ["browser", "raw"]) {
        const scale = most[lanes[i].unit][side];
        part(i, side, "bar").style.width = `${(100 * r[side] / scale).toFixed(2)}%`;
        if (r[side] > 0) part(i, side, "n").textContent = Math.round(r[side]).toLocaleString();
      }
    });
  };
  draw();

  // The browser's heat: four requests at a time (six a site, shared by every
  // tab, and live reload holds one), each given up after three seconds, so
  // a race starved of connections says so instead of hanging.
  const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const serverTime = (url) => {
    const entries = performance.getEntriesByName(url);
    return entries[entries.length - 1]?.serverTiming?.find((t) => t.name === "roux")?.duration;
  };
  // Server-sent events counted as roux-load counts them (the format's
  // rules): lines end in CRLF, LF or CR; a blank line after a data field
  // is one event. Fed text as it arrives, split anywhere.
  const eventCounter = () => {
    let line = "";
    let afterCr = false;
    let hasData = false;
    return (text) => {
      let events = 0;
      for (const c of text) {
        if (afterCr) {
          afterCr = false;
          if (c === "\n") continue;
        }
        if (c !== "\r" && c !== "\n") {
          // Only a line's field name matters: keep its first five characters.
          if (line.length < 5) line += c;
          continue;
        }
        afterCr = c === "\r";
        if (line === "") {
          if (hasData) events++;
          hasData = false;
        } else if (line === "data" || line.startsWith("data:")) {
          hasData = true;
        }
        line = "";
      }
      return events;
    };
  };

  // A stream lane: four streams open at a time, each read to its end and
  // asked again, until two seconds are up; the rate is events a second.
  const raceBrowserStream = async (i) => {
    const url = new URL(lanes[i].url, location.href).href;
    let events = 0;
    let streams = 0;
    let starved = false;
    const started = performance.now();
    const until = started + 2000;
    const worker = async () => {
      while (performance.now() < until && !starved) {
        const stop = new AbortController();
        const late = setTimeout(() => stop.abort(), 3000);
        try {
          const answer = await fetch(url, { cache: "no-store", signal: stop.signal });
          clearTimeout(late);
          const reader = answer.body.pipeThrough(new TextDecoderStream()).getReader();
          const count = eventCounter();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            events += count(value);
            if (performance.now() >= until) { await reader.cancel(); break; }
          }
          streams++;
        } catch {
          clearTimeout(late);
          starved = true;
        }
      }
    };
    const tick = () => {
      results[i].browser = events / Math.max(0.001, (performance.now() - started) / 1000);
      part(i, "browser", "sub").textContent = `${streams.toLocaleString()} streams`;
      draw();
    };
    const ticker = setInterval(tick, 120);
    await Promise.all(Array.from({ length: 4 }, worker));
    clearInterval(ticker);
    tick();
    return !starved;
  };

  const raceBrowser = async (i) => {
    if (lanes[i].stream) return raceBrowserStream(i);
    const url = new URL(lanes[i].url, location.href).href;
    const times = [];
    const servers = [];
    let starved = false;
    const started = performance.now();
    const until = started + 2000;
    const worker = async () => {
      while (performance.now() < until && !starved) {
        const from = performance.now();
        try {
          const answer = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(3000) });
          await answer.arrayBuffer();
          times.push(performance.now() - from);
        } catch {
          starved = true;
        }
      }
    };
    const tick = () => {
      results[i].browser = times.length / Math.max(0.001, (performance.now() - started) / 1000);
      const s = serverTime(url);
      if (s !== undefined) servers.push(s);
      const sorted = [...times].sort((a, b) => a - b);
      const p50 = sorted.length ? `p50 ${ms(quantile(sorted, 0.5))}` : "";
      // A static file is the host's alone: no app time to say.
      const server = lanes[i].url === "/favicon.svg" ? "\nno app" :
        servers.length ? `\napp ${ms([...servers].sort((a, b) => a - b)[servers.length >> 1])}` : "";
      part(i, "browser", "sub").textContent = p50 + server;
      draw();
    };
    performance.setResourceTimingBufferSize(100000);
    const ticker = setInterval(tick, 120);
    await Promise.all(Array.from({ length: 4 }, worker));
    clearInterval(ticker);
    tick();
    performance.clearResourceTimings();
    return !starved;
  };

  // roux-load's heat: one lane through roux dev, asked about four times a
  // second until it has a result. Null when roux dev cannot run it.
  const raceRaw = async (i) => {
    let started;
    // 409: another race is on (another tab's); wait it out, a few times.
    for (let tries = 0; tries < 20; tries++) {
      try {
        const mode = lanes[i].stream ? "&mode=events" : "";
        started = await fetch(`/_dev/race?paths=${lanes[i].url}${mode}`, { method: "POST" });
      } catch {}
      if (started?.status !== 409) break;
      await sleep(500);
    }
    if (!started || started.status !== 202) return null;
    for (;;) {
      await sleep(250);
      let state;
      try { state = await (await fetch("/_dev/race", { cache: "no-store" })).json(); } catch { return null; }
      if (!state.loader) return null;
      const result = state.lanes[0]?.result;
      if (result && lanes[i].stream) {
        // A roux older than the events mode answers with requests.
        if (result.events_per_second === undefined) return null;
        results[i].raw = result.events_per_second;
        part(i, "raw", "sub").textContent = `${result.streams.toLocaleString()} streams`;
        draw();
        return result;
      }
      if (result) {
        results[i].raw = result.requests_per_second;
        part(i, "raw", "sub").textContent = `p50 ${ms(result.p50_us / 1000)}\np99 ${ms(result.p99_us / 1000)}`;
        draw();
        return result;
      }
      if (!state.running) return null;
    }
  };

  $("go").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const lights = [...$("lights").children];
    button.disabled = true;
    results.forEach((r) => { r.browser = 0; r.raw = 0; });
    rows.forEach((row, i) => {
      row.classList.remove("raced");
      for (const side of ["browser", "raw"]) {
        part(i, side, "n").textContent = "–";
        part(i, side, "sub").textContent = "";
      }
    });
    draw();
    lights.forEach((light) => light.className = "");
    for (const light of lights) { light.className = "on"; await sleep(320); }
    lights.forEach((light) => light.className = "go");
    let note = null;
    for (let i = 0; i < lanes.length; i++) {
      rows[i].classList.add("running");
      rows[i].dataset.side = "browser";
      if (!(await raceBrowser(i))) {
        note = "A request waited three seconds for a connection: other tabs of this site hold " +
          "them (each keeps one open for live reload). Close a few and race again.";
        rows[i].classList.remove("running");
        break;
      }
      rows[i].dataset.side = "raw";
      const raw = await raceRaw(i);
      if (raw === null) note = "roux-load races under ./roux dev: run it there to see the right side.";
      rows[i].classList.remove("running");
      // Not "done": the Start page's boxed card has that class.
      rows[i].classList.add("raced");
    }
    if (note) $("race-note").textContent = note;
    lights.forEach((light) => light.className = "");
    button.disabled = false;
    button.textContent = "Race again";
  });
})();
