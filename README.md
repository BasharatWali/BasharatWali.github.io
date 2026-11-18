# basharatwali.github.io

Source for my portfolio at **https://basharatwali.github.io**. It's a static site (HTML, CSS and vanilla JS) that lists my public GitHub repositories and keeps that list up to date on its own.

## How it stays up to date

1. **Build (GitHub Actions):** `scripts/build_projects.py` reads every public, non-fork repo that has had at least one push. It writes `data/projects.json` with each repo's metadata and the title, one-paragraph summary and first image from its README. The workflow runs on every push, every 6 hours and on demand, then deploys to GitHub Pages.
2. **Live check (browser):** on each visit, `assets/js/app.js` also asks the GitHub API for the current repo list. A repo pushed since the last build appears right away, and a deleted or private repo disappears. If the API is unreachable or rate-limited, the built snapshot is shown.

## Customising

| File | What to change |
|---|---|
| `data/overrides.json` | Per-repo title, order, category, highlight (headline result), tags, image fit |
| `data/config.json` | Repos to exclude, auto-category keywords, the "New" badge window |
| `index.html` | Hero, skills, about and contact text |

To hide a repo, add the topic `hide-from-portfolio` to it on GitHub, or list it under `exclude`.

## Run locally

```bash
python3 scripts/build_projects.py   # refresh data/projects.json
python3 -m http.server 8000         # open http://localhost:8000
```

## Author

**Basharat Ali**, M.S. Artificial Intelligence, NUST, Islamabad.
