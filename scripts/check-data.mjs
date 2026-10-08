#!/usr/bin/env node
// Sanity checks for the distilled dataset so a broken upstream never ships an empty sky.
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const file = resolve(dirname(fileURLToPath(import.meta.url)), "../site/data/landscape.json");
const data = JSON.parse(await readFile(file, "utf8"));

const fail = (msg) => { console.error("[check-data] FAIL:", msg); process.exit(1); };

if (!Array.isArray(data.projects) || data.projects.length < 500) fail(`too few projects: ${data.projects?.length}`);
if (!data.meta?.categories?.length) fail("no categories");
if (data.meta.totals.stars < 1_000_000) fail(`suspiciously few stars: ${data.meta.totals.stars}`);
const k8s = data.projects.find((p) => p.repo === "https://github.com/kubernetes/kubernetes");
if (!k8s) fail("kubernetes missing");
if (k8s.weeks.length !== 52) fail(`kubernetes has ${k8s.weeks.length} weeks of participation data`);
for (const p of data.projects) {
  for (const k of ["id", "name", "cat", "sub", "repo"]) if (!p[k]) fail(`${p.id ?? "?"} missing ${k}`);
}
console.error(`[check-data] OK: ${data.projects.length} projects, ${data.meta.totals.stars} stars, generated ${data.meta.generatedAt}`);
