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

  // ── The drag race ───────────────────────────────────────────────────────
  const lanes = [
    { name: "static file", note: "the host alone, no Roc", url: "/favicon.svg", server: "no Roc" },
    { name: "Roc text", note: "a handler, no template", url: "/race/text" },
    { name: "template", note: "the menu, rendered", url: "/race/page" },
    { name: "SQLite", note: "a query, then text", url: "/race/db" },
    { name: "Datastar", note: "a stream, one patch", url: "/race/patch", server: "streamed" },
  ];

  // A heat's lanes, drawn into `into`: set(i, numbers) fills one in.
  const board = (into, statsLabel) => {
    const rates = lanes.map(() => 0);
    const rows = lanes.map((lane, i) => {
      const row = document.createElement("div");
      row.className = "lane";
      row.style.setProperty("--lane", `var(--lane-${i})`);
      row.innerHTML = `<div class="who"><b>${lane.name}</b><small>${lane.note}</small></div>` +
        `<div class="road"><span class="bar"></span><span class="rate">–</span></div>` +
        `<div class="stats"><span>p50 <b class="p50">–</b></span><span>p99 <b class="p99">–</b></span>` +
        `<span>${statsLabel} <b class="extra">–</b></span></div>`;
      into.append(row);
      return row;
    });
    const cell = (i, name) => rows[i].querySelector(`.${name}`);
    return {
      reset(extra) {
        rates.fill(0);
        rows.forEach((row, i) => {
          row.classList.remove("running", "out");
          row.querySelector(".bar").style.width = "0";
          for (const name of ["rate", "p50", "p99"]) cell(i, name).textContent = "–";
          cell(i, "extra").textContent = extra(lanes[i]);
        });
      },
      running(i, on) { rows[i].classList.toggle("running", on); },
      out(i, why) { rows[i].classList.add("out"); cell(i, "rate").textContent = why; },
      set(i, { rate, p50, p99, extra }) {
        rates[i] = rate;
        const most = Math.max(1, ...rates);
        rows.forEach((row, j) => { row.querySelector(".bar").style.width = `${(78 * rates[j] / most).toFixed(2)}%`; });
        cell(i, "rate").textContent = `${Math.round(rate).toLocaleString()} req/s`;
        if (p50 !== undefined) cell(i, "p50").textContent = ms(p50);
        if (p99 !== undefined) cell(i, "p99").textContent = ms(p99);
        if (extra !== undefined) cell(i, "extra").textContent = extra;
      },
    };
  };

  const lightsUp = async (name) => {
    const lights = [...$(name).children];
    lights.forEach((light) => light.className = "");
    for (const light of lights) { light.className = "on"; await sleep(320); }
    lights.forEach((light) => light.className = "go");
    return () => lights.forEach((light) => light.className = "");
  };

  // In the browser: four requests at a time (six a site, shared by every
  // tab, and live reload holds one), each given up after three seconds, so
  // a race starved of connections says so instead of hanging.
  const browser = board($("lanes"), "server");
  browser.reset((lane) => lane.server ?? "–");
  const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const serverTime = (url) => {
    const entries = performance.getEntriesByName(url);
    return entries[entries.length - 1]?.serverTiming?.find((t) => t.name === "roux")?.duration;
  };
  const raceInBrowser = async (i) => {
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
      const sorted = [...times].sort((a, b) => a - b);
      const s = serverTime(url);
      if (s !== undefined) servers.push(s);
      browser.set(i, {
        rate: times.length / Math.max(0.001, (performance.now() - started) / 1000),
        p50: sorted.length ? quantile(sorted, 0.5) : undefined,
        p99: sorted.length ? quantile(sorted, 0.99) : undefined,
        extra: servers.length ? ms([...servers].sort((a, b) => a - b)[servers.length >> 1]) : undefined,
      });
    };
    browser.running(i, true);
    performance.setResourceTimingBufferSize(100000);
    const ticker = setInterval(tick, 120);
    await Promise.all(Array.from({ length: 4 }, worker));
    clearInterval(ticker);
    tick();
    browser.running(i, false);
    performance.clearResourceTimings();
    return !starved;
  };

  $("go").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    browser.reset((lane) => lane.server ?? "–");
    const lightsOff = await lightsUp("lights");
    let ok = true;
    for (let i = 0; i < lanes.length && ok; i++) ok = await raceInBrowser(i);
    lightsOff();
    if (!ok) {
      $("browser-note").textContent = "A request waited three seconds for a connection: other tabs " +
        "of this site hold them (each keeps one open for live reload). Close a few and race again.";
    }
    button.disabled = false;
    button.textContent = "In your browser, again";
  });

  // From outside: roux dev runs roux-load against the app, lane by lane;
  // this page asks where it is four times a second. roux-load reads plain
  // answers, not streams, so the Datastar lane sits this one out.
  const outside = board($("out-lanes"), "p99.9");
  outside.reset(() => "–");
  outside.out(4, "a stream: not for roux-load");
  const raced = lanes.slice(0, 4);
  $("out").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    outside.reset(() => "–");
    outside.out(4, "a stream: not for roux-load");
    const lightsOff = await lightsUp("out-lights");
    const paths = raced.map((lane) => lane.url).join(",");
    let started;
    try {
      started = await fetch(`/_dev/race?paths=${paths}`, { method: "POST" });
    } catch {}
    if (!started || !started.headers.get("content-type")?.startsWith("application/json")) {
      $("out-note").textContent = "Run this under ./roux dev: it runs roux-load for you.";
      lightsOff();
      button.disabled = false;
      return;
    }
    for (;;) {
      await sleep(250);
      let state;
      try { state = await (await fetch("/_dev/race", { cache: "no-store" })).json(); } catch { break; }
      state.lanes.forEach((lane, i) => {
        outside.running(i, state.running && state.current === i && !lane.result);
        if (lane.result) {
          outside.set(i, {
            rate: lane.result.requests_per_second,
            p50: lane.result.p50_us / 1000,
            p99: lane.result.p99_us / 1000,
            extra: ms(lane.result.p999_us / 1000),
          });
        }
      });
      if (!state.running) {
        if (!state.loader) $("out-note").textContent = "roux dev found no roux-load beside roux.";
        break;
      }
    }
    lightsOff();
    button.disabled = false;
    button.textContent = "From outside, again";
  });
})();
