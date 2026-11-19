// profile-guard.mjs — GitHub profile README fact gate.
// Every public claim in this repo must stay aligned with the GitHub REST API
// snapshot and the user's byte-true identity facts. Historical drafts once
// listed three phantom repositories as "private" and said "nine doors" after
// the football world had shipped thirteen. It now ships fourteen doors (the
// Cartographer lets the model choose the StateGraph branch); this gate fails
// closed on every stale count, including the thirteen it once pinned itself.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const readme = readFileSync(fileURLToPath(new URL('../README.md', import.meta.url)), 'utf8')
const languageCard = readFileSync(fileURLToPath(new URL('../assets/languages-2026-11-20.svg', import.meta.url)), 'utf8')

const need = [
  '赵欣曈', '南方科技大学', '香港中文大学', '计算机科学与技术',
  '全国中学生物理竞赛', '铜牌', '江西省一等奖', '江西省二等奖',
  '法狗狗公司', '隐盾', '雅思 6.5', 'IELTS 6.5', 'CET6 546',
  '十四道', '16 个 GitHub 公开仓库', '9 原创旗舰', '2 本站资料', '3 早期归档', '2 fork',
]
const ban = [
  '隐图', '暨南大学', '国家网络安全竞赛', '国家中学生物理竞赛',
  '九道', '十三道', '13 扇', 'teedyas', 'teedyassi', 'teedy-assign',
]

let fail = 0
for (const s of need) {
  if (!readme.includes(s)) {
    console.error(`::error::profile-guard: MISSING required fact: ${s}`)
    fail = 1
  }
}
for (const s of ban) {
  if (readme.includes(s)) {
    console.error(`::error::profile-guard: FOUND forbidden claim: ${s}`)
    fail = 1
  }
}
// 2026-11-20 · the language card once showed NaN and stale byte shares. Pin the live
// GitHub REST byte audit into both the SVG and the README alt text, no estimates.
const shares = ['32.28%', '24.64%', '19.48%', '12.36%', '8.83%', '1.51%', '0.40%', '0.28%', '0.22%']
if (!shares.every((s) => languageCard.includes(s)) || !languageCard.includes('139.85 MB') || !languageCard.includes('14 public repos')) {
  console.error('::error::profile-guard: language SVG drifted from the GitHub byte audit')
  fail = 1
}
if (!shares.slice(0, 6).every((s) => readme.includes(s)) || !readme.includes('146.64 MB')) {
  console.error('::error::profile-guard: README language alt drifted from the SVG')
  fail = 1
}
for (const [surface, text] of [['README.md', readme], ['language-card.svg', languageCard]]) {
  if (/\bNaN\b/.test(text)) {
    console.error(`::error::profile-guard: NaN leaked into ${surface}`)
    fail = 1
  }
}

if (fail === 0) console.log('profile-guard: OK — identity, inventory, doors and language bytes reconciled')
process.exit(fail)
