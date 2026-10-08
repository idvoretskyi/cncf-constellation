// CNCF Constellation — an artificial sky built from landscape GitHub data.
// Vanilla JS, no build step. Everything renders to a single 2D canvas.

const $ = (s) => document.querySelector(s);
const fmt = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const fmtFull = new Intl.NumberFormat("en");

const MATURITY_COLOR = {
  graduated: "#ffd166",
  incubating: "#4cc9f0",
  sandbox: "#b388ff",
  archived: "#6b7280",
  other: "#7fa6c9",
};
const LANG_PALETTE = ["#f78c6c", "#82aaff", "#c3e88d", "#ffcb6b", "#c792ea", "#89ddff", "#f07178", "#ff5370", "#80cbc4", "#ffd54f", "#b2ff59", "#ea80fc"];

// ---------- state ----------
const state = {
  data: null,
  stars: [], // positioned projects
  byId: new Map(),
  cam: { x: 0, y: 0, z: 1, rot: 0 },
  hover: null,
  selected: null,
  query: "",
  maturity: new Set(["graduated", "incubating", "sandbox", "archived", "other"]),
  color: "maturity",
  size: "stars",
  lines: true,
  snow: true,
  spin: true,
  dpr: Math.min(window.devicePixelRatio || 1, 2),
  w: 0,
  h: 0,
  t0: performance.now(),
};

const sky = $("#sky");
const ctx = sky.getContext("2d");
const snowCanvas = $("#snow");
const sctx = snowCanvas.getContext("2d");

// ---------- helpers ----------
const mat = (p) => (p.maturity && MATURITY_COLOR[p.maturity] ? p.maturity : "other");
const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const langColor = (l) => (l ? LANG_PALETTE[hash(l) % LANG_PALETTE.length] : "#556");
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function heat(t) {
  // 0 -> cold blue, 1 -> hot orange/white
  t = clamp(t, 0, 1);
  const r = Math.round(lerp(60, 255, t));
  const g = Math.round(lerp(110, 190, t));
  const b = Math.round(lerp(220, 90, t));
  return `rgb(${r},${g},${b})`;
}

function colorOf(p) {
  switch (state.color) {
    case "language":
      return langColor(p.lang);
    case "activity":
      return heat(Math.log1p(p.recent) / Math.log1p(600));
    case "age": {
      const y = p.first ? +p.first.slice(0, 4) : 2020;
      return heat(1 - clamp((y - 2008) / 17, 0, 1));
    }
    default:
      return MATURITY_COLOR[mat(p)];
  }
}

function sizeOf(p) {
  const v = state.size === "contributors" ? p.contributors : state.size === "year" ? p.year : p.stars;
  const m = state.size === "contributors" ? 6000 : state.size === "year" ? 30000 : 130000;
  return 1.2 + 9 * Math.pow(Math.log1p(v) / Math.log1p(m), 1.6);
}

function visible(p) {
  if (!state.maturity.has(mat(p))) return false;
  if (!state.query) return true;
  return p._q.includes(state.query);
}

// ---------- layout: spiral galaxy, one arm per category ----------
function layout(projects, categories) {
  const arms = categories.length;
  const byCat = new Map(categories.map((c) => [c, []]));
  for (const p of projects) byCat.get(p.cat)?.push(p);

  const stars = [];
  for (let a = 0; a < arms; a++) {
    const cat = categories[a];
    const list = byCat.get(cat).sort((x, y) => y.stars - x.stars);
    const base = (a / arms) * Math.PI * 2;
    const n = list.length;
    list.forEach((p, i) => {
      const t = Math.pow((i + 0.5) / n, 0.72); // 0..1 along the arm; big ones close to the core
      const r = 170 + t * 720;
      const twist = t * 2.4; // radians of spiral twist
      const seed = hash(p.id);
      const jitterA = ((seed % 1000) / 1000 - 0.5) * (0.12 + t * 0.26);
      const jitterR = (((seed >> 10) % 1000) / 1000 - 0.5) * (30 + t * 110);
      const ang = base + twist + jitterA;
      const rr = r + jitterR;
      p._x = Math.cos(ang) * rr;
      p._y = Math.sin(ang) * rr * 0.78; // slight tilt
      p._phase = (seed % 6283) / 1000;
      p._freq = 0.4 + Math.min(2.4, p.recent / 60); // busier repos flicker faster
      p._q = `${p.name} ${p.cat} ${p.sub} ${p.lang ?? ""} ${p.repo}`.toLowerCase();
      p._arm = a;
      p._rank = i;
      stars.push(p);
    });
    // label anchor at arm tip
    const tipAng = base + 2.4;
    labels.push({ cat, x: Math.cos(tipAng) * 900, y: Math.sin(tipAng) * 900 * 0.78, count: n });
  }
  return stars;
}
const labels = [];

// ---------- sprites: pre-rendered glow per colour ----------
const spriteCache = new Map();
function sprite(color) {
  let s = spriteCache.get(color);
  if (s) return s;
  const size = 64;
  s = document.createElement("canvas");
  s.width = s.height = size;
  const g = s.getContext("2d");
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "#fff");
  grad.addColorStop(0.12, color);
  grad.addColorStop(0.35, color + "66");
  grad.addColorStop(1, color + "00");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  spriteCache.set(color, s);
  return s;
}

// ---------- camera ----------
function toScreen(x, y) {
  const c = state.cam;
  const cos = Math.cos(c.rot), sin = Math.sin(c.rot);
  const rx = x * cos - y * sin, ry = x * sin + y * cos;
  return [state.w / 2 + (rx - c.x) * c.z, state.h / 2 + (ry - c.y) * c.z];
}
function toWorld(sx, sy) {
  const c = state.cam;
  const rx = (sx - state.w / 2) / c.z + c.x, ry = (sy - state.h / 2) / c.z + c.y;
  const cos = Math.cos(-c.rot), sin = Math.sin(-c.rot);
  return [rx * cos - ry * sin, rx * sin + ry * cos];
}

function resize() {
  state.w = window.innerWidth;
  state.h = window.innerHeight;
  for (const c of [sky, snowCanvas]) {
    c.width = state.w * state.dpr;
    c.height = state.h * state.dpr;
    c.style.width = state.w + "px";
    c.style.height = state.h + "px";
  }
  ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  sctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  fitView(false);
}

function fitView(animate = true) {
  const target = { x: 0, y: 0, z: Math.min(state.w, state.h) / 2000 };
  if (!animate) Object.assign(state.cam, target);
  else state.camTarget = target;
}

// ---------- background stars (decorative dust) ----------
const dust = Array.from({ length: 700 }, (_, i) => ({
  x: (hash("d" + i) % 10000) / 10000,
  y: (hash("e" + i) % 10000) / 10000,
  r: 0.3 + (hash("f" + i) % 100) / 120,
  p: (hash("g" + i) % 628) / 100,
}));

// ---------- render ----------
let frameStars = []; // screen-space cache for hit testing
function render(now) {
  const t = (now - state.t0) / 1000;
  const c = state.cam;
  if (state.spin && !state.dragging) c.rot += 0.00035;
  if (state.camTarget) {
    c.x = lerp(c.x, state.camTarget.x, 0.08);
    c.y = lerp(c.y, state.camTarget.y, 0.08);
    c.z = lerp(c.z, state.camTarget.z, 0.08);
    if (Math.abs(c.z - state.camTarget.z) < 1e-3 && Math.hypot(c.x - state.camTarget.x, c.y - state.camTarget.y) < 0.5) state.camTarget = null;
  }

  ctx.clearRect(0, 0, state.w, state.h);

  // dust
  ctx.fillStyle = "#cfd8ff";
  for (const d of dust) {
    const a = 0.25 + 0.35 * Math.sin(t * 0.8 + d.p);
    ctx.globalAlpha = a;
    ctx.beginPath();
    ctx.arc(d.x * state.w, d.y * state.h, d.r, 0, 6.283);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // core glow
  const [cx, cy] = toScreen(0, 0);
  const coreR = 160 * c.z;
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
  core.addColorStop(0, "rgba(255,230,180,0.28)");
  core.addColorStop(0.5, "rgba(179,136,255,0.10)");
  core.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = core;
  ctx.fillRect(cx - coreR, cy - coreR, coreR * 2, coreR * 2);

  // constellation lines: connect the brightest few of each arm
  if (state.lines) {
    ctx.lineWidth = 1;
    const perArm = new Map();
    for (const p of state.stars) {
      if (p._rank > 9 || !visible(p)) continue;
      (perArm.get(p._arm) ?? perArm.set(p._arm, []).get(p._arm)).push(p);
    }
    for (const list of perArm.values()) {
      list.sort((a, b) => a._rank - b._rank);
      ctx.strokeStyle = "rgba(160,180,240,0.16)";
      ctx.beginPath();
      list.forEach((p, i) => {
        const [x, y] = toScreen(p._x, p._y);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      });
      ctx.stroke();
    }
  }

  // stars
  frameStars = [];
  ctx.globalCompositeOperation = "lighter";
  const dim = state.query || state.maturity.size < 5;
  for (const p of state.stars) {
    const vis = visible(p);
    const [x, y] = toScreen(p._x, p._y);
    if (x < -40 || y < -40 || x > state.w + 40 || y > state.h + 40) continue;
    const base = sizeOf(p) * Math.sqrt(c.z);
    const tw = 0.78 + 0.22 * Math.sin(t * p._freq + p._phase);
    const r = base * tw;
    const col = colorOf(p);
    const isSel = p === state.selected || p === state.hover;
    ctx.globalAlpha = vis ? (dim ? 1 : 0.85) : 0.07;
    const g = (isSel ? 10 : 4.2) * r;
    ctx.drawImage(sprite(col), x - g / 2, y - g / 2, g, g);
    if (isSel) {
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, r * 2.4 + 6 + Math.sin(t * 4) * 2, 0, 6.283);
      ctx.stroke();
    }
    if (vis) frameStars.push({ p, x, y, r: Math.max(r * 1.8, 7) });
  }
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;

  // labels: category names at arm tips, plus names for big/filtered stars
  ctx.font = "600 11px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(200,210,245,0.55)";
  for (const l of labels) {
    const [x, y] = toScreen(l.x, l.y);
    ctx.fillText(l.cat.toUpperCase(), x, y);
  }
  ctx.font = "500 11px Inter, system-ui, sans-serif";
  for (const s of frameStars) {
    const show = state.query || s.p === state.selected || s.p === state.hover || (s.p._rank === 0 && c.z > 0.6) || (c.z > 1.4 && s.p._rank < 6) || (c.z > 2.2 && s.p._rank < 20) || c.z > 3.5;
    if (!show) continue;
    ctx.fillStyle = "rgba(230,236,255,0.85)";
    ctx.fillText(s.p.name, s.x, s.y + s.r + 12);
  }

  renderSnow(t);
  requestAnimationFrame(render);
}

// ---------- snow (it is a holiday project, after all) ----------
const flakes = Array.from({ length: 180 }, (_, i) => ({
  x: Math.random(),
  y: Math.random(),
  r: 0.8 + Math.random() * 2.2,
  s: 0.2 + Math.random() * 0.6,
  w: Math.random() * 6.28,
}));
function renderSnow(t) {
  sctx.clearRect(0, 0, state.w, state.h);
  if (!state.snow) return;
  sctx.fillStyle = "rgba(255,255,255,0.75)";
  for (const f of flakes) {
    f.y += (f.s * 0.0009) ;
    if (f.y > 1.02) { f.y = -0.02; f.x = Math.random(); }
    const x = (f.x + Math.sin(t * 0.6 + f.w) * 0.01) * state.w;
    sctx.globalAlpha = 0.35 + 0.4 * f.s;
    sctx.beginPath();
    sctx.arc(x, f.y * state.h, f.r, 0, 6.283);
    sctx.fill();
  }
  sctx.globalAlpha = 1;
}

// ---------- interaction ----------
function hit(sx, sy) {
  let best = null, bd = 18;
  for (const s of frameStars) {
    const d = Math.hypot(s.x - sx, s.y - sy) - s.r * 0.5;
    if (d < bd) { bd = d; best = s.p; }
  }
  return best;
}

const tip = $("#tip");
let drag = null;
sky.addEventListener("pointerdown", (e) => {
  drag = { x: e.clientX, y: e.clientY, cx: state.cam.x, cy: state.cam.y, moved: false };
  sky.setPointerCapture(e.pointerId);
});
sky.addEventListener("pointermove", (e) => {
  if (drag) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.hypot(dx, dy) > 3) { drag.moved = true; state.dragging = true; sky.classList.add("dragging"); state.camTarget = null; }
    // camera lives in rotated (screen-aligned) space, so panning is a plain offset
    state.cam.x = drag.cx - dx / state.cam.z;
    state.cam.y = drag.cy - dy / state.cam.z;
    return;
  }
  const p = hit(e.clientX, e.clientY);
  state.hover = p;
  sky.style.cursor = p ? "pointer" : "grab";
  if (p) {
    tip.innerHTML = `<b>${esc(p.name)}</b><span class="m">${esc(p.sub)} · ${esc(p.lang ?? "—")}</span><br>★ ${fmt.format(p.stars)} · ${fmt.format(p.contributors)} contributors · ${fmt.format(p.year)} commits/52w`;
    tip.hidden = false;
    tip.style.left = Math.min(e.clientX + 16, state.w - 300) + "px";
    tip.style.top = Math.min(e.clientY + 16, state.h - 90) + "px";
  } else tip.hidden = true;
});
sky.addEventListener("pointerup", (e) => {
  if (drag && !drag.moved) {
    const p = hit(e.clientX, e.clientY);
    if (p) select(p); else closePanel();
  }
  drag = null; state.dragging = false; sky.classList.remove("dragging");
});
sky.addEventListener("wheel", (e) => {
  e.preventDefault();
  const c = state.cam;
  const [wx, wy] = toWorld(e.clientX, e.clientY);
  const k = Math.exp(-e.deltaY * 0.0015);
  const nz = clamp(c.z * k, 0.15, 8);
  // zoom towards cursor
  const cos = Math.cos(c.rot), sin = Math.sin(c.rot);
  const rx = wx * cos - wy * sin, ry = wx * sin + wy * cos;
  c.x = rx - (e.clientX - state.w / 2) / nz;
  c.y = ry - (e.clientY - state.h / 2) / nz;
  c.z = nz;
  state.camTarget = null;
}, { passive: false });

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

// ---------- panel ----------
const panel = $("#panel");
function select(p, fly = true) {
  state.selected = p;
  panel.hidden = false;
  $("#p-logo").src = p.logo ?? "";
  $("#p-logo").style.display = p.logo ? "" : "none";
  $("#p-name").textContent = p.name;
  $("#p-cat").textContent = `${p.cat} › ${p.sub}`;
  $("#p-desc").textContent = p.desc;
  const m = mat(p);
  $("#p-badges").innerHTML =
    `<span class="m" style="background:${MATURITY_COLOR[m]}">${m === "other" ? "landscape member" : "CNCF " + m}</span>` +
    (p.license ? `<span>${esc(p.license)}</span>` : "") +
    (p.lang ? `<span style="border-color:${langColor(p.lang)}">${esc(p.lang)}</span>` : "") +
    (p.repos > 1 ? `<span>${p.repos} repos</span>` : "");
  const facts = [
    ["Stars", fmtFull.format(p.stars)],
    ["Contributors", fmtFull.format(p.contributors)],
    ["Commits / 52w", fmtFull.format(p.year)],
    ["Commits / 4w", fmtFull.format(p.recent)],
    ["First commit", p.first ?? "—"],
    ["Last commit", p.last ?? "—"],
    ["Latest release", p.release ?? "—"],
    ["Joined CNCF", p.accepted ?? "—"],
  ];
  $("#p-facts").innerHTML = facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join("");
  $("#p-langs").innerHTML = p.langs.map(([l, pct]) => `<div class="row"><span>${esc(l)}</span><div class="bar"><i style="--c:${langColor(l)};width:${pct}%"></i></div><span>${pct}%</span></div>`).join("") || "<span class='m'>no language data</span>";
  $("#p-links").innerHTML =
    `<a href="${esc(p.repo)}" target="_blank" rel="noopener">GitHub ↗</a>` +
    (p.home ? `<a href="${esc(p.home)}" target="_blank" rel="noopener">Website ↗</a>` : "") +
    (p.releaseUrl ? `<a href="${esc(p.releaseUrl)}" target="_blank" rel="noopener">Release ↗</a>` : "") +
    `<a href="https://landscape.cncf.io/?item=${encodeURIComponent(p.id)}" target="_blank" rel="noopener">Landscape ↗</a>`;
  drawSpark(p.weeks, colorOf(p));
  if (fly) {
    const c = state.cam, cos = Math.cos(c.rot), sin = Math.sin(c.rot);
    state.camTarget = { x: p._x * cos - p._y * sin, y: p._x * sin + p._y * cos, z: Math.max(c.z, 1.8) };
  }
  history.replaceState(null, "", "#" + encodeURIComponent(p.id));
}
function closePanel() {
  state.selected = null;
  panel.hidden = true;
  history.replaceState(null, "", location.pathname);
}
$("#close").onclick = closePanel;

function drawSpark(weeks, color) {
  const cv = $("#spark");
  const g = cv.getContext("2d");
  const W = cv.width, H = cv.height;
  g.clearRect(0, 0, W, H);
  if (!weeks.length) return;
  const max = Math.max(1, ...weeks);
  const bw = W / weeks.length;
  weeks.forEach((v, i) => {
    const h = (v / max) * (H - 14);
    g.fillStyle = color;
    g.globalAlpha = 0.35 + 0.65 * (i / weeks.length);
    g.fillRect(i * bw + 1, H - h, Math.max(1, bw - 2), h);
  });
  g.globalAlpha = 1;
  g.fillStyle = "rgba(200,210,245,0.6)";
  g.font = "11px system-ui";
  g.fillText(`peak ${max}/wk`, 4, 11);
}

// ---------- controls ----------
$("#q").addEventListener("input", (e) => { state.query = e.target.value.trim().toLowerCase(); });
$("#maturity").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  b.classList.toggle("on");
  state.maturity[b.classList.contains("on") ? "add" : "delete"](b.dataset.m);
});
$("#color").onchange = (e) => { state.color = e.target.value; if (state.selected) drawSpark(state.selected.weeks, colorOf(state.selected)); };
$("#size").onchange = (e) => { state.size = e.target.value; };
$("#lines").onchange = (e) => { state.lines = e.target.checked; };
$("#snowy").onchange = (e) => { state.snow = e.target.checked; };
$("#spin").onchange = (e) => { state.spin = e.target.checked; };
$("#reset").onclick = () => { fitView(); state.cam.rot = 0; };
window.addEventListener("keydown", (e) => {
  if (e.key === "/" && document.activeElement !== $("#q")) { e.preventDefault(); $("#q").focus(); }
  if (e.key === "Escape") { closePanel(); $("#q").blur(); }
});
window.addEventListener("resize", resize);
window.addEventListener("scroll", () => { $("#hint").style.opacity = scrollY > 80 ? 0 : 1; }, { passive: true });

// ---------- observatory (below the fold) ----------
function board(title, sub, list, valueFn) {
  const el = document.createElement("div");
  el.className = "board";
  el.innerHTML = `<h3>${title}</h3><p class="sub">${sub}</p><ol>${list
    .map((p) => `<li data-id="${esc(p.id)}"><i style="--c:${MATURITY_COLOR[mat(p)]}"></i><span>${esc(p.name)}</span><b>${valueFn(p)}</b></li>`)
    .join("")}</ol>`;
  return el;
}
function bars(el, rows, color) {
  const max = Math.max(...rows.map((r) => r[1]));
  el.innerHTML = rows.map(([k, v, label]) => `<div class="row"><span title="${esc(k)}">${esc(k)}</span><div class="bar"><i style="--c:${color(k)};width:${(v / max) * 100}%"></i></div><span>${label ?? fmt.format(v)}</span></div>`).join("");
}

function observatory(data) {
  const P = data.projects;
  const cncf = P.filter((p) => ["graduated", "incubating", "sandbox"].includes(p.maturity));
  const sortBy = (arr, f, n = 10) => [...arr].sort((a, b) => f(b) - f(a)).slice(0, n);
  const boards = $("#boards");
  boards.append(
    board("Brightest stars", "Most GitHub stars, whole landscape", sortBy(P, (p) => p.stars), (p) => "★ " + fmt.format(p.stars)),
    board("Brightest CNCF projects", "Most stars among graduated / incubating / sandbox", sortBy(cncf, (p) => p.stars), (p) => "★ " + fmt.format(p.stars)),
    board("Busiest forges", "Commits to the default branch, last 52 weeks", sortBy(P, (p) => p.year), (p) => fmt.format(p.year)),
    board("Hottest right now", "Commits in the last 4 weeks", sortBy(P, (p) => p.recent), (p) => fmt.format(p.recent)),
    board("Largest crews", "Distinct contributors", sortBy(P, (p) => p.contributors), (p) => fmt.format(p.contributors)),
    board("Rising sandbox", "Sandbox projects by commits / stars ratio (min 500 stars)", sortBy(cncf.filter((p) => p.maturity === "sandbox" && p.stars >= 500), (p) => p.year / p.stars), (p) => (p.year / p.stars).toFixed(2)),
    board("Elders", "Oldest first commit in the landscape", [...P.filter((p) => p.first)].sort((a, b) => a.first.localeCompare(b.first)).slice(0, 10), (p) => p.first.slice(0, 4)),
    board("Freshest releases", "Most recent tagged release", [...P.filter((p) => p.release)].sort((a, b) => b.release.localeCompare(a.release)).slice(0, 10), (p) => p.release),
  );
  boards.addEventListener("click", (e) => {
    const li = e.target.closest("li[data-id]"); if (!li) return;
    const p = state.byId.get(li.dataset.id); if (!p) return;
    scrollTo({ top: 0, behavior: "smooth" });
    select(p);
  });

  bars($("#langchart"), data.meta.languages.slice(0, 12).map((l) => [l.name, l.count]), langColor);
  const bm = data.meta.totals.byMaturity;
  bars($("#matchart"), ["graduated", "incubating", "sandbox", "archived", "other"].map((m) => [m === "other" ? "everyone else" : m, bm[m] ?? 0]), (k) => MATURITY_COLOR[k === "everyone else" ? "other" : k]);
  const byCat = new Map();
  for (const p of P) byCat.set(p.cat, (byCat.get(p.cat) ?? 0) + p.stars);
  bars($("#catchart"), [...byCat].sort((a, b) => b[1] - a[1]), () => "#4cc9f0");

  // Star of the day: deterministic pick from CNCF projects by date
  const today = new Date().toISOString().slice(0, 10);
  const alive = cncf.filter((p) => p.recent > 0);
  const pick = alive[hash(today) % alive.length];
  const sod = $("#sod");
  sod.innerHTML = `${pick.logo ? `<img src="${esc(pick.logo)}" alt="">` : ""}<div><small>Star of the day · ${today}</small><b>${esc(pick.name)}</b><p>${esc(pick.desc)} — ★ ${fmt.format(pick.stars)}, ${fmt.format(pick.year)} commits this year.</p></div>`;
  sod.onclick = () => { scrollTo({ top: 0, behavior: "smooth" }); select(pick); };

  $("#generated").textContent = `Snapshot: ${new Date(data.meta.generatedAt).toUTCString()}.`;
  for (const [k, v] of Object.entries({ projects: data.meta.projects, stars: data.meta.totals.stars, contributors: data.meta.totals.contributors, commits: data.meta.totals.commitsYear })) {
    $(`#totals [data-k="${k}"]`).textContent = fmt.format(v);
  }
}

// ---------- boot ----------
async function boot() {
  const res = await fetch("data/landscape.json");
  const data = await res.json();
  state.data = data;
  state.stars = layout(data.projects, data.meta.categories);
  for (const p of state.stars) state.byId.set(p.id, p);
  resize();
  observatory(data);
  requestAnimationFrame(render);
  const want = decodeURIComponent(location.hash.slice(1));
  if (want && state.byId.has(want)) setTimeout(() => select(state.byId.get(want)), 400);
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) { state.spin = false; state.snow = false; $("#spin").checked = false; $("#snowy").checked = false; }
}
boot().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML("beforeend", `<p style="position:fixed;inset:auto 0 0;z-index:9;text-align:center;color:#f07178;background:#000a">The sky failed to load: ${esc(e.message)}</p>`);
});
