// Fails when a translation catalog is missing strings that the source uses.
//   node scripts/check-i18n.mjs        # zh (default)
//   node scripts/check-i18n.mjs tr     # another catalog
import { spawnSync } from 'node:child_process'

const requested = process.argv.slice(2).filter((arg) => !arg.startsWith('-'))
const languages = requested.length ? requested : ['zh']
let failed = false

for (const lang of languages) {
  const result = spawnSync(process.execPath, ['scripts/extract-strings.mjs', '--missing', lang], {
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    console.error(`[i18n] ${lang}: could not read the catalog\n${result.stderr || result.stdout}`)
    process.exit(1)
  }
  let missing
  try {
    missing = JSON.parse(result.stdout)
  } catch {
    console.error(`[i18n] ${lang}: unexpected extractor output\n${result.stdout}`)
    process.exit(1)
  }
  if (missing.length) {
    console.error(`[i18n] ${lang}: ${missing.length} missing:`)
    for (const key of missing) console.error(`  - ${key}`)
    failed = true
  } else {
    console.log(`[i18n] ${lang}: ok`)
  }
}

process.exit(failed ? 1 : 0)
