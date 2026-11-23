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
];
const ban = [
  "隐图", "暨南大学", "国家网络安全竞赛", "国家中学生物理竞赛",
  "九道", "十三道", "13 扇", "teedyas", "teedyassi", "teedy-assign",
  // 过期数：它们都曾经是真的 ⇒ 守门要盯着它们不许回来
  "19 个公开仓库", "19 个 GitHub 公开仓库", "83 篇", "204 卷", "#2045", "1,842", "2,877",
  "146.64 MiB", "139.85 MiB", "2026-11-20.svg", "2026-11-19.svg",
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
    // **条长标度必须写在图上**：条长按最大语言归一化 ⇒ TypeScript 画满整条，
    // 可它标着 32.57%。不写出来就是「条长与标签互相打脸」。
    if (!/归一化|normalized/i.test(card)) {
      failIt("language card does not state its bar scale (bars are normalized to the largest language)");
    }
  }

  // ---------------------------------------------------------------- the contribution card
  {
    const statsPath = resolve(root, "assets/stats-contrib.svg");
    if (!existsSync(statsPath)) {
      failIt("assets/stats-contrib.svg is missing");
    } else {
      const stats = readFileSync(statsPath, "utf8");
      if (snap.contributions?.total != null && !stats.includes(String(snap.contributions.total))) {
        failIt(`contribution card drifted from the snapshot: total is not ${snap.contributions.total}`);
      }
      if (snap.contributions?.streak != null && !stats.includes(`${snap.contributions.streak} 天`)) {
        failIt(`contribution card drifted from the snapshot: streak is not ${snap.contributions.streak} 天`);
      }
      if (!stats.includes(snap.date)) failIt(`contribution card is not stamped with the snapshot date (${snap.date})`);
    }
  }

  // ---------------------------------------------------------------- orphan cards
  // assets/ 下留着的**没人引用的**旧卡，是数字漂移的源头（每一张都印着一份旧快照）。
  // ⇒ 只允许 README 真正引用的那几张。
  {
    const referenced = new Set([...readme.matchAll(/src="(assets\/[^"]+)"/g)].map((m) => m[1]));
    for (const f of readdirSync(resolve(root, "assets"))) {
      const rel = `assets/${f}`;
      if (f.endsWith(".svg") && /languages/.test(rel) && !referenced.has(rel)) {
        failIt(`${rel} is an unreferenced old language card (a source of number drift) — delete it`);
      }
    }
  }

  // ---------------------------------------------------------------- inventory claims
  const ownRepos = snap.roster.filter((r) => !r.fork).map((r) => r.name);
  const forkRepos = snap.roster.filter((r) => r.fork).map((r) => r.name);
  // **每一个自有公开仓都必须以可点的仓库链接出现**（不只是「名字出现过」）。
  // README 别的段落里提到过 football-os-web（例如在线体验地址），那就把清单里那一行删掉，
  // 「名字出现过」这一格照样绿 —— 而读者在清单里根本找不到它。
  for (const name of [...ownRepos, ...forkRepos]) {
    if (!readme.includes(`](https://github.com/xiaodernan/${name})`)) {
      failIt(`public repo missing from the README as a clickable link: ${name}`);
    }
  }
  for (const needle of [`${snap.total} 个公开仓库`, `${snap.own} 原创`, `${snap.forks} fork`]) {
    if (!readme.includes(needle)) failIt(`README inventory claim missing or stale: ${needle}`);
  }
  // **自洽性**：非 fork + fork 必须等于总数（快照自己不能算错）
  if (snap.own + snap.forks !== snap.total) {
    failIt(`snapshot is inconsistent: own ${snap.own} + forks ${snap.forks} != total ${snap.total}`);
  }

  // ---------------------------------------------------------------- course repos
  // 这三个仓**不在**本人名下（是协作者／组织仓），所以它们**不计入**上面的库存。
  // 但它们确实做过 ⇒ 一并列出，免得读者以为漏了。
  // ⇒ 链接与 owner 都必须与**现测快照**一致，不许在本脚本里硬编码 URL 当事实。
  const courses = snap.course_repos ?? [];
  if (courses.length === 0) failIt("snapshot has no course_repos — the course repos were never measured");
  for (const c of courses) {
    if (!c.exists) {
      // 实测 404 ⇒ 它已经被删了。README 若还链着它，就是一条死链。
      if (readme.includes(`https://github.com/${c.full}`)) {
        failIt(`course repo ${c.full} is GONE (404) but the README still links it`);
      }
      continue;
    }
    if (!readme.includes(`https://github.com/${c.full}`)) {
      failIt(`course repo link missing or wrong owner: ${c.full}`);
    }
    // **反向**：README 里不能出现 owner 与实测不符的课程仓链接
    const name = c.full.split("/")[1];
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const m of readme.matchAll(new RegExp(`https://github\\.com/([\\w.-]+)/${esc}\\b`, "g"))) {
      if (m[1] !== c.owner) {
        failIt(`course repo ${name}: README says owner=${m[1]}, GitHub says owner=${c.owner}`);
      }
    }
    // 存活且有链接的课程仓，**必须写星数**（实测值）—— 不写星数就是信息缺失
    const starRe = new RegExp(`https://github\\.com/${c.full.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^\\n]*?⭐\\s*(\\d+)`);
    const sm = readme.match(starRe);
    if (sm && Number(sm[1]) !== c.stars) {
      failIt(`course repo ${c.full}: README says ⭐ ${sm[1]}, GitHub says ⭐ ${c.stars}`);
    }
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

// ---------------------------------------------------------------- the banner's legibility
// The banner is a 1280-wide viewBox rendered at width="100%" in the README, i.e. scaled to
// ~700–896px ⇒ 0.55–0.70x. A font-size of 11 in that viewBox therefore lands at 6.0–7.7 real
// px: unreadable. The gate states the rendered size, not the authored size.
{
  const bannerPath = resolve(root, "assets/banner.svg");
  if (!existsSync(bannerPath)) {
    failIt("assets/banner.svg is missing");
  } else {
    const banner = readFileSync(bannerPath, "utf8");
    const vb = banner.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
    if (!vb) {
      failIt("assets/banner.svg has no viewBox — the rendered size cannot be reasoned about");
    } else {
      const vw = Number(vb[1]);
      const sizes = [...banner.matchAll(/font-size="([\d.]+)"/g)].map((m) => Number(m[1]));
      if (sizes.length === 0) failIt("assets/banner.svg has no font-size at all");
      // the narrowest realistic README column
      const scale = 700 / vw;
      const worst = Math.min(...sizes) * scale;
      if (worst < 8) {
        failIt(`assets/banner.svg has text that renders at ${worst.toFixed(1)}px `
          + `(min font-size ${Math.min(...sizes)} at ${scale.toFixed(2)}x scale) — below the 8px floor`);
      }
    }
  }
}

if (fail === 0) {
  console.log(`profile-guard: OK — identity, inventory, stars, language bytes and avatar reconciled `
    + `(${publicSurfaces.length} public surfaces scanned)`);
}
process.exit(fail);
