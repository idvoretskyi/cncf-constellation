#!/usr/bin/env node
// Fetches the CNCF landscape2 dataset and distills it into a compact JSON
// consumed by the static site. No dependencies beyond Node 20+.

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE = process.env.LANDSCAPE_URL ?? "https://landscape.cncf.io/data/full.json";
const LOGO_BASE = "https://landscape.cncf.io/";
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "../site/data/landscape.json");

const log = (...a) => console.error("[build-data]", ...a);

function pickLanguages(languages = {}) {
  const total = Object.values(languages).reduce((s, v) => s + v, 0) || 1;
  return Object.entries(languages)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, bytes]) => [name, Math.round((bytes / total) * 1000) / 10]);
}

function day(ts) {
  return ts ? ts.slice(0, 10) : null;
}

async function main() {
  log("fetching", SOURCE);
  const res = await fetch(SOURCE, { headers: { "user-agent": "cncf-constellation/1.0" } });
  if (!res.ok) throw new Error(`fetch failed: ${res.status} ${res.statusText}`);
  const full = await res.json();

  const gh = full.github_data ?? {};
  const projects = [];
  const seen = new Set();

  for (const item of full.items ?? []) {
    const repos = item.repositories ?? [];
    if (!repos.length) continue;
    const primary = repos.find((r) => r.primary) ?? repos[0];
    const stats = gh[primary.url];
    if (!stats) continue;
    if (seen.has(primary.url)) continue;
    seen.add(primary.url);

    // Aggregate stars across all repos we have data for.
    let starsAll = 0;
    let reposWithData = 0;
    for (const r of repos) {
      const s = gh[r.url];
      if (s) {
        starsAll += s.stars ?? 0;
        reposWithData++;
      }
    }

    const weeks = Array.isArray(stats.participation_stats) ? stats.participation_stats.slice(-52) : [];
    const langs = pickLanguages(stats.languages);

    projects.push({
      id: item.id,
      name: item.name,
      cat: item.category,
      sub: item.subcategory,
      maturity: item.maturity ?? null,
      member: item.member_subcategory ?? null,
      repo: primary.url,
      repos: repos.length,
      reposWithData,
      home: item.homepage_url ?? item.website ?? null,
      logo: item.logo ? LOGO_BASE + item.logo : null,
      desc: stats.description ?? item.description ?? "",
      stars: stats.stars ?? 0,
      starsAll,
      contributors: stats.contributors?.count ?? 0,
      lang: langs[0]?.[0] ?? null,
      langs,
      license: stats.license ?? null,
      first: day(stats.first_commit?.ts),
      last: day(stats.latest_commit?.ts),
      release: day(stats.latest_release?.ts),
      releaseUrl: stats.latest_release?.url ?? null,
      accepted: item.accepted_at ?? null,
      graduated: item.graduated_at ?? null,
      incubating: item.incubating_at ?? null,
      archived: item.archived_at ?? null,
      weeks,
      year: weeks.reduce((s, v) => s + v, 0),
      recent: weeks.slice(-4).reduce((s, v) => s + v, 0),
      topics: (stats.topics ?? []).slice(0, 8),
    });
  }

  projects.sort((a, b) => b.stars - a.stars);

  const categories = [...new Set(projects.map((p) => p.cat))].sort();
  const languages = [...projects.reduce((m, p) => (p.lang ? m.set(p.lang, (m.get(p.lang) ?? 0) + 1) : m), new Map())]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));

  const totals = projects.reduce(
    (t, p) => {
      t.stars += p.stars;
      t.contributors += p.contributors;
      t.commitsYear += p.year;
      t.byMaturity[p.maturity ?? "other"] = (t.byMaturity[p.maturity ?? "other"] ?? 0) + 1;
      return t;
    },
    { stars: 0, contributors: 0, commitsYear: 0, byMaturity: {} },
  );

  const out = {
    meta: {
      generatedAt: new Date().toISOString(),
      source: SOURCE,
      items: full.items?.length ?? 0,
      projects: projects.length,
      totals,
      categories,
      languages,
    },
    projects,
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(out));
  log(`wrote ${OUT}: ${projects.length} projects, ${categories.length} categories, ${(JSON.stringify(out).length / 1024).toFixed(0)} KiB`);
}

main().catch((err) => {
  log("ERROR", err);
  process.exit(1);
});
