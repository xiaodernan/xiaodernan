// profile-guard.mjs — the offline fact gate for the profile README.
//
// What this gate protects:
//   · the identity facts (name, schools, major, competition, internship, language scores, and
//     the product name 隐盾 — never 隐图);
//   · the inventory claims (how many public repos, how many originals, how many forks);
//   · the MOST USED LANGUAGES card — the SVG, its snapshot and the README alt text must all
//     state the SAME numbers, so a hand-edit of one surface cannot drift away from the others;
//   · every link to github.com/xiaodernan/<repo> must name a repo that really exists (the
//     snapshot is fetched from the live API, so a deleted repo fails this gate);
//   · the avatar must be a square PNG (a squashed or cropped avatar is the exact defect the
//     user reported: "我的头像被压缩变小、边缘被裁掉").
//
// It runs OFFLINE against `data/gh-languages.json`, which `scripts/gh-languages.mjs` writes from
// the live GitHub API. The live half (does every link still resolve? do the stars still match?)
// is `scripts/repo-roster-guard.mjs`.
//
// Historical drafts of this repo listed three phantom repositories as "private" and said "nine
// doors" after the football world had shipped thirteen. It now ships fourteen doors (the
// Cartographer lets the model choose the StateGraph branch); this gate fails closed on every
// stale count, including the thirteen it once pinned itself.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(resolve(root, p), "utf8");
const readme = read("README.md");

// ---------------------------------------------------------------- public surfaces
// Everything a reader can actually see. The scripts/ directory is source code and is NOT
// scanned: this file itself has to name the forbidden strings in order to forbid them.
const publicSurfaces = ["README.md"];
for (const f of readdirSync(resolve(root, "assets"))) {
  if (/\.(svg|md|txt)$/i.test(f)) publicSurfaces.push(`assets/${f}`);
}
if (existsSync(resolve(root, "data"))) {
  for (const f of readdirSync(resolve(root, "data"))) {
    if (/\.(json|md|txt)$/i.test(f)) publicSurfaces.push(`data/${f}`);
  }
}
const surfaces = publicSurfaces.map((p) => [p, read(p)]);

// ---------------------------------------------------------------- identity facts
const need = [
  "赵欣曈", "南方科技大学", "香港中文大学", "计算机科学与技术",
  "全国中学生物理竞赛", "铜牌", "江西省一等奖", "江西省二等奖",
  "法狗狗公司", "隐盾", "雅思 6.5", "IELTS 6.5", "CET6 546",
  // the inventory's own headings — the group sizes are claims too
  "原创旗舰（9）", "本站与资料（2）", "早期归档（3）", "Fork 实验（2）", "课程项目（3",
  // a deleted repo must be named as deleted, never linked and never given a star count
  "源仓已下架",
];
const ban = [
  "隐图", "暨南大学", "国家网络安全竞赛", "国家中学生物理竞赛",
  "九道", "十三道", "13 扇", "teedyas", "teedyassi", "teedy-assign",
];

let fail = 0;
const failIt = (msg) => { console.error(`::error::profile-guard: ${msg}`); fail = 1; };

for (const s of need) if (!readme.includes(s)) failIt(`MISSING required fact: ${s}`);
for (const [p, text] of surfaces) {
  for (const s of ban) if (text.includes(s)) failIt(`FOUND forbidden claim "${s}" in ${p}`);
  if (/\bNaN\b/.test(text)) failIt(`NaN leaked into ${p}`);
}

// ---------------------------------------------------------------- the snapshot
const snapPath = resolve(root, "data/gh-languages.json");
if (!existsSync(snapPath)) {
  failIt("data/gh-languages.json is missing — run `GH_PAT=… node scripts/gh-languages.mjs --write`");
} else {
  const snap = JSON.parse(read("data/gh-languages.json"));
  const cardPath = resolve(root, "assets/languages-latest.svg");
  if (!existsSync(cardPath)) {
    failIt("assets/languages-latest.svg is missing");
  } else {
    const card = readFileSync(cardPath, "utf8");
    const top = snap.languages.slice(0, 6);
    for (const l of top) {
      const pct = `${l.share.toFixed(2)}%`;
      if (!card.includes(pct)) failIt(`language card drifted from the byte audit: ${l.name} ${pct} missing`);
      if (!readme.includes(pct)) failIt(`README alt drifted from the card: ${l.name} ${pct} missing`);
    }
    const bytes = snap.bytes.toLocaleString("en-US");
    for (const [label, text] of [["language card", card], ["README", readme]]) {
      if (!text.includes(bytes)) failIt(`${label} does not state the measured byte total (${bytes} B)`);
    }
    if (!card.includes(`${snap.own} original public repos`)) {
      failIt(`language card does not state the measured roster (${snap.own} original public repos)`);
    }
    if (!card.includes(snap.date)) failIt(`language card is not stamped with the snapshot date (${snap.date})`);
  }

  // ---------------------------------------------------------------- inventory claims
  const ownRepos = snap.roster.filter((r) => !r.fork).map((r) => r.name);
  const forkRepos = snap.roster.filter((r) => r.fork).map((r) => r.name);
  for (const name of [...ownRepos, ...forkRepos]) {
    if (!readme.includes(name)) failIt(`public repo missing from the README: ${name}`);
  }
  for (const needle of [`${snap.total} 个公开仓库`, `${snap.own} 原创`, `${snap.forks} fork`]) {
    if (!readme.includes(needle)) failIt(`README inventory claim missing or stale: ${needle}`);
  }

  // ---------------------------------------------------------------- every own link must be real
  // A link to github.com/xiaodernan/<repo> is a promise that <repo> exists. The snapshot is
  // fetched live, so a repository that was deleted or renamed fails this gate instead of
  // quietly sending readers to a 404.
  const linkRe = /https:\/\/github\.com\/xiaodernan\/([A-Za-z0-9_.-]+)/g;
  const known = new Set(snap.roster.map((r) => r.name));
  for (const m of readme.matchAll(linkRe)) {
    if (!known.has(m[1])) failIt(`link points at a repo that is not in the live roster: github.com/xiaodernan/${m[1]}`);
  }

  // ---------------------------------------------------------------- star claims
  // The star pill next to a repo is a measured fact; compare it with the snapshot.
  const rowRe = /\[([^\]\n]+)\]\(https:\/\/github\.com\/xiaodernan\/([A-Za-z0-9_.-]+)\)[^\n]*?⭐\s*(\d+)/g;
  for (const m of readme.matchAll(rowRe)) {
    const rec = snap.roster.find((r) => r.name === m[2]);
    if (!rec) { failIt(`star claimed for an unknown repo: ${m[2]}`); continue; }
    if (rec.stars !== Number(m[3])) failIt(`star claim drifted: ${m[2]} says ⭐ ${m[3]}, GitHub says ⭐ ${rec.stars}`);
  }
}

// ---------------------------------------------------------------- the avatar
const avatarPath = resolve(root, "assets/avatar-square.png");
if (!existsSync(avatarPath)) {
  failIt("assets/avatar-square.png is missing");
} else {
  const buf = readFileSync(avatarPath);
  const isPng = buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47 && buf.toString("ascii", 12, 16) === "IHDR";
  if (!isPng) failIt("assets/avatar-square.png is not a PNG");
  else {
    const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
    if (w !== h) failIt(`avatar is not square (${w}x${h}) — GitHub would stretch or crop it`);
    if (w < 256) failIt(`avatar is too small (${w}px) — it would look compressed`);
  }
}

if (fail === 0) {
  console.log(`profile-guard: OK — identity, inventory, stars, language bytes and avatar reconciled `
    + `(${publicSurfaces.length} public surfaces scanned)`);
}
process.exit(fail);
