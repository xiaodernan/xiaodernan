// gh-languages.mjs —— **个人主页的唯一事实出处**（语言卡 + 贡献卡 + 全仓名册）。
//
// **为什么要有它**：这张主页上的每一个数字以前都是**手抄**进 README 的，于是它们会各自漂移：
// 仓库数从 16 抄成 19（而那 3 个「课程项目」仓**早就被删了** —— 实测
// `GET /repos/xiaodernan/<name>` 返回 404，而本 token 带完整 `repo` 权限、私有仓是看得见的
// ⇒ 它们是被删了，不是转私有）；语言字节在卡片（139.85 MB）与 README alt（146.64 MB）之间
// 各抄了一份；条形长度按「最大语言归一化」画，于是 TypeScript 标着 32.28% 却画满整条轨道。
//
// **规矩**：**数字只有一个出处** —— GitHub REST / GraphQL API 现测。
// README 与两张卡的数字由本脚本产出，守门脚本（`profile-guard.mjs`）读**同一份快照**比对，
// 于是「抄两份」这件事在结构上不可能再发生。
//
//   · 名册   -> GET /users/xiaodernan/repos?type=owner  （只含自己拥有的公开仓）
//   · 字节   -> GET /repos/{owner}/{repo}/languages     （languages_url 字节求和）
//   · 贡献   -> GraphQL contributionsCollection        （贡献总数与当前连胜）
//   · 课程仓 -> GET /repos/{owner}/{repo}               （逐个现测存活与真实 owner）
//   · 产出   -> assets/languages-latest.svg + assets/stats-contrib.svg + data/gh-languages.json
//
// **口径（就印在卡面上）**：
//   · 只算**自己名下**的公开仓 —— 不含私有仓，不含协作者/组织名下的仓；
//   · 字节求和覆盖**非 fork** 自有公开仓（fork 的语言是上游的，不是本人写的）；
//   · 占比 = n / totalBytes ⇒ 条长之和为 100%。
//
// 用法：
//   node scripts/gh-languages.mjs            # 干跑：只打印实测数字
//   node scripts/gh-languages.mjs --write    # 写卡片 + 快照
//
// **token 只进请求头，绝不落盘。** 环境变量 `GH_PAT` 或 `GITHUB_TOKEN` 均可。
import { writeFileSync, mkdirSync } from "node:fs";
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

const ghGraphql = async (query, variables) => {
  const r = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (j.errors) throw new Error(`GraphQL: ${j.errors.map((e) => e.message).join("; ")}`);
  return j.data;
};

// ── 1 · 名册 ────────────────────────────────────────────────────────────────
// `/users/{owner}/repos?type=owner` 只列**本人拥有**的公开仓（fork 含，私有不含）。
// 这个口径天然排除了「本人是成员但仓在别人名下」的那两个课程仓
// （CS308 归 ReverseRain、risc-v 归 zhqnb6666）—— 它们另算，见下面的 course_repos。
const listed = [];
for (let page = 1; page <= 10; page++) {
  const batch = await get(`https://api.github.com/users/${OWNER}/repos?type=owner&per_page=100&page=${page}`);
  if (batch.__404) break;
  listed.push(...batch);
  if (batch.length < 100) break;
}
const own = listed.filter((r) => !r.fork);
const forks = listed.filter((r) => r.fork);
const stars = listed.reduce((s, r) => s + (r.stargazers_count ?? 0), 0);

// ── 2 · 字节（languages_url 求和） ──────────────────────────────────────────
const bytes = new Map();
for (const r of own) {
  const langs = await get(r.languages_url);
  if (langs.__404) throw new Error(`languages_url 404: ${r.full_name}`);
  for (const [name, n] of Object.entries(langs)) bytes.set(name, (bytes.get(name) ?? 0) + n);
}
const totalBytes = [...bytes.values()].reduce((s, n) => s + n, 0);
const ranked = [...bytes.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

// 任何一处是零都会把字面量 NaN% 写进卡片 ⇒ 宁可不画。
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

// ── 3 · 贡献（贡献日历） ────────────────────────────────────────────────────
const Q = `
query ($login: String!) {
  user(login: $login) {
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks { contributionDays { contributionCount } }
      }
    }
  }
}`;
let contributions = { total: null, streak: null };
try {
  const d = await ghGraphql(Q, { login: OWNER });
  const cal = d.user.contributionsCollection.contributionCalendar;
  const days = (cal.weeks ?? []).flatMap((w) => w.contributionDays).map((x) => x.contributionCount);
  let streak = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i] > 0) streak++;
    else break;
  }
  contributions = { total: cal.totalContributions, streak };
} catch (e) {
  // 贡献段取不到不该毁掉整张卡（语言字节才是主事实）⇒ 记下来，守门会知道
  console.error(`gh-languages: 贡献段取不到（${e.message}）—— 贡献卡将留空。`);
}

// ── 4 · 课程仓（仓在协作者／组织名下） ─────────────────────────────────────
// 这三个**不在**本人的仓计数里，但课程项目确实做过 ⇒ 一并列出，免得读者以为漏了。
// 每一个都要**现测存活与真实 owner** —— 不许在本脚本里硬编码 URL 当作事实。
const COURSE_CANDIDATES = [
  "zhqnb6666/risc-v-single-cycle-cpu",
  "ReverseRain/CS308_-ImageCaptioning-",
  "sustech-cs304/team-project-25spring-59",
];
const courseRepos = [];
for (const full of COURSE_CANDIDATES) {
  const r = await get(`https://api.github.com/repos/${full}`);
  if (r.__404) {
    courseRepos.push({ full, exists: false, owner: null, stars: null, archived: null });
    continue;
  }
  courseRepos.push({
    full,
    exists: true,
    owner: r.owner?.login ?? null,
    stars: r.stargazers_count ?? 0,
    archived: Boolean(r.archived),
    pushed_at: r.pushed_at ?? null,
    fork: Boolean(r.fork),
  });
}

console.log(`${today}: ${own.length} own public repos (+${forks.length} forks), ${stars} stars, `
  + `${totalBytes.toLocaleString("en-US")} B = ${mib.toFixed(2)} MiB across ${ranked.length} languages`);
for (const [name, n] of top) console.log(`  ${name} ${share(n).toFixed(2)}%`);
if (rest.length) console.log(`  other ${rest.length} languages ${restShare.toFixed(2)}%`);
for (const c of courseRepos) {
  console.log(`  course ${c.full}: ${c.exists ? `alive owner=${c.owner} star=${c.stars}` : "GONE (404)"}`);
}
if (!WRITE) { console.log("dry run — pass --write to redraw the cards"); process.exit(0); }

// ── 5 · 语言卡 ──────────────────────────────────────────────────────────────
// 与被它替掉的手绘卡同几何（880x286，条 x=250 w=530），所以在 README 里位置不变。
// **配色与 banner 同源**（底 #0e141b / 金 #c9a258），两张卡放在一页上不打架。
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
<text x="28" y="274" font-family="DM Mono, ui-monospace, monospace" font-size="10" fill="#6b7684">${own.length} original public repos (no forks) · languages_url bytes · ${totalBytes.toLocaleString("en-US")} B (${mib.toFixed(2)} MiB) · 条长按最大语言归一化</text>
</svg>
`;

// ── 6 · 贡献卡 ──────────────────────────────────────────────────────────────
const statsCells = [
  ["贡献总数", contributions.total != null ? String(contributions.total) : "—"],
  ["当前连胜", contributions.streak != null ? `${contributions.streak} 天` : "—"],
  ["公开仓", String(own.length + forks.length)],
  ["非 fork 自有", String(own.length)],
  ["语言数", String(ranked.length)],
  ["代码字节", `${mib.toFixed(2)} MiB`],
];
const statsSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 880 150" role="img" aria-label="GitHub 贡献统计">
<rect width="880" height="150" rx="14" fill="#0e141b"/>
<text x="28" y="36" font-family="DM Mono, ui-monospace, monospace" font-size="16" font-weight="700" fill="#c9a258" letter-spacing="1.5">GITHUB 贡献</text>
<text x="852" y="36" text-anchor="end" font-family="DM Mono, ui-monospace, monospace" font-size="10" fill="#8f9aa6">${today} · GitHub API 实测</text>
${statsCells.map(([label, value], i) => {
  const x = 28 + i * 139;
  return `<text x="${x}" y="84" font-family="DM Mono, ui-monospace, monospace" font-size="21" font-weight="700" fill="#f7f5ee">${esc(value)}</text>\n<text x="${x}" y="106" font-family="DM Mono, ui-monospace, monospace" font-size="11" fill="#8f9aa6">${esc(label)}</text>`;
}).join("\n")}
<text x="28" y="134" font-family="DM Mono, ui-monospace, monospace" font-size="10" fill="#6b7684">contributionsCollection + /users/${OWNER}/repos?type=owner · 只算 ${own.length} 个非 fork 自有公开仓 · 由 scripts/gh-languages.mjs 现测</text>
</svg>
`;

// ── 7 · 落盘 ────────────────────────────────────────────────────────────────
mkdirSync(resolve(root, "data"), { recursive: true });
writeFileSync(resolve(root, "assets/languages-latest.svg"), svg);
writeFileSync(resolve(root, "assets/stats-contrib.svg"), statsSvg);

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
  roster: listed.map((r) => ({ name: r.name, fork: !!r.fork, stars: r.stargazers_count ?? 0, language: r.language ?? null })),
  contributions,
  course_repos: courseRepos,
};
writeFileSync(resolve(root, "data/gh-languages.json"), JSON.stringify(snapshot, null, 2) + "\n");
console.log(`wrote assets/languages-latest.svg + assets/stats-contrib.svg + data/gh-languages.json (${own.length} repos, ${pct2(share(top[0][1]))}% ${top[0][0]})`);
