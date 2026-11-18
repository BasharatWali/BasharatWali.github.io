#!/usr/bin/env python3
"""Build data/projects.json from the owner's public GitHub repositories.

Standard library only. Runs in GitHub Actions (uses GITHUB_TOKEN when set)
or locally without a token (60 API requests/hour is plenty).

For each public, non-fork repo that has had at least one push, it collects
GitHub metadata and reads the README for a title, a one-paragraph summary
and the first image. data/overrides.json can replace any of these fields.
"""
import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
CONFIG = json.loads((DATA / "config.json").read_text(encoding="utf-8"))
OVERRIDES = json.loads((DATA / "overrides.json").read_text(encoding="utf-8"))
USER = CONFIG["github_user"]
API = "https://api.github.com"
TOKEN = os.environ.get("GITHUB_TOKEN")
SUMMARY_MAX = 260


def api_get(url, raw=False):
    accept = "application/vnd.github.raw" if raw else "application/vnd.github+json"
    req = urllib.request.Request(url, headers={"User-Agent": "portfolio-builder", "Accept": accept})
    if TOKEN:
        req.add_header("Authorization", f"Bearer {TOKEN}")
    with urllib.request.urlopen(req, timeout=30) as resp:
        body = resp.read().decode("utf-8", "replace")
    return body if raw else json.loads(body)


def parse_time(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def list_repos():
    repos, page = [], 1
    while True:
        batch = api_get(f"{API}/users/{USER}/repos?per_page=100&type=owner&sort=created&page={page}")
        repos.extend(batch)
        if len(batch) < 100:
            return repos
        page += 1


def is_published(repo):
    """Public, not a fork, not excluded, and has received at least one push."""
    name = repo["name"]
    if repo.get("fork") or repo.get("private"):
        return False
    if repo.get("archived") and CONFIG.get("hide_archived", True):
        return False
    if name.lower() in {USER.lower(), f"{USER}.github.io".lower()}:
        return False
    if name in CONFIG.get("exclude", []) or OVERRIDES.get(name, {}).get("hide"):
        return False
    if CONFIG.get("hide_topic") in repo.get("topics", []):
        return False
    pushed_after_create = (parse_time(repo["pushed_at"]) - parse_time(repo["created_at"])).total_seconds() > 60
    return repo.get("size", 0) > 0 or pushed_after_create


def clean_inline(text):
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", text)          # images
    text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)       # links -> text
    text = re.sub(r"<[^>]+>", "", text)                        # html tags
    text = text.replace("**", "").replace("__", "").replace("`", "").replace("*", "")
    return re.sub(r"\s+", " ", text).strip()


def truncate(text, limit=SUMMARY_MAX):
    if len(text) <= limit:
        return text
    cut = text[:limit]
    end = max(cut.rfind(". "), cut.rfind("! "), cut.rfind("? "))
    if end > limit * 0.5:
        return cut[: end + 1]
    return cut[: cut.rfind(" ")].rstrip(",;:") + "…"


def resolve_image(src, repo):
    if re.search(r"shields\.io|badge|\.svg(\?|$)", src, re.I):
        return None
    blob = re.match(r"https://github\.com/([^/]+/[^/]+)/blob/(.+)", src)
    if blob:
        return f"https://raw.githubusercontent.com/{blob.group(1)}/{blob.group(2).split('?')[0]}"
    if src.startswith(("http://", "https://")):
        return src
    path = src.lstrip("./").split("#")[0]
    return f"https://raw.githubusercontent.com/{USER}/{repo['name']}/{repo['default_branch']}/{path}"


def parse_readme(markdown, repo):
    info = {}
    h1 = re.search(r"^#\s+(.+?)\s*#*\s*$", markdown, re.M)
    if h1:
        info["readme_title"] = clean_inline(h1.group(1))

    for match in re.finditer(r"<img[^>]+src=[\"']([^\"']+)[\"']|!\[[^\]]*\]\(([^)\s]+)", markdown):
        image = resolve_image(match.group(1) or match.group(2), repo)
        if image:
            info["image"] = image
            break

    body = re.sub(r"```.*?```", "", markdown, flags=re.S)
    body = re.sub(r"<!--.*?-->", "", body, flags=re.S)
    for block in re.split(r"\n\s*\n", body):
        block = block.strip()
        if not block or re.match(r"^(#|<|!\[|\||>|[-*+]\s|\d+\.\s|\[!\[|---|===)", block):
            continue
        summary = clean_inline(block)
        if len(summary) >= 40:
            info["summary"] = truncate(summary)
            break
    return info


def categorize(repo, readme_title):
    haystack = " ".join([repo["name"], repo.get("description") or "", readme_title or "", " ".join(repo.get("topics", []))])
    haystack = " " + re.sub(r"[^a-z0-9]+", " ", haystack.lower()) + " "
    for category in CONFIG.get("categories", []):
        for keyword in category["keywords"]:
            if f" {re.sub(r'[^a-z0-9]+', ' ', keyword.lower()).strip()} " in haystack:
                return category["name"]
    return CONFIG.get("default_category", "Projects")


def pretty_name(name):
    return re.sub(r"[-_]+", " ", name).strip()


def build_project(repo):
    try:
        readme = parse_readme(api_get(f"{API}/repos/{USER}/{repo['name']}/readme", raw=True), repo)
    except urllib.error.HTTPError:
        readme = {}
    readme_title = readme.get("readme_title")
    project = {
        "name": repo["name"],
        "url": repo["html_url"],
        "homepage": repo.get("homepage") or None,
        "title": readme_title if readme_title and len(readme_title) <= 70 else pretty_name(repo["name"]),
        "summary": repo.get("description") or readme.get("summary") or "",
        "image": readme.get("image"),
        "image_fit": "cover",
        "image_bg": None,
        "category": categorize(repo, readme_title),
        "highlight": None,
        "tags": [t.replace("-", " ") for t in repo.get("topics", [])][:5],
        "language": repo.get("language"),
        "stars": repo.get("stargazers_count", 0),
        "created_at": repo["created_at"],
        "pushed_at": repo["pushed_at"],
        "featured": False,
        "order": None,
    }
    override = OVERRIDES.get(repo["name"], {})
    for key, value in override.items():
        if key in project or key in {"order"}:
            project[key] = value
    project["featured"] = project["order"] is not None
    return project


def main():
    try:
        repos = [r for r in list_repos() if is_published(r)]
    except urllib.error.URLError as err:
        sys.exit(f"GitHub API request failed: {err}")

    projects = [build_project(r) for r in repos]
    projects.sort(key=lambda p: (p["order"] is None, p["order"] or 0, -parse_time(p["created_at"]).timestamp()))

    output = {
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "user": USER,
        "rules": {
            "exclude": CONFIG.get("exclude", []) + [n for n, o in OVERRIDES.items() if isinstance(o, dict) and o.get("hide")],
            "hide_topic": CONFIG.get("hide_topic"),
            "hide_archived": CONFIG.get("hide_archived", True),
            "new_badge_days": CONFIG.get("new_badge_days", 45),
            "categories": CONFIG.get("categories", []),
            "default_category": CONFIG.get("default_category", "Projects"),
        },
        "projects": projects,
    }
    (DATA / "projects.json").write_text(json.dumps(output, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {len(projects)} projects to data/projects.json")


if __name__ == "__main__":
    main()
