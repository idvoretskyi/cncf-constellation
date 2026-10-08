# CNCF Constellation ✦

> An artificial night sky where every star is a project from the
> [CNCF Landscape](https://landscape.cncf.io). Brightness is GitHub stars.
> The flicker is commit activity. There is snow, because it is a holiday project.

**Live:** https://idvoretskyi.github.io/cncf-constellation/

## What it is

A single-page, dependency-free website that renders ~1000 landscape projects as a
spiral galaxy on a `<canvas>`:

- **One spiral arm per landscape category** (Orchestration & Management, Observability, …).
  The brightest projects sit near the core; the long tail trails out to the arm tips.
- **Star size** — GitHub stars, contributors, or commits over the last 52 weeks.
- **Star colour** — CNCF maturity (graduated / incubating / sandbox / archived / everyone else),
  primary language, recent activity heat, or project age.
- **Twinkle rate** — scales with commits in the last four weeks. Busy repos flicker faster.
- **Constellation lines** connect the ten brightest stars of each arm.
- **Click a star** for the full dossier: 52-week commit sparkline, language breakdown,
  license, first/last commit, latest release, links to GitHub and the landscape.
- **The Observatory** (scroll down) — leaderboards: brightest, busiest, hottest right now,
  largest crews, rising sandbox projects, elders, freshest releases; plus language,
  maturity and category charts, and a deterministic *Star of the Day*.

Pan by dragging, zoom with the wheel, `/` to search, `Esc` to close.
Deep links work: `#orchestration-management--scheduling-orchestration--kubernetes`.

## Where the data comes from

The CNCF publishes its landscape through [landscape2](https://github.com/cncf/landscape2),
which exposes a machine-readable dump at `https://landscape.cncf.io/data/full.json`.
That file already contains the GitHub statistics the CNCF collects daily for every
repository in the landscape (stars, contributors, weekly participation, languages, license,
first/latest commit, latest release). No GitHub API tokens are required.

`scripts/build-data.mjs` fetches that dump and distills it to `site/data/landscape.json`
(~1 MiB). A GitHub Actions workflow re-runs it nightly and redeploys to GitHub Pages.

## Run it locally

Requires Node 20+ (for `fetch`) and any static file server.

```bash
make data    # fetch + distill the landscape dataset
make check   # sanity-check the dataset
make serve   # http://localhost:8080
```

No npm install. No build step. `site/` is the whole website.

## Layout

```
.
├── .github/workflows/pages.yml   # nightly data refresh + Pages deploy
├── scripts/
│   ├── build-data.mjs            # full.json -> site/data/landscape.json
│   └── check-data.mjs            # refuses to ship an empty sky
└── site/
    ├── index.html
    ├── styles.css
    ├── app.js                    # layout, renderer, interaction, observatory
    └── data/landscape.json       # generated
```

## Caveats

- "Everyone else" covers landscape members and non-CNCF open source projects that
  happen to have a GitHub repo listed; the landscape is not a ranking and neither is this.
- Stars shown are for the project's *primary* repository. Multi-repo projects also carry
  a `starsAll` field in the dataset, if you want to extend things.
- Participation stats come from GitHub's `stats/participation` endpoint, i.e. commits to
  the default branch only.

## License

Apache-2.0. Landscape data is © the CNCF and landscape contributors;
this project is not affiliated with or endorsed by the CNCF.
