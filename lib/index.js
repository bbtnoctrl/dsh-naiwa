/**
 * naiwa-laugh — 奶蛙桌宠（Naiwa desktop pet）联动插件。
 *
 * 每轮 DSH 回答结束时，让奶蛙捧腹大笑一次。
 *
 * 设计约束：
 *  1. 只用 Node 内建模块 —— 不 import 任何 @deepseek-ai/* 包，
 *     这样插件能独立从 profile 的 node_modules 加载。
 *  2. 不打包、不分发奶蛙的 exe 和素材（版权归原作者 yugh6）。
 *     用户自己准备桌宠，本插件只负责“发个消息让它笑”。
 *  3. 同时兼容官方原版和打过 --laugh 补丁的版本：
 *     先发 WM_APP+3（补丁版直接笑），没反应再模拟两次快速点击（原版靠这个判定双击）。
 *  4. 任何失败都只写日志，绝不影响回答本身。
 */
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(HERE, '..', 'scripts', 'laugh.ps1')
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const CONFIG_PATH = join(DSH_HOME, 'naiwa-laugh.json')
const LOG_PATH = join(DSH_HOME, 'naiwa-laugh.log')

const MIN_INTERVAL_MS = 3000

function log(line) {
  try {
    mkdirSync(DSH_HOME, { recursive: true })
    appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${line}\n`)
  } catch {
    /* never break the turn because of a log write */
  }
}

function readConfigFile() {
  try {
    if (!existsSync(CONFIG_PATH)) return {}
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))
  } catch (e) {
    log(`config parse failed (${CONFIG_PATH}): ${e && e.message}`)
    return {}
  }
}

/** 把找到的路径回写进配置，下次启动就不用再扫。 */
function persistExe(exePath) {
  try {
    const current = readConfigFile()
    mkdirSync(DSH_HOME, { recursive: true })
    writeFileSync(CONFIG_PATH, `${JSON.stringify({ ...current, exePath }, null, 2)}\n`)
  } catch (e) {
    log(`could not persist exePath: ${e && e.message}`)
  }
}

/**
 * 零配置：在常见位置找奶蛙桌宠.exe。
 *
 * - 异步读目录，绝不阻塞宿主的事件循环和启动。
 * - 优先认带同名 `素材.nwp` 的（说明是完整桌宠目录）。
 * - 预算：最多访问 1200 个目录、最多 4 秒，超了就带着已有的结果返回。
 */
const SCAN_ROOTS = [
  ['Downloads', 3],
  ['Desktop', 3],
  ['Documents', 3],
  ['', 2],
]

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'AppData', 'Windows', 'Program Files', 'Program Files (x86)',
  '$Recycle.Bin', 'System Volume Information', '.dsh', '.cache', '.vscode', '.config',
  'AppData\\Local', 'OneDrive',
])

async function scanForPet() {
  const home = homedir()
  const queue = []

  for (const [name, maxDepth] of SCAN_ROOTS) {
    const dir = name ? join(home, name) : home
    if (existsSync(dir)) queue.push({ dir, depth: 0, maxDepth })
  }
  for (const drive of ['D:\\', 'E:\\', 'F:\\']) {
    if (existsSync(drive)) queue.push({ dir: drive, depth: 0, maxDepth: 3 })
  }

  const seen = new Set()
  const deadline = Date.now() + 4000
  let budget = 1200
  let loose = ''

  while (queue.length > 0 && budget > 0 && Date.now() < deadline) {
    const { dir, depth, maxDepth } = queue.shift()
    if (seen.has(dir)) continue
    seen.add(dir)
    budget -= 1

    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (depth < maxDepth && !SKIP_DIRS.has(entry.name)) {
          queue.push({ dir: full, depth: depth + 1, maxDepth })
        }
        continue
      }
      if (!entry.name.toLowerCase().endsWith('.exe')) continue
      if (!entry.name.includes('奶蛙') && !entry.name.toLowerCase().includes('naiwa')) continue
      if (existsSync(join(dir, '素材.nwp'))) return full
      if (!loose) loose = full
    }
  }
  return loose
}

/** 后台探测的结果；没找到之前触发会跳过并写日志，不阻塞回答。 */
let discoveredExe = ''
let scanning = false

function startDiscovery() {
  if (scanning || discoveredExe) return
  scanning = true
  scanForPet()
    .then((found) => {
      if (!found) {
        log('auto-detect: no pet exe found; set exePath in ' + CONFIG_PATH)
        return
      }
      discoveredExe = found
      persistExe(found)
      log(`auto-detect: found ${found}`)
    })
    .catch((e) => log(`auto-detect failed: ${e && e.message}`))
    .finally(() => {
      scanning = false
    })
}

/** exePath 的解析顺序：插件行 config → 配置文件 → 后台探测（找到就记住） */
function resolveExe(config) {
  const fromPlugin = config && typeof config.exePath === 'string' ? config.exePath : ''
  const fromFile = readConfigFile().exePath || ''
  for (const candidate of [fromPlugin, fromFile]) {
    if (candidate && existsSync(candidate)) {
      return { exePath: candidate, source: candidate === fromPlugin ? 'plugin config' : CONFIG_PATH }
    }
  }

  startDiscovery()
  return { exePath: fromPlugin || fromFile || '', source: 'scanning' }
}

let last = 0

function trigger(exePath, why) {
  if (!exePath) {
    const current = discoveredExe || (scanning ? '' : (readConfigFile().exePath || ''))
    if (current) {
      exePath = current
    } else {
      log(`skip (${why}): exePath not configured${scanning ? ' (auto-detect still running)' : ''} — set it in ${CONFIG_PATH}`)
      return
    }
  }
  const now = Date.now()
  if (now - last < MIN_INTERVAL_MS) {
    log(`skip (${why}): debounce`)
    return
  }
  last = now
  log(`trigger via ${why}`)

  try {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-ExePath', exePath, '-LogPath', LOG_PATH],
      // 注意：这里不能 detach。detached 起的 powershell 在 Windows 上会静默跑空
      // （退出码 0 但脚本没执行），实测三种组合只有 detached=false 能真正触发。
      { detached: false, stdio: 'ignore', windowsHide: true },
    )
    child.on('error', (e) => log(`powershell spawn error: ${e && e.message}`))
    child.unref()
  } catch (e) {
    log(`spawn threw: ${e && e.message}`)
  }
}

export function apply(ctx, config) {
  const { exePath, source } = resolveExe(config)
  log(`plugin loaded (exePath from ${source}: ${exePath || 'looking for it in the background…'})`)
  if (exePath && !existsSync(SCRIPT)) {
    log(`trigger script missing: ${SCRIPT}`)
  }

  // agent/turn-stopping 是 harness 里真实的“回合即将结束”接缝；
  // 另外两个名字作为兼容兜底，谁先到谁触发（有防抖）。
  for (const name of ['agent/turn-stopping', 'agent/turn-complete', 'turn.complete']) {
    try {
      ctx.on(name, () => trigger(exePath, name))
      log(`listener registered: ${name}`)
    } catch (e) {
      log(`register failed (${name}): ${e && e.message}`)
    }
  }
}

export default { apply }
