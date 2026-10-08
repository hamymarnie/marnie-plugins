import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Ctx, Limit, Mood, PopupView, Thread, UsageReport, WindowReport } from '../types'
import { DONE_SECONDS, SCENE_HEIGHT, SCENE_WIDTH, sceneSvg } from './scene'
import { parseLine, parseLines, READ_LIMIT, SLICE_MS, summarize } from './usage'
import type { FileSummary, Listed, WindowSpec } from './usage'

const mood = atom({ plugin: 'pixel-buddy', key: 'mood' } as const, 'idle' as Mood)
const moodAt = atom({ plugin: 'pixel-buddy', key: 'moodAt' } as const, 0)
const frame = atom({ plugin: 'pixel-buddy', key: 'frame' } as const, 0)
const cacheAt = atom({ plugin: 'pixel-buddy', key: 'cacheAt' } as const, null as number | null)
const now = atom({ plugin: 'pixel-buddy', key: 'now' } as const, 0)
const minute = atom({ plugin: 'pixel-buddy', key: 'minute' } as const, 0)
const ctx = atom({ plugin: 'pixel-buddy', key: 'ctx' } as const, null as Ctx | null)
const limits = atom({ plugin: 'pixel-buddy', key: 'limits' } as const, [] as Limit[])
const isPinned = atom({ plugin: 'pixel-buddy', key: 'isPinned' } as const, false)
const view = atom({ plugin: 'pixel-buddy', key: 'view' } as const, { window: 'five_hour', group: 'threads' } as PopupView)

// The "task complete" party plays once, then Claude relaxes for a while before idling.
const RELAX_MS = 4 * 60_000
// The mascot is drawn as still frames at this interval (about 7 per second).
const FRAME_MS = 150

// Transcripts are re-priced this often; a finished turn or Refresh asks sooner.
const SCAN_MS = 60_000
const WINDOW_MS = { five_hour: 5 * 3_600_000, seven_day: 7 * 86_400_000 } as const
// The hover group joining the info icon and the usage card it reveals.
const USAGE_SCOPE = 'pixel-buddy-usage'

const GREEN = '#4cc35a'
const AMBER = '#e5a33a'
const RED = '#e5534b'
const levelColor = (p: number) => (p >= 90 ? RED : p >= 70 ? AMBER : GREEN)

function span(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000))
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  if (d) return `${d}d ${h}h`
  if (h) return `${h}h ${m % 60}m`
  return `${m}m`
}

function clockText(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function ringSvg(percent: number, icon: 'clock' | 'cal'): string {
  const C = 2 * Math.PI * 12
  const p = Math.min(100, Math.max(0, percent)) / 100
  const glyph =
    icon === 'clock'
      ? '<circle cx="15" cy="15" r="5.5" fill="none" stroke="#a0a0a0" stroke-width="1.6"/><path d="M15 12v3.4h2.6" fill="none" stroke="#a0a0a0" stroke-width="1.6" stroke-linecap="round"/>'
      : '<rect x="10" y="11" width="10" height="9" rx="1.5" fill="none" stroke="#a0a0a0" stroke-width="1.6"/><path d="M10 14h10M12.5 9.5v3M17.5 9.5v3" stroke="#a0a0a0" stroke-width="1.6" stroke-linecap="round"/>'
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 30" width="30" height="30">` +
    `<circle cx="15" cy="15" r="12" fill="none" stroke="#3a3a3a" stroke-width="2.6"/>` +
    (p > 0
      ? `<circle cx="15" cy="15" r="12" fill="none" stroke="${levelColor(percent)}" stroke-width="2.6" stroke-linecap="round" ` +
        `stroke-dasharray="${(C * p).toFixed(2)} ${C.toFixed(2)}" transform="rotate(-90 15 15)"/>`
      : '') +
    glyph +
    `</svg>`
  )
}

// A pixel hourglass: sand on top drains as the cache TTL runs out.
function hourglassSvg(frac: number): string {
  const sand = frac > 0 ? (frac > 0.2 ? GREEN : AMBER) : '#555'
  const frame = '#9a9a9a'
  let px = ''
  const r = (x: number, y: number, w: number, h: number, c: string) => {
    px += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}"/>`
  }
  r(0, 0, 7, 1, frame)
  r(0, 8, 7, 1, frame)
  r(1, 1, 1, 2, frame); r(5, 1, 1, 2, frame); r(2, 3, 1, 1, frame); r(4, 3, 1, 1, frame)
  r(3, 4, 1, 1, frame)
  r(2, 5, 1, 1, frame); r(4, 5, 1, 1, frame); r(1, 6, 1, 2, frame); r(5, 6, 1, 2, frame)
  const top = Math.ceil(2 * frac)
  if (top > 0) r(2, 3 - top, 3, top, sand)
  r(2, 7, 3, 1, sand)
  if (frac < 1 && frac > 0) r(2, 6, 3, 1, sand)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 7 9" width="14" height="18" shape-rendering="crispEdges">${px}</svg>`
}

function ctxBarSvg(percent: number): string {
  let px = ''
  const lit = Math.round(percent / 10)
  for (let i = 0; i < 10; i++) {
    px += `<rect x="${i * 4}" y="0" width="3" height="8" fill="${i < lit ? levelColor(percent) : '#3a3a3a'}"/>`
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 39 8" width="39" height="8" shape-rendering="crispEdges">${px}</svg>`
}

async function setMood($: EngineInterface, m: Mood) {
  const t = await $.clock.now()
  await update($, moodAt, () => t)
  await update($, mood, () => m)
}

// Which scene shows `elapsed` seconds into a mood: done hands off to relax, relax to idle.
function sceneFor(m: Mood, elapsed: number): { mood: Mood; t: number } {
  const relaxS = RELAX_MS / 1000
  if (m === 'done') {
    if (elapsed < DONE_SECONDS) return { mood: 'done', t: elapsed }
    return sceneFor('relax', elapsed - DONE_SECONDS)
  }
  if (m === 'relax' && elapsed >= relaxS) return { mood: 'idle', t: elapsed - relaxS }
  return { mood: m, t: elapsed }
}

function money(usd: number): string {
  if (usd >= 100) return `$${Math.round(usd).toLocaleString('en-US')}`
  return `$${usd.toFixed(2)}`
}

function bigTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `${Math.round(n / 1_000_000)}M`
  return `${Math.round(n / 1000)}k`
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

// Where each window began: its reset less its length, or a rolling window before a reading.
function windowSpecs(rl: Limit[], now: number): WindowSpec[] {
  return (['five_hour', 'seven_day'] as const).map(kind => {
    const at = rl.find(l => l.kind === kind)?.resetsAt
    const reset = at ? Date.parse(at) : NaN
    return { kind, start: Number.isFinite(reset) && reset > now ? reset - WINDOW_MS[kind] : now - WINDOW_MS[kind] }
  })
}

// Dollars per percent of the window, from what it has cost and how full it is.
function outlook(lim: Limit | undefined, w: WindowReport | undefined, now: number) {
  if (!lim || !w) return undefined
  const len = WINDOW_MS[lim.kind as keyof typeof WINDOW_MS] ?? 0
  const reset = lim.resetsAt ? Date.parse(lim.resetsAt) : NaN
  const left = Number.isFinite(reset) ? Math.max(0, reset - now) : undefined
  const perPct = lim.percentUsed >= 1 && w.usd > 0 ? w.usd / lim.percentUsed : undefined
  const elapsed = left === undefined || !len ? 0 : (len - left) / len
  return {
    left,
    perPct,
    toGo: perPct === undefined ? undefined : Math.max(0, 100 - lim.percentUsed) * perPct,
    atReset: elapsed > 0.02 ? Math.round(lim.percentUsed / elapsed) : undefined,
  }
}

function barSvg(percent: number): string {
  const p = Math.min(100, Math.max(0, percent))
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 8" width="400" height="8">` +
    `<rect x="0" y="0" width="400" height="8" rx="4" fill="#3a3a3a"/>` +
    (p > 0 ? `<rect x="0" y="0" width="${Math.max(8, p * 4).toFixed(1)}" height="8" rx="4" fill="${levelColor(p)}"/>` : '') +
    `</svg>`
  )
}

function byProject(threads: Thread[]): Thread[] {
  const out = new Map<string, Thread>()
  for (const t of threads) {
    const key = t.project || '(no project)'
    const p = out.get(key)
    if (!p) out.set(key, { ...t, id: key, title: key })
    else {
      p.usd += t.usd
      p.tokens += t.tokens
      p.firstAt = Math.min(p.firstAt, t.firstAt)
      p.lastAt = Math.max(p.lastAt, t.lastAt)
    }
  }
  return [...out.values()].sort((a, b) => b.usd - a.usd)
}

// The scan's own state: it lives as long as the module, so a reload re-reads once.
const files = new Map<string, FileSummary>()
let projectsDir: string | undefined
let host: string | undefined
let isRunning = false
let pending: string[] = []
let listing = new Map<string, Listed>()
let windows: WindowSpec[] = []

// The report the band and the usage card draw; written once each scan is whole.
const report = atom({ plugin: 'pixel-buddy', key: 'report' } as const, null as UsageReport | null)

async function resolveDir($: EngineInterface): Promise<string | undefined> {
  if (projectsDir) return projectsDir
  const stored = await $.store.get('projectsDir')
  if (typeof stored === 'string' && (await $.fs.exists(stored).catch(() => false))) return (projectsDir = stored)
  const isWin = /^[A-Za-z]:/.test(await $.session.cwd())
  const argv = isWin
    ? ['cmd', '/d', '/c', 'if defined CLAUDE_CONFIG_DIR (echo %CLAUDE_CONFIG_DIR%) else (echo %USERPROFILE%\\.claude)']
    : ['sh', '-c', 'printf "%s\\n" "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"']
  const r = await $.process.run(argv, { timeoutMs: 5000 }).catch(() => undefined)
  const dir = r?.stdout.trim()
  if (!dir) return undefined
  return setProjectsDir($, `${dir}${isWin ? '\\' : '/'}projects`)
}

async function setProjectsDir($: EngineInterface, dir: string) {
  if (dir === projectsDir) return dir
  projectsDir = dir
  await $.store.set('projectsDir', dir)
  return dir
}

async function hostName($: EngineInterface) {
  if (host !== undefined) return host
  const r = await $.process.run(['hostname'], { timeoutMs: 5000 }).catch(() => undefined)
  host = r?.stdout.trim().split('.')[0] ?? ''
  return host
}

async function readWhole($: EngineInterface, path: string, size: number, f: FileSummary) {
  const seen = new Set<string>()
  const carry = { rest: '' }
  if (size <= READ_LIMIT) {
    parseLines(await $.fs.read(path), f, carry, seen)
  } else {
    const isWin = /^[A-Za-z]:/.test(path)
    const argv = isWin ? ['cmd', '/d', '/c', 'type', path] : ['cat', path]
    for await (const piece of $.process.spawn({ argv })) {
      if (piece.stream === 'stdout') parseLines(piece.text, f, carry, seen)
    }
  }
  parseLine(carry.rest, f, seen)
}

// Lists every transcript touched since `since`: each main session file, and the
// subagent transcripts under its folder, billed to that session.
async function listFiles($: EngineInterface, dir: string, since: number) {
  const sep = dir.includes('\\') ? '\\' : '/'
  const out: Listed[] = []
  const projects = await $.fs.list(dir).catch(() => [])
  for (const p of projects) {
    if (p.kind !== 'dir') continue
    const pdir = `${dir}${sep}${p.name}`
    const entries = await $.fs.list(pdir).catch(() => [])
    for (const e of entries) {
      if (e.kind !== 'file' || !e.name.endsWith('.jsonl') || e.mtimeMs < since) continue
      const session = e.name.slice(0, -6)
      out.push({ path: `${pdir}${sep}${e.name}`, size: e.size, mtimeMs: e.mtimeMs, session, isMain: true })
      if (!entries.some(x => x.kind === 'dir' && x.name === session)) continue
      const sdir = `${pdir}${sep}${session}${sep}subagents`
      for (const s of await $.fs.list(sdir).catch(() => [])) {
        if (s.kind !== 'file' || !s.name.endsWith('.jsonl') || s.mtimeMs < since) continue
        out.push({ path: `${sdir}${sep}${s.name}`, size: s.size, mtimeMs: s.mtimeMs, session, isMain: false })
      }
    }
  }
  return out
}

// The transcript a classic hook names is the surest way to the projects folder.
async function noteTranscript($: EngineInterface, transcriptPath: string | undefined) {
  if (!transcriptPath) return
  const cut = transcriptPath.split(/[\\/]/)
  if (cut.length < 3) return
  const sep = transcriptPath.includes('\\') ? '\\' : '/'
  await setProjectsDir($, cut.slice(0, -2).join(sep))
}

// Re-reads the transcripts that changed since the last scan, a slice per dispatch,
// and writes the report once the last file is in.
async function scan($: EngineInterface, specs: WindowSpec[]) {
  if (isRunning) return
  isRunning = true
  let isHandedOff = false
  try {
    const dir = await resolveDir($)
    if (!dir) return
    const now = await $.clock.now()
    windows = specs
    const listed = await listFiles($, dir, Math.min(...specs.map(w => w.start)))
    listing = new Map(listed.map(l => [l.path, l]))
    for (const path of files.keys()) if (!listing.has(path)) files.delete(path)
    pending = listed
      .filter(l => {
        const f = files.get(l.path)
        if (!f) return true
        if (f.size === l.size && f.mtimeMs === l.mtimeMs) return false
        // A big file still being written is re-read at most every five minutes.
        return l.size <= READ_LIMIT || now - f.parsedAt > 5 * 60_000
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .map(l => l.path)
    isHandedOff = await scanSlice($)
  } finally {
    if (!isHandedOff) isRunning = false
  }
}

// Resolves true when it handed the rest of the files to a later timer.
async function scanSlice($: EngineInterface): Promise<boolean> {
  const began = await $.clock.now()
  while (pending.length) {
    const path = pending.shift()!
    const l = listing.get(path)
    if (!l) continue
    const f: FileSummary = {
      size: l.size,
      mtimeMs: l.mtimeMs,
      parsedAt: began,
      session: l.session,
      isMain: l.isMain,
      entries: [],
      last: undefined,
    }
    try {
      await readWhole($, path, l.size, f)
      files.set(path, f)
    } catch {
      // Unreadable now (locked, vanished): keep what was there and retry next scan.
    }
    if ((await $.clock.now()) - began > SLICE_MS && pending.length) {
      $.clock.after(50, () => {
        scanSlice($).then(
          isLater => void (isLater || (isRunning = false)),
          () => void (isRunning = false),
        )
      })
      return true
    }
  }
  const r = summarize(files, windows, await $.clock.now(), await hostName($))
  await update($, report, () => r)
  return false
}

// Prices every transcript on the machine against the windows the limits name.
async function rescan($: EngineInterface) {
  await scan($, windowSpecs(await read($, limits), await $.clock.now()))
}

const kTokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1000)}k`)

export const register: Register = (on, options) => {
  const ttlMs = options.cacheTtl === '5m' ? 5 * 60_000 : 60 * 60_000

  on('session.start', async ($, e, next) => {
    const u = await $.session.usage()
    await update($, ctx, () => u.context)
    await update($, limits, () => u.rateLimits)
    const t0 = await $.clock.now()
    await update($, minute, () => t0)

    // Keep "resets in" fresh, and tick the cache countdown while it is warm.
    $.clock.every(60_000, async () => {
      const t = await $.clock.now()
      await update($, minute, () => t)
    })
    await update($, moodAt, () => t0)
    $.clock.every(FRAME_MS, async () => {
      const t = await $.clock.now()
      await update($, frame, () => t)
    })
    $.clock.every(1_000, async () => {
      const at = await read($, cacheAt)
      if (at === null) return
      const t = await $.clock.now()
      if (t - at < ttlMs + 2_000) await update($, now, () => t)
    })

    // Price every transcript on the machine once the session is up, then keep it fresh.
    $.clock.after(1_500, () => void rescan($).catch(() => {}))
    $.clock.every(SCAN_MS, () => void rescan($).catch(() => {}))

    return next(e)
  })

  // A classic hook names this session's transcript, and so the folder they all live in.
  on('classic.SessionStart', async ($, e, next) => {
    await noteTranscript($, e.transcript_path).catch(() => {})
    return next(e)
  }).catch(($, e, next) => next(e))
  on('classic.UserPromptSubmit', async ($, e, next) => {
    await noteTranscript($, e.transcript_path).catch(() => {})
    return next(e)
  }).catch(($, e, next) => next(e))

  // Each response refreshes the prompt cache and reports the live usage.
  on('session.measure', async ($, e, next) => {
    await update($, ctx, () => e.context)
    if (e.rateLimits.length) await update($, limits, () => e.rateLimits)
    if (e.changed.includes('context')) {
      const t = await $.clock.now()
      await update($, cacheAt, () => t)
      await update($, now, () => t)
    }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    await setMood($, 'working')
    return next(e)
  })

  // Task complete: the party plays once, then Claude relaxes, then idles. The hand-offs
  // are worked out from the clock on each frame (see sceneFor), so no timer can be lost.
  on('turn.complete', async ($, e, next) => {
    if (e.agentId) return next(e)
    await setMood($, e.isAborted || e.reason === 'error' ? 'idle' : 'done')
    $.clock.after(2_000, () => void rescan($).catch(() => {}))
    return next(e)
  })

  // The band above the prompt: two usage rings on the left, the mascot on the right.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const ui = $.ui.resolve(e)
    const { Box, Text } = ui
    const rl = await read($, limits)
    const t = await read($, minute)
    const stored = await read($, mood)
    const m: Mood = e.props.isWorking ? 'working' : stored === 'working' ? 'idle' : stored
    const tFrame = await read($, frame)
    const since = m === stored ? await read($, moodAt) : 0
    const { mood: shownMood, t: sceneT } = sceneFor(m, Math.max(0, (tFrame - since) / 1000))
    const shown = [
      { kind: 'five_hour', label: '5h', icon: 'clock' as const },
      { kind: 'seven_day', label: '7d', icon: 'cal' as const },
    ].map(s => ({ ...s, lim: rl.find(l => l.kind === s.kind) }))

    const r = await read($, report)
    const caption = (lim: Limit | undefined, label: string) =>
      lim?.resetsAt && t ? `${label} · resets in ${span(Date.parse(lim.resetsAt) - t)}` : `${label} · waiting for a reading`
    const pctText = (lim: Limit | undefined) => (lim ? `${Math.round(lim.percentUsed)}%` : '–')
    const usdText = (kind: string) => {
      const w = r?.[kind as 'five_hour' | 'seven_day']
      return w ? money(w.usd) : undefined
    }

    if (e.surface !== 'desktop' && e.surface !== 'vscode') {
      return (
        <Box>
          <Text dimColor>
            {shown.map(s => [s.label, pctText(s.lim), usdText(s.kind)].filter(Boolean).join(' ')).join('   ')}
          </Text>
        </Box>
      )
    }
    const { Svg, Button, Select } = $.ui.resolve(e as typeof e & { surface: 'desktop' })
    const pinned = await read($, isPinned)
    const v = await read($, view)

    // The usage card: each window's outlook, then what spent it.
    const limitBlock = (kind: 'five_hour' | 'seven_day', title: string) => {
      const lim = rl.find(l => l.kind === kind)
      const o = outlook(lim, r?.[kind], t)
      const parts = [
        o?.left !== undefined ? `${span(o.left)} left` : undefined,
        o?.toGo !== undefined ? `≈${money(o.toGo)} to go` : r?.[kind] ? `${money(r[kind]!.usd)} spent` : undefined,
        o?.atReset !== undefined ? `~${o.atReset}% at reset` : undefined,
      ].filter(Boolean)
      return (
        <Box flexDirection="column">
          <Box flexDirection="row" justifyContent="space-between">
            <Text bold>{title}</Text>
            <Text bold color={lim ? levelColor(lim.percentUsed) : undefined}>{pctText(lim)}</Text>
          </Box>
          <Svg source={barSvg(lim?.percentUsed ?? 0)} alt={`${title} used`} />
          <Text dimColor>{parts.length ? parts.join(' · ') : 'waiting for a reading'}</Text>
        </Box>
      )
    }
    const w = r?.[v.window]
    const winLim = rl.find(l => l.kind === v.window)
    const perPct = outlook(winLim, w, t)?.perPct
    const rows = w ? (v.group === 'threads' ? w.threads : byProject(w.threads)).slice(0, 6) : []
    const winLabel = v.window === 'five_hour' ? '5h' : '7d'
    const ago = r ? Math.max(0, Math.round((t - r.at) / 60_000)) : undefined
    const card = (
      <Box
        width={Math.max(30, Math.min(58, e.props.bodyColumns - 2))}
        marginBottom={1}
        flexDirection="column"
        gap={1}
        paddingX={2}
        paddingY={1}
        borderStyle="round"
        borderColor="#3a3a3a"
        backgroundColor="#1c1c1c"
        // Shown while the icon or the card is hovered; a click on the icon pins it open.
        display={pinned ? 'flex' : 'none'}
        hover={pinned ? undefined : { scope: USAGE_SCOPE, display: 'flex' }}
      >
        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
          <Text dimColor>Usage</Text>
          {pinned ? (
            <Button key="pb-close" label="✕" plain role="dismiss" onPress={() => update($, isPinned, () => false)} />
          ) : null}
        </Box>
        {limitBlock('five_hour', '5h limit')}
        {limitBlock('seven_day', '7d limit')}
        <Text>
          {r ? `Sessions: ${r.working} working · ${r.yourTurn} your turn` : 'Reading transcripts…'}
        </Text>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
          <Box flexDirection="row" gap={1}>
            <Select
              key="pb-group"
              options={[
                { value: 'threads', label: 'Threads' },
                { value: 'projects', label: 'Projects' },
              ]}
              value={v.group}
              onSelect={g => update($, view, x => ({ ...x, group: g === 'projects' ? ('projects' as const) : ('threads' as const) }))}
            />
            <Select
              key="pb-window"
              options={[
                { value: 'five_hour', label: '5h window' },
                { value: 'seven_day', label: '7d window' },
              ]}
              value={v.window}
              onSelect={k => update($, view, x => ({ ...x, window: k === 'seven_day' ? ('seven_day' as const) : ('five_hour' as const) }))}
            />
          </Box>
          <Box flexDirection="row" gap={1} alignItems="center">
            <Text dimColor>{ago === undefined ? '' : ago === 0 ? 'now' : `${ago}m ago`}</Text>
            <Button key="pb-refresh" label="↻ Refresh" plain onPress={() => void rescan($).catch(() => {})} />
          </Box>
        </Box>
        <Box flexDirection="row" justifyContent="space-between">
          <Text dimColor bold>{`${v.group.toUpperCase()} · ${winLabel.toUpperCase()} WINDOW`}</Text>
          <Text bold>{w ? money(w.usd) : '–'}</Text>
        </Box>
        {rows.length ? (
          <Box flexDirection="column" gap={1}>
            {rows.map(th => (
              <Box key={`pb-${th.id}`} flexDirection="column">
                <Box flexDirection="row" justifyContent="space-between">
                  <Text>{clip(th.title.replace(/\s+/g, ' '), 44)}</Text>
                  <Text bold>{money(th.usd)}</Text>
                </Box>
                <Text dimColor>
                  {[
                    perPct ? `≈${(th.usd / perPct).toFixed(1)}%` : undefined,
                    `${bigTokens(th.tokens)} tok`,
                    span(Math.max(60_000, th.lastAt - th.firstAt)),
                    r?.host || undefined,
                    v.group === 'threads' ? th.project || undefined : undefined,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </Box>
            ))}
          </Box>
        ) : (
          <Text dimColor>{r ? `Nothing spent in this ${winLabel} window yet` : 'Pricing every session on this machine…'}</Text>
        )}
        <Text dimColor>{"≈ API-rate cost of this machine's transcripts"}</Text>
      </Box>
    )

    // The card sits in the band's own flow above the meters (a placed Box would be
    // clipped to the band), so the band grows to hold it while it shows.
    return (
      <Box flexDirection="column" paddingX={1}>
        {card}
        <Box flexDirection="row" alignItems="center" justifyContent="space-between">
          <Box flexDirection="row" alignItems="center" gap={3}>
            {shown.map(s => (
              <Box key={s.kind} flexDirection="row" alignItems="center" gap={1}>
                <Svg source={ringSvg(s.lim?.percentUsed ?? 0, s.icon)} alt={`${s.label} usage ring`} width={30} height={30} />
                <Text bold>{pctText(s.lim)}</Text>
                {usdText(s.kind) ? <Text color={GREEN}>{usdText(s.kind)}</Text> : null}
                <Text dimColor>{caption(s.lim, s.label)}</Text>
              </Box>
            ))}
            <Box flexDirection="row" alignItems="center" hover={{ scope: USAGE_SCOPE }}>
              <Button key="pb-info" label="ⓘ" plain dimColor onPress={() => update($, isPinned, x => !x)} />
            </Box>
          </Box>
          <Svg
            source={sceneSvg(shownMood, sceneT)}
            alt={`Claude is ${shownMood === 'done' ? 'celebrating' : shownMood === 'relax' ? 'relaxing' : shownMood}`}
            width={SCENE_WIDTH}
            height={SCENE_HEIGHT}
          />
        </Box>
      </Box>
    )
  })

  // Beside the model picker: prompt-cache countdown and context fill.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const { Box, Text } = $.ui.resolve(e)
    const at = await read($, cacheAt)
    const tNow = await read($, now)
    const c = await read($, ctx)
    const left = at === null ? 0 : ttlMs - (tNow - at)
    const warm = at !== null && left > 0
    const cacheLabel = at === null ? 'cache –' : warm ? `cache ${clockText(left)}` : 'cache cold'
    const cacheColor = !warm ? undefined : left < 60_000 ? AMBER : GREEN
    const pct = c?.percent
    const ctxLabel =
      pct === undefined ? 'ctx –' : `ctx ${pct}%${c?.tokens ? ` · ${kTokens(c.tokens)}/${kTokens(c.window)}` : ''}`
    const modes = e.props.modes.join(' & ')

    if (e.surface !== 'desktop' && e.surface !== 'vscode') {
      return <Text dimColor>{[cacheLabel, ctxLabel, modes].filter(Boolean).join('  ·  ')}</Text>
    }
    const { Svg } = $.ui.resolve(e as typeof e & { surface: 'desktop' })

    return (
      <Box flexDirection="row" alignItems="center" gap={1}>
        <Svg source={hourglassSvg(warm ? left / ttlMs : 0)} alt="prompt cache timer" width={14} height={18} />
        <Text color={cacheColor} dimColor={!warm}>{cacheLabel}</Text>
        <Text dimColor>·</Text>
        <Svg source={ctxBarSvg(pct ?? 0)} alt="context used" width={39} height={8} />
        <Text dimColor>{ctxLabel}</Text>
        {modes ? <Text dimColor>{`· ${modes}`}</Text> : null}
      </Box>
    )
  })
}
