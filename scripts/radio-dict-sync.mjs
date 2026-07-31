// config/radio/dictionary.json を VOICEPEAK のユーザー辞書へ同期する。
//
// VOICEPEAK は設定ディレクトリに以下の3ファイルを持つ:
//   dic.json  … GUIの辞書エディタが読み書きするJSON表現。★ここだけが書き込み先★
//   user.csv  … MeCab形式。voicepeak.exe が起動のたびに内部状態から書き戻すため編集しても無駄
//   user.dic  … 合成時に実際に参照されるコンパイル済みバイナリ。GUIの保存時にのみ再生成される
//
// 2026-07-31の実測: dic.json だけを書き換えても合成結果は変わらず、
// CLI実行の直後に user.csv / user.dic が元の内容で上書きされた。
// したがって dic.json を書いたあと、**VOICEPEAKのGUIで辞書画面を開いて保存する**手順が必須。
// これは駅の追加・読みの修正をしたときだけ必要な作業で、通常の音声生成では発生しない。
//
// 使い方:
//   node scripts/radio-dict-sync.mjs           … 差分を表示するだけ（既定・書き込まない）
//   node scripts/radio-dict-sync.mjs --apply   … dic.json に書き込む（事前にバックアップを取る）

import { promises as fs } from "node:fs"
import path from "node:path"

const REPO_DICT = path.join(process.cwd(), "config", "radio", "dictionary.json")

// 設定ディレクトリは環境変数で上書き可能（インストール構成が違う場合に備える）
const SETTINGS_DIR =
  process.env.VOICEPEAK_SETTINGS_DIR ||
  path.join(process.env.LOCALAPPDATA || "", "Dreamtonics", "Voicepeak", "settings")

const DIC_JSON = path.join(SETTINGS_DIR, "dic.json")
const USER_CSV = path.join(SETTINGS_DIR, "user.csv")

const apply = process.argv.includes("--apply")

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"))
  } catch {
    return fallback
  }
}

const repo = await readJson(REPO_DICT, null)
if (!repo || !Array.isArray(repo.entries)) {
  console.error(`読み込めません: ${REPO_DICT}`)
  process.exit(1)
}

if (!(await fs.stat(SETTINGS_DIR).catch(() => null))) {
  console.error(`VOICEPEAK の設定ディレクトリが見つかりません: ${SETTINGS_DIR}`)
  console.error("VOICEPEAK_SETTINGS_DIR で場所を指定してください。")
  process.exit(1)
}

const current = await readJson(DIC_JSON, [])
const bySur = new Map()

// 既存エントリを先に入れる（リポジトリ管理外の手動登録を消さないため）
for (const e of current) bySur.set(e.sur, { ...e, _origin: "既存" })
// リポジトリ側で上書き
for (const e of repo.entries) {
  const prev = bySur.get(e.sur)
  const next = { sur: e.sur, pron: e.pron, pos: e.pos, priority: e.priority ?? 5, accentType: e.accentType ?? 0, lang: e.lang || "ja" }
  bySur.set(e.sur, { ...next, _origin: !prev ? "追加" : prev.pron !== next.pron || prev.accentType !== next.accentType ? "更新" : "同一" })
}

const merged = [...bySur.values()]
const counts = merged.reduce((a, e) => ((a[e._origin] = (a[e._origin] || 0) + 1), a), {})

console.log(`設定ディレクトリ: ${SETTINGS_DIR}`)
console.log(`既存 ${current.length} 語 + リポジトリ ${repo.entries.length} 語 → 合計 ${merged.length} 語`)
console.log(Object.entries(counts).map(([k, v]) => `${k}:${v}`).join("  "))

for (const e of merged.filter((x) => x._origin === "追加" || x._origin === "更新")) {
  console.log(`  [${e._origin}] ${e.sur} → ${e.pron} (accent=${e.accentType})`)
}

if (!apply) {
  console.log("\n--apply を付けると書き込みます（現状は表示のみ）。")
  process.exit(0)
}

// VOICEPEAKが起動していると書き込みを上書きされるので止めておく
console.log("\n※ VOICEPEAK が起動していないことを確認してください（起動中は書き戻されます）")

// バックアップ（user.csv / user.dic は書き換えないが、GUI保存で変わるので控えを取る）
const stamp = new Date().toISOString().replace(/[:.]/g, "-")
for (const f of [DIC_JSON, USER_CSV, path.join(SETTINGS_DIR, "user.dic")]) {
  if (await fs.stat(f).catch(() => null)) {
    const bak = `${f}.${stamp}.bak`
    await fs.copyFile(f, bak)
    console.log(`バックアップ: ${path.basename(bak)}`)
  }
}

const out = merged.map(({ _origin, ...e }) => e)
await fs.writeFile(DIC_JSON, JSON.stringify(out, null, 2) + "\n", "utf8")

console.log(`\ndic.json に ${merged.length} 語を書き込みました。`)
console.log("")
console.log("★ 反映にはGUI操作が必要です ★")
console.log("  1. VOICEPEAK を起動する")
console.log("  2. 辞書画面を開き、上記の語が入っていることを確認する")
console.log("  3. 保存して VOICEPEAK を終了する（user.dic が再生成される）")
console.log("この操作をしない限り、CLIでの合成には反映されません。")
