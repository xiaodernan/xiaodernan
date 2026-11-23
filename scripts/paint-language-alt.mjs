// paint-language-alt.mjs — 让 README 里**所有由快照生成的数字**都从快照上色。
//
// **为什么要有这一步**：卡片是生成的，可 README 的 alt 文本是**手打的**。
// 于是卡片一重画，README 就开始引用图片下面那张图**自己都不认**的数字
// —— 这正是这个仓修过的那次「NaN 时代」事故。
//
// **规矩**：alt **从快照上色**，不是人敲的。
//   node scripts/paint-language-alt.mjs           # 干跑：报告会改什么
//   node scripts/paint-language-alt.mjs --write   # 重写 README.md
//   node scripts/paint-language-alt.mjs --check   # 不同步就 exit 1
//
// **一处事实，两个去处**：语言卡的 alt 从 `data/gh-languages.json` 取；
// 贡献卡的 alt 从**同一份快照**的贡献段取。两张卡不许各写各的数字。
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WRITE = process.argv.includes("--write");
const CHECK = process.argv.includes("--check");

const snap = JSON.parse(readFileSync(resolve(root, "data/gh-languages.json"), "utf8"));
const readmePath = resolve(root, "README.md");
let current = readFileSync(readmePath, "utf8");

const problems = [];

/**
 * 重画一张 alt 文本。
 * @param {string} file    卡片文件名（README 里 img 的 src）
 * @param {string[]} parts alt 的各段（用 · 连接）
 */
const paint = (file, parts) => {
  const alt = parts.join(" · ");
  const re = new RegExp(`(<img src="assets\\/${file}"[^>]*?alt=")[^"]*(")`);
  if (!re.test(current)) {
    problems.push(`找不到 ${file} 的 img 标签 —— README 结构变了，先修脚本。`);
    return;
  }
  const painted = current.replace(re, `$1${alt}$2`);
  if (painted !== current) {
    if (WRITE) {
      current = painted;
      writeFileSync(readmePath, current, "utf8");
    } else {
      problems.push(`${file} 的 alt 与快照不同步`);
      if (CHECK) console.error(`  期望：${alt}`);
    }
  }
};

// ── ① 语言卡 ────────────────────────────────────────────────────────────────
// **口径写进 alt**：条长按「最大语言归一化」画（否则 0.16% 的语言一截都看不到），
// 可读者看到的是「TypeScript 32.56% 却画满整条」⇒ 条长与标签互相打脸。
// ⇒ alt 里明说标度。
{
  const top = snap.languages.slice(0, 6);
  const rest = snap.languages.slice(6);
  const parts = [
    "MOST USED LANGUAGES",
    `byte share ${snap.date}`,
    ...top.map((l) => `${l.name} ${l.share.toFixed(2)}%`),
    ...(rest.length ? [`other ${rest.length} ${rest.reduce((s, l) => s + l.share, 0).toFixed(2)}%`] : []),
    "GitHub API",
    `${snap.own} original public repos`,
    `${snap.bytes.toLocaleString("en-US")} B (${snap.mib.toFixed(2)} MiB)`,
    "bars normalized to the largest language",
  ];
  paint("languages-latest.svg", parts);
}

// ── ② 贡献卡 ────────────────────────────────────────────────────────────────
// 旧卡片的 alt 写死了日期（如「2026-11-19 GitHub API 实测」）⇒ 日期一过就变成谎话。
// ⇒ 日期也上色。
{
  const c = snap.contributions ?? {};
  const parts = [
    "GITHUB 贡献",
    c.total != null ? `${c.total} contributions` : "",
    c.streak != null ? `${c.streak}-day streak` : "",
    `${snap.own} original public repos`,
    `${snap.forks} forks`,
    `GitHub API · ${snap.date}`,
  ].filter(Boolean);
  paint("stats-contrib.svg", parts);
}

if (problems.length) {
  for (const p of problems) console.error(`::error::paint-language-alt: ${p}`);
  if (CHECK) {
    console.error(`paint-language-alt: ${problems.length} 处与快照不同步。`);
    process.exit(1);
  }
  console.log(`paint-language-alt: ${problems.length} 处待重写（--write 可重写）：`);
  process.exit(0);
}
console.log("paint-language-alt: README 的 alt 文本与快照一致。");
process.exit(0);
