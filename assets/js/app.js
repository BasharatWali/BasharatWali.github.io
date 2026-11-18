/* Portfolio renderer.
 * 1. Renders data/projects.json (built by GitHub Actions from your repos + overrides).
 * 2. Then asks the GitHub API directly, so a repo pushed since the last build
 *    appears immediately, and deleted/private repos disappear.
 */
(() => {
  "use strict";

  const USER = "BasharatWali";
  const API = "https://api.github.com";
  const LANG_COLORS = {
    "Jupyter Notebook": "#DA5B0B", Python: "#3572A5", JavaScript: "#f1e05a", TypeScript: "#3178c6",
    HTML: "#e34c26", CSS: "#563d7c", "C++": "#f34b7d", C: "#555555", Java: "#b07219", R: "#198CE7",
    MATLAB: "#e16737", Shell: "#89e051", Go: "#00ADD8", Rust: "#dea584", Dockerfile: "#384d54",
  };

  const grid = document.getElementById("project-grid");
  const filtersEl = document.getElementById("filters");
  const tpl = document.getElementById("card-tpl");
  const syncEl = document.getElementById("sync-status");

  let projects = [];
  let rules = { exclude: [], hide_topic: "hide-from-portfolio", hide_archived: true, new_badge_days: 45, categories: [], default_category: "Projects" };
  let activeFilter = "All";

  /* ---------- helpers ---------- */
  const fmtDate = (iso) => new Date(iso).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
  const daysSince = (iso) => (Date.now() - new Date(iso).getTime()) / 86400000;
  const prettyName = (name) => name.replace(/[-_]+/g, " ").trim();
  const norm = (s) => " " + String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ") + " ";

  function cleanInline(text) {
    return text
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/<[^>]+>/g, "")
      .replace(/\*\*|__|`|\*/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function truncate(text, limit = 260) {
    if (text.length <= limit) return text;
    const cut = text.slice(0, limit);
    const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
    if (end > limit * 0.5) return cut.slice(0, end + 1);
    return cut.slice(0, cut.lastIndexOf(" ")).replace(/[,;:]$/, "") + "…";
  }

  function resolveImage(src, repo) {
    if (/shields\.io|badge|\.svg(\?|$)/i.test(src)) return null;
    const blob = src.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/blob\/(.+)/);
    if (blob) return `https://raw.githubusercontent.com/${blob[1]}/${blob[2].split("?")[0]}`;
    if (/^https?:\/\//.test(src)) return src;
    const path = src.replace(/^\.?\//, "").split("#")[0];
    return `https://raw.githubusercontent.com/${USER}/${repo.name}/${repo.default_branch}/${path}`;
  }

  function parseReadme(md, repo) {
    const info = {};
    const h1 = md.match(/^#\s+(.+?)\s*#*\s*$/m);
    if (h1) info.readmeTitle = cleanInline(h1[1]);
    const imgRe = /<img[^>]+src=["']([^"']+)["']|!\[[^\]]*\]\(([^)\s]+)/g;
    let m;
    while ((m = imgRe.exec(md))) {
      const img = resolveImage(m[1] || m[2], repo);
      if (img) { info.image = img; break; }
    }
    const body = md.replace(/```[\s\S]*?```/g, "").replace(/<!--[\s\S]*?-->/g, "");
    for (const raw of body.split(/\n\s*\n/)) {
      const block = raw.trim();
      if (!block || /^(#|<|!\[|\||>|[-*+]\s|\d+\.\s|\[!\[|---|===)/.test(block)) continue;
      const summary = cleanInline(block);
      if (summary.length >= 40) { info.summary = truncate(summary); break; }
    }
    return info;
  }

  function categorize(repo, readmeTitle) {
    const hay = norm([repo.name, repo.description, readmeTitle, (repo.topics || []).join(" ")].join(" "));
    for (const cat of rules.categories || []) {
      if (cat.keywords.some((k) => hay.includes(norm(k)))) return cat.name;
    }
    return rules.default_category || "Projects";
  }

  function isPublished(repo) {
    if (repo.fork || repo.private) return false;
    if (repo.archived && rules.hide_archived) return false;
    const n = repo.name.toLowerCase();
    if (n === USER.toLowerCase() || n === `${USER}.github.io`.toLowerCase()) return false;
    if ((rules.exclude || []).includes(repo.name)) return false;
    if ((repo.topics || []).includes(rules.hide_topic)) return false;
    const pushedAfterCreate = (new Date(repo.pushed_at) - new Date(repo.created_at)) / 1000 > 60;
    return repo.size > 0 || pushedAfterCreate;
  }

  async function projectFromApi(repo) {
    let readme = {};
    try {
      const res = await fetch(`${API}/repos/${USER}/${repo.name}/readme`, { headers: { Accept: "application/vnd.github.raw" } });
      if (res.ok) readme = parseReadme(await res.text(), repo);
    } catch (e) { /* README is optional */ }
    const t = readme.readmeTitle;
    return {
      name: repo.name,
      url: repo.html_url,
      homepage: repo.homepage || null,
      title: t && t.length <= 70 ? t : prettyName(repo.name),
      summary: repo.description || readme.summary || "",
      image: readme.image || null,
      image_fit: "cover",
      image_bg: null,
      category: categorize(repo, t),
      highlight: null,
      tags: (repo.topics || []).slice(0, 5).map((x) => x.replace(/-/g, " ")),
      language: repo.language,
      stars: repo.stargazers_count,
      created_at: repo.created_at,
      pushed_at: repo.pushed_at,
      featured: false,
      order: null,
    };
  }

  function sortProjects(list) {
    return list.sort((a, b) => {
      const ao = a.order ?? Infinity, bo = b.order ?? Infinity;
      if (ao !== bo) return ao - bo;
      return new Date(b.created_at) - new Date(a.created_at);
    });
  }

  /* ---------- rendering ---------- */
  function renderFilters() {
    const counts = projects.reduce((acc, p) => ((acc[p.category] = (acc[p.category] || 0) + 1), acc), {});
    const cats = ["All", ...Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b))];
    if (!cats.includes(activeFilter)) activeFilter = "All";
    filtersEl.replaceChildren(...cats.map((c) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "filter";
      b.setAttribute("aria-pressed", String(c === activeFilter));
      b.textContent = c;
      const n = document.createElement("span");
      n.className = "n";
      n.textContent = c === "All" ? projects.length : counts[c];
      b.append(n);
      b.addEventListener("click", () => { activeFilter = c; renderFilters(); renderGrid(); });
      return b;
    }));
    document.getElementById("count-projects").textContent = projects.length;
    document.getElementById("count-domains").textContent = Object.keys(counts).length;
  }

  function card(p, i) {
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.style.animationDelay = `${Math.min(i, 8) * 50}ms`;

    const media = node.querySelector(".card__media");
    media.href = p.url;
    const img = media.querySelector("img");
    if (p.image) {
      img.src = p.image;
      if (p.image_fit === "contain") media.classList.add("is-contain");
      if (p.image_bg) media.style.background = p.image_bg;
      img.addEventListener("error", () => { img.remove(); media.classList.add("is-empty"); media.textContent = initials(p.title); }, { once: true });
    } else {
      img.remove();
      media.classList.add("is-empty");
      media.textContent = initials(p.title);
    }

    node.querySelector(".card__cat").textContent = p.category;
    if (daysSince(p.created_at) <= (rules.new_badge_days || 45)) node.querySelector(".badge-new").hidden = false;

    const titleLink = node.querySelector(".card__title a");
    titleLink.href = p.url;
    titleLink.textContent = p.title;

    node.querySelector(".card__summary").textContent = p.summary || "Details coming soon. See the repository for the code.";
    if (p.highlight) {
      const h = node.querySelector(".card__highlight");
      h.textContent = p.highlight;
      h.hidden = false;
    }

    const tags = node.querySelector(".card__tags");
    (p.tags || []).forEach((t) => { const li = document.createElement("li"); li.textContent = t; tags.append(li); });

    if (p.language) {
      node.querySelector(".lang__dot").style.background = LANG_COLORS[p.language] || "var(--muted)";
      node.querySelector(".lang__name").textContent = p.language === "Jupyter Notebook" ? "Jupyter" : p.language;
    } else {
      node.querySelector(".lang").remove();
    }
    const date = node.querySelector(".card__date");
    date.textContent = fmtDate(p.pushed_at);
    date.title = `Last updated ${new Date(p.pushed_at).toLocaleDateString("en-GB")}`;

    const links = node.querySelector(".card__links");
    if (p.homepage) links.append(link(p.homepage, "Demo"));
    links.append(link(p.url, "Code →"));
    return node;
  }

  function link(href, text) {
    const a = document.createElement("a");
    a.href = href; a.target = "_blank"; a.rel = "noopener"; a.textContent = text;
    return a;
  }

  function initials(title) {
    return title.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
  }

  function renderGrid() {
    const list = activeFilter === "All" ? projects : projects.filter((p) => p.category === activeFilter);
    grid.replaceChildren(...list.map(card));
  }

  function render() { renderFilters(); renderGrid(); }

  function setSync(text, live) {
    syncEl.textContent = text;
    syncEl.classList.toggle("is-live", !!live);
  }

  /* ---------- data flow ---------- */
  async function loadSnapshot() {
    try {
      const res = await fetch("data/projects.json", { cache: "no-cache" });
      if (!res.ok) throw new Error(res.status);
      const data = await res.json();
      rules = { ...rules, ...(data.rules || {}) };
      projects = sortProjects(data.projects || []);
      document.getElementById("build-info").textContent = `site built ${fmtDate(data.generated_at)} · auto-synced with GitHub`;
      setSync(`snapshot ${new Date(data.generated_at).toLocaleDateString("en-GB")}`, false);
      render();
      return true;
    } catch (e) {
      return false;
    }
  }

  async function syncLive() {
    const res = await fetch(`${API}/users/${USER}/repos?per_page=100&type=owner&sort=created`);
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    const live = (await res.json()).filter(isPublished);
    const liveNames = new Set(live.map((r) => r.name));
    const known = new Map(projects.map((p) => [p.name, p]));

    const fresh = await Promise.all(live.filter((r) => !known.has(r.name)).map(projectFromApi));
    for (const r of live) {
      const p = known.get(r.name);
      if (!p) continue;
      p.stars = r.stargazers_count;
      p.pushed_at = r.pushed_at;
      p.language = r.language || p.language;
      if (r.homepage) p.homepage = r.homepage;
      if (!p.summary && r.description) p.summary = r.description;
    }
    projects = sortProjects([...projects.filter((p) => liveNames.has(p.name)), ...fresh]);
    render();
    setSync("live from GitHub", true);
  }

  async function init() {
    for (let i = 0; i < 6; i++) {
      const s = document.createElement("div");
      s.className = "skeleton";
      grid.append(s);
    }
    const hadSnapshot = await loadSnapshot();
    try {
      await syncLive();
    } catch (e) {
      if (!hadSnapshot) {
        grid.innerHTML = `<p class="muted">Couldn't load projects right now. Browse them on <a class="accent" href="https://github.com/${USER}?tab=repositories">GitHub</a>.</p>`;
        setSync("offline", false);
      }
    }
  }

  /* ---------- page chrome ---------- */
  document.getElementById("year").textContent = new Date().getFullYear();

  // Hide contact links whose placeholder hasn't been filled in yet.
  document.querySelectorAll('a[href*="YOUR-"]').forEach((a) => (a.hidden = true));

  document.getElementById("theme-toggle").addEventListener("click", () => {
    const root = document.documentElement;
    const current = root.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = current === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    try { localStorage.setItem("theme", next); } catch (e) { /* private mode */ }
  });

  init();
})();
