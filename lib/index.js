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

  // 先扫数据盘：这类解压出来的文件夹绝大多数直接丢在 D:/E: 盘上，
  // 先扫它们能避开用户目录里成百上千个无关目录把预算耗光。
  for (const drive of ['D:\\', 'E:\\', 'F:\\', 'G:\\']) {
    if (existsSync(drive)) queue.push({ dir: drive, depth: 0, maxDepth: 3 })
  }
  for (const [name, maxDepth] of SCAN_ROOTS) {
    const dir = name ? join(home, name) : home
    if (existsSync(dir)) queue.push({ dir, depth: 0, maxDepth })
  }
  // C 盘只给 2 层，用户的下载/桌面已经单独扫过了，别在系统目录上耗时。
  if (existsSync('C:\\')) queue.push({ dir: 'C:\\', depth: 0, maxDepth: 2 })

  const seen = new Set()
  const deadline = Date.now() + 8000
  let budget = 3000
  let fallbackPet = ''

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

    const exes = []
    let hasAsset = false

    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (depth < maxDepth && !SKIP_DIRS.has(entry.name)) {
          queue.push({ dir: full, depth: depth + 1, maxDepth })
        }
        continue
      }
      if (entry.name === '素材.nwp') hasAsset = true
      else if (entry.name.toLowerCase().endsWith('.exe')) exes.push(entry.name)
    }

    // 认“目录特征”而不是“文件名”：有 素材.nwp 的目录就是桌宠目录，
    // 里面那个 exe 就是主程序——用户把它改名叫什么都无所谓。
    if (exes.length > 0 && hasAsset) {
      const named = exes.find((n) => n.includes('奶蛙') || n.toLowerCase().includes('naiwa'))
      const preferred = named ?? exes.find((n) => n.includes('桌宠')) ?? exes[0]
      const picked = join(dir, preferred)
      // 明确是奶蛙的，直接收工；其他桌宠（比如同源码改出来的变体）先记着，
      // 继续找一会儿，优先返回真正叫奶蛙的那个。
      if (named) return picked
      if (!fallbackPet) fallbackPet = picked
      continue
    }

    // 兜底：名字明摆着是奶蛙、但素材被删了的目录，先记着
    if (!fallbackPet) {
      const byName = exes.find((n) => n.includes('奶蛙') || n.toLowerCase().includes('naiwa'))
      if (byName) fallbackPet = join(dir, byName)
    }
  }
  return fallbackPet
}

/** 后台探测的结果；没找到之前触发会跳过并写日志，不阻塞回答。 */
let discoveredExe = ''
let scanning = false

function startDiscovery(startOnLoad) {
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
      // 启动时的探测结束后补一次“把桌宠叫起来”，否则要等第一轮回答才出现。
      if (startOnLoad) ensurePetRunning(found)
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

  startDiscovery(!(config && config.startOnLoad === false))
  return { exePath: fromPlugin || fromFile || '', source: 'scanning' }
}

let last = 0

/** 起一个 powershell 跑触发脚本；extraArgs 用来切换模式（比如 -EnsureOnly）。 */
function runScript(exePath, extraArgs = []) {
  try {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-ExePath', exePath, '-LogPath', LOG_PATH, ...extraArgs],
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

/** DSH 启动时把奶蛙叫起来（不触发大笑）。 */
function ensurePetRunning(exePath) {
  if (!exePath) return
  log('ensuring the pet is running')
  runScript(exePath, ['-EnsureOnly'])
}

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
  runScript(exePath)
}

export function apply(ctx, config) {
  const { exePath, source } = resolveExe(config)
  const startOnLoad = !(config && config.startOnLoad === false)
  log(`plugin loaded (exePath from ${source}: ${exePath || 'looking for it in the background…'})`)
  if (exePath && !existsSync(SCRIPT)) {
    log(`trigger script missing: ${SCRIPT}`)
  }

  // DSH 一启动就让桌宠出现在桌面上，而不是等第一轮回答结束。
  // 自动探测还在后台跑时，会在探到之后再补一次（见 startDiscovery）。
  if (startOnLoad && exePath) ensurePetRunning(exePath)

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
