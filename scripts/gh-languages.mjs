// gh-languages.mjs — the REAL MOST USED LANGUAGES card.
//
// Why this file exists: the card used to be hand-maintained SVG, so it froze while the repos
// moved (143.72 MB / Java 8.67% on 2026-11-22 was already stale a day later). A card that lies
// about bytes is worse than no card: readers take "Java 8.67%" as a fact about the codebase.
//
// So the card is GENERATED from the GitHub REST API, never typed by hand:
//   · roster   -> GET /users/xiaodernan/repos?type=owner   (public own repos, forks included)
//   · bytes    -> GET /repos/{owner}/{repo}/languages      (languages_url byte sums)
//   · output   -> assets/languages-latest.svg  +  data/gh-languages.json (the snapshot)
//
// 口径 (the measurement contract, stated on the card itself):
//   * the owner's OWN public repos only — no private repo, no third-party org repo;
//   * the byte sum covers the NON-FORK own public repos (the same roster the io page sums);
//   * shares are n / totalBytes of that same roster, so the bars add up to 100%.
//
// Run:  GH_PAT=ghp_... node scripts/gh-languages.mjs          # dry run, prints the figures
//       GH_PAT=ghp_... node scripts/gh-languages.mjs --write  # writes the card + snapshot
//
// A thin API response must never bake NaN into the card: a zero roster, a zero byte total or an
// empty language map aborts the run with a non-zero exit code instead of writing a broken card.
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OWNER = "xiaodernan";
const WRITE = process.argv.includes("--write");
const TOP = 8;

const token = process.env.GH_PAT || process.env.GITHUB_TOKEN || "";
const headers = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "xiaodernan-profile-guard",
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
};

const get = async (url) => {
  const r = await fetch(url, { headers, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (r.status === 404) return { __404: true };
  if (!r.ok) throw new Error(`${url} -> ${r.status} ${r.statusText}`);
  return r.json();
};

// 1 · the roster. /users/{owner}/repos?type=owner lists the account's PUBLIC repos (forks
// included, private excluded) and needs no token, so the weekly CI job can run it as-is.
const listed = [];
for (let page = 1; page <= 10; page++) {
  const batch = await get(`https://api.github.com/users/${OWNER}/repos?type=owner&per_page=100&page=${page}`);
  listed.push(...batch);
  if (batch.length < 100) break;
}
const own = listed.filter((r) => !r.fork);
const forks = listed.filter((r) => r.fork);
const stars = listed.reduce((s, r) => s + (r.stargazers_count ?? 0), 0);

// 2 · the bytes, summed through languages_url across the non-fork own public repos.
const bytes = new Map();
for (const r of own) {
  const langs = await get(r.languages_url);
  if (langs.__404) throw new Error(`languages_url 404: ${r.full_name}`);
  for (const [name, n] of Object.entries(langs)) bytes.set(name, (bytes.get(name) ?? 0) + n);
}
const totalBytes = [...bytes.values()].reduce((s, n) => s + n, 0);
const ranked = [...bytes.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

// A zero anywhere here would write literal NaN% into the card. Refuse instead.
if (!own.length || !forks.length || totalBytes === 0 || !ranked.length) {
  console.error(`REFUSING to draw: own=${own.length} forks=${forks.length} bytes=${totalBytes} langs=${ranked.length}`);
  process.exit(1);
}

const share = (n) => (n / totalBytes) * 100;
const today = new Date().toISOString().slice(0, 10);
const mib = totalBytes / 1024 / 1024;
const top = ranked.slice(0, TOP);
const rest = ranked.slice(TOP);
const restShare = rest.reduce((s, [, n]) => s + share(n), 0);

console.log(`${today}: ${own.length} own public repos (+${forks.length} forks), ${stars} stars, `
  + `${totalBytes.toLocaleString("en-US")} B = ${mib.toFixed(2)} MiB across ${ranked.length} languages`);
for (const [name, n] of top) console.log(`  ${name} ${share(n).toFixed(2)}%`);
if (rest.length) console.log(`  other ${rest.length} languages ${restShare.toFixed(2)}%`);
if (!WRITE) { console.log("dry run — pass --write to redraw the card"); process.exit(0); }

// 3 · the card. Same geometry as the hand-drawn one it replaces (880x286, bar x=250 w=530),
// so it sits in the README exactly where the old file did.
const pct2 = (n) => n.toFixed(2);
const base = top[0][1];
const rowY = (i) => 77 + i * 22;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const bar = (name, n, y, label) => {
  const w = ((n / base) * 530).toFixed(1);
  return [
    `<text x="28" y="${y}" font-family="DM Mono, ui-monospace, monospace" font-size="12" fill="#c9d1d9">${esc(label)}</text>`,
    `<rect x="250" y="${y - 13}" width="530" height="14" rx="7" fill="#1c2630"/>`,
    `<rect x="250" y="${y - 13}" width="${w}" height="14" rx="7" fill="#c9a258"/>`,
    `<text x="792" y="${y}" font-family="DM Mono, ui-monospace, monospace" font-size="11" fill="#ee8452">${pct2(share(n))}%</text>`,
  ].join("\n");
};
const rows = [];
top.forEach(([name, n], i) => rows.push(bar(name, n, rowY(i), name)));
if (rest.length) {
  const restBytes = rest.reduce((s, [, n]) => s + n, 0);
  rows.push(bar("other", restBytes, rowY(top.length), `其他 ${rest.length} 种`));
}
const aria = `MOST USED LANGUAGES · GitHub REST API byte share · ${today} · `
  + [...top, ...(rest.length ? [["other", rest.reduce((s, [, n]) => s + n, 0)]] : [])]
    .map(([name, n]) => `${name} ${pct2(share(n))}%`).join(", ");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 880 286" role="img" aria-label="${esc(aria)}">
<rect width="880" height="286" rx="14" fill="#0e141b"/>
<text x="28" y="38" font-family="DM Mono, ui-monospace, monospace" font-size="17" font-weight="700" fill="#c9a258" letter-spacing="2">MOST USED LANGUAGES</text>
<text x="852" y="38" text-anchor="end" font-family="DM Mono, ui-monospace, monospace" font-size="10" fill="#8f9aa6">byte share · ${today} · GitHub API</text>
${rows.join("\n")}
<text x="28" y="274" font-family="DM Mono, ui-monospace, monospace" font-size="10" fill="#6b7684">${own.length} original public repos (no forks) · languages_url bytes · ${totalBytes.toLocaleString("en-US")} B (${mib.toFixed(2)} MiB) · ${today}</text>
</svg>
`;

mkdirSync(resolve(root, "data"), { recursive: true });
writeFileSync(resolve(root, "assets/languages-latest.svg"), svg);

const snapshot = {
  date: today,
  owner: OWNER,
  own: own.length,
  forks: forks.length,
  total: own.length + forks.length,
  stars,
  bytes: totalBytes,
  mib: Number(mib.toFixed(2)),
  languages: ranked.map(([name, n]) => ({ name, bytes: n, share: Number(share(n).toFixed(2)) })),
  roster: listed.map((r) => ({ name: r.name, fork: !!r.fork, stars: r.stargazers_count ?? 0 })),
};
writeFileSync(resolve(root, "data/gh-languages.json"), JSON.stringify(snapshot, null, 2) + "\n");
console.log(`wrote assets/languages-latest.svg + data/gh-languages.json (${own.length} repos, ${pct2(share(top[0][1]))}% ${top[0][0]})`);
