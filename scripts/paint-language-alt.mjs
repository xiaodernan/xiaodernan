// paint-language-alt.mjs — keep the README's language-card caption honest.
//
// The card is generated (`scripts/gh-languages.mjs`), and the README's alt text is the only
// place where the card's numbers are readable without opening the image. If the card is
// regenerated and the alt text is not, the README starts quoting figures that the picture
// right below it contradicts — the exact NaN-era failure this repo had to be repaired for.
//
// So the alt text is PAINTED from the snapshot, never typed:
//   node scripts/paint-language-alt.mjs           # dry run: report what would change
//   node scripts/paint-language-alt.mjs --write   # rewrite README.md
//   node scripts/paint-language-alt.mjs --check   # exit 1 when the README is out of sync
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WRITE = process.argv.includes("--write");
const CHECK = process.argv.includes("--check");

const snap = JSON.parse(readFileSync(resolve(root, "data/gh-languages.json"), "utf8"));
const readmePath = resolve(root, "README.md");
const readme = readFileSync(readmePath, "utf8");

const top = snap.languages.slice(0, 6);
const alt = [
  "MOST USED LANGUAGES",
  `byte share ${snap.date}`,
  ...top.map((l) => `${l.name} ${l.share.toFixed(2)}%`),
  "GitHub API",
  `${snap.own} original public repos`,
  `${snap.bytes.toLocaleString("en-US")} B (${snap.mib.toFixed(2)} MiB)`,
].join(" · ");

const re = /(<img src="assets\/languages-latest\.svg"[^>]*?alt=")[^"]*(")/;
if (!re.test(readme)) {
  console.error("paint-language-alt: 找不到 languages-latest.svg 的 img 标签 —— README 结构变了，先修脚本。");
  process.exit(1);
}
const painted = readme.replace(re, `$1${alt}$2`);
if (painted === readme) {
  console.log("paint-language-alt: README 的 alt 文本与快照一致。");
  process.exit(CHECK ? 0 : 0);
}
if (WRITE) {
  writeFileSync(readmePath, painted, "utf8");
  console.log(`paint-language-alt: 已按快照重写 alt 文本（${snap.date}）。`);
  process.exit(0);
}
if (CHECK) {
  console.error("::error::paint-language-alt: README 的 alt 文本与 data/gh-languages.json 不同步");
  console.error(`  期望：${alt}`);
  process.exit(1);
}
console.log("paint-language-alt: 以下 alt 文本与快照不同步（--write 可重写）：");
console.log(`  ${alt}`);
