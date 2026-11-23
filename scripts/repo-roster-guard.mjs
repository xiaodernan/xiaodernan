// repo-roster-guard.mjs — the LIVE half of the profile gate.
//
// The offline gate (profile-guard.mjs) checks the README against the last fetched snapshot.
// This one asks GitHub RIGHT NOW whether that snapshot still holds:
//
//   ① every repository the README links to must still exist — a link to a deleted repo is a
//      404 with a nice caption next to it (the three course repos were exactly this: they
//      live under ReverseRain / sustech-cs304, not under xiaodernan/);
//   ② every star number written next to a link must match the live star count;
//   ③ every PUBLIC repository of the account must appear in the README (the user asked for all
//      projects to be listed; a missing one never announces itself);
//   ④ the inventory counts in the README must match the live counts.
//
// 口径: the owner's own PUBLIC repos (private repos are never listed and never counted), forks
// counted separately. Third-party org repos are only checked for existence, never counted.
//
// Run: GH_PAT=ghp_... node scripts/repo-roster-guard.mjs   (GITHUB_TOKEN also works)
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OWNER = "xiaodernan";
const readme = readFileSync(resolve(root, "README.md"), "utf8");

const token = process.env.GH_PAT || process.env.GITHUB_TOKEN || "";
const headers = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "xiaodernan-profile-guard",
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
};
const get = async (url) => {
  const r = await fetch(url, { headers, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`${url} -> ${r.status} ${r.statusText}`);
  return r.json();
};

// ── 1 · GitHub right now ────────────────────────────────────────────────────────────────
const listed = [];
for (let page = 1; page <= 10; page++) {
  const batch = await get(`https://api.github.com/users/${OWNER}/repos?type=owner&per_page=100&page=${page}`);
  if (!batch) break;
  listed.push(...batch);
  if (batch.length < 100) break;
}
const own = listed.filter((r) => !r.fork);
const forks = listed.filter((r) => r.fork);
const realTotal = own.length + forks.length;

// ── 2 · what the README claims ──────────────────────────────────────────────────────────
/** every GitHub repo the README links to, whoever owns it */
const linkedTo = new Map();
for (const m of readme.matchAll(/\]\((https:\/\/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)\)/g)) {
  const p = /^https:\/\/github\.com\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)/.exec(m[1]);
  if (!p) continue;
  linkedTo.set(`${p[1]}/${p[2]}`, m[1]);
}

/** star claims, attributed to the repo the claim's own link points at */
const claimedStars = new Map();
for (const line of readme.split("\n")) {
  const link = /\]\((https:\/\/github\.com\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+))\)/.exec(line);
  const star = /⭐\s*(\d+)/.exec(line);
  if (!link || !star) continue;
  const key = `${link[2]}/${link[3]}`;
  if (!claimedStars.has(key)) claimedStars.set(key, Number(star[1]));
}

/** the inventory sentence(s) the README states */
const inventory = [...readme.matchAll(/(\d+)\s*个公开仓库/g)].map((m) => Number(m[1]));

// ── 3 · reconcile ───────────────────────────────────────────────────────────────────────
const problems = [];
const cache = new Map();
const lookup = async (owner, repo) => {
  const key = `${owner}/${repo}`;
  if (!cache.has(key)) cache.set(key, await get(`https://api.github.com/repos/${owner}/${repo}`));
  return cache.get(key);
};

// ① every linked repo must still exist
for (const key of [...linkedTo.keys()].sort()) {
  const [owner, repo] = key.split("/");
  if (owner === OWNER) {
    // the owner's own repo: it must be in the live roster, and the roster is authoritative
    if (!listed.some((r) => r.name === repo)) {
      problems.push(`linked-but-gone: ${key}（README 还链着它，GitHub 上已不存在）`);
    }
    continue;
  }
  const found = await lookup(owner, repo);
  if (!found) problems.push(`linked-but-gone: ${key}（README 还链着它，GitHub 上已不存在）`);
}

// ② star claims against the live counts
for (const [key, stars] of [...claimedStars].sort()) {
  const [owner, repo] = key.split("/");
  const found = await lookup(owner, repo);
  if (!found) continue; // already reported by ①
  if (found.stargazers_count !== stars) {
    problems.push(`star-drift: ${key} README 写 ⭐${stars}，GitHub 上是 ⭐${found.stargazers_count}`);
  }
}

// ③ every public repo of the account must be listed
for (const r of own) {
  if (!linkedTo.has(`${OWNER}/${r.name}`) && !readme.includes(r.name)) {
    problems.push(`public-but-unlisted: ${OWNER}/${r.name}（${r.language ?? "—"} · ⭐${r.stargazers_count}）`);
  }
}
for (const r of forks) {
  if (!linkedTo.has(`${OWNER}/${r.name}`) && !readme.includes(r.name)) {
    problems.push(`public-but-unlisted(fork): ${OWNER}/${r.name}`);
  }
}

// ④ the inventory counts
for (const n of inventory) {
  if (n !== realTotal) problems.push(`inventory-drift: README 说 ${n} 个公开仓库，GitHub 上是 ${realTotal}`);
}

console.log(`GitHub 上此刻：${own.length} 个自有公开仓 + ${forks.length} 个 fork = ${realTotal}；`
  + `README 链接 ${linkedTo.size} 个仓（跨 ${new Set([...linkedTo.keys()].map((k) => k.split("/")[0])).size} 个 owner）、`
  + `${claimedStars.size} 处星数声明、${inventory.length} 处库存声明。`);
if (problems.length === 0) {
  console.log("repo-roster-guard: OK — 链接、星数与库存与 GitHub 此刻一致");
  process.exit(0);
}
for (const p of problems) console.error(`::error::repo-roster-guard: ${p}`);
console.error(`repo-roster-guard: ${problems.length} 处对不上。`);
process.exitCode = 1;
