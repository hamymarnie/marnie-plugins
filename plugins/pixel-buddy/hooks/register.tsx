import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Ctx, Limit, Mood } from '../types'
import { DONE_SECONDS, SCENE_HEIGHT, SCENE_WIDTH, sceneSvg } from './scene'

const mood = atom({ plugin: 'pixel-buddy', key: 'mood' } as const, 'idle' as Mood)
const moodAt = atom({ plugin: 'pixel-buddy', key: 'moodAt' } as const, 0)
const frame = atom({ plugin: 'pixel-buddy', key: 'frame' } as const, 0)
const cacheAt = atom({ plugin: 'pixel-buddy', key: 'cacheAt' } as const, null as number | null)
const now = atom({ plugin: 'pixel-buddy', key: 'now' } as const, 0)
const minute = atom({ plugin: 'pixel-buddy', key: 'minute' } as const, 0)
const ctx = atom({ plugin: 'pixel-buddy', key: 'ctx' } as const, null as Ctx | null)
const limits = atom({ plugin: 'pixel-buddy', key: 'limits' } as const, [] as Limit[])

// The "task complete" party plays once, then Claude relaxes for a while before idling.
const RELAX_MS = 4 * 60_000
// The mascot is drawn as still frames at this interval (about 7 per second).
const FRAME_MS = 150

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

    return next(e)
  })

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

    const caption = (lim: Limit | undefined, label: string) =>
      lim?.resetsAt && t ? `${label} · resets in ${span(Date.parse(lim.resetsAt) - t)}` : `${label} · waiting for a reading`
    const pctText = (lim: Limit | undefined) => (lim ? `${Math.round(lim.percentUsed)}%` : '–')

    if (e.surface !== 'desktop' && e.surface !== 'vscode') {
      return (
        <Box>
          <Text dimColor>{shown.map(s => `${s.label} ${pctText(s.lim)}`).join('   ')}</Text>
        </Box>
      )
    }
    const { Svg } = $.ui.resolve(e as typeof e & { surface: 'desktop' })

    return (
      <Box flexDirection="row" alignItems="center" justifyContent="space-between" paddingX={1}>
        <Box flexDirection="row" alignItems="center" gap={3}>
          {shown.map(s => (
            <Box key={s.kind} flexDirection="row" alignItems="center" gap={1}>
              <Svg source={ringSvg(s.lim?.percentUsed ?? 0, s.icon)} alt={`${s.label} usage ring`} width={30} height={30} />
              <Text bold>{pctText(s.lim)}</Text>
              <Text dimColor>{caption(s.lim, s.label)}</Text>
            </Box>
          ))}
        </Box>
        <Svg
          source={sceneSvg(shownMood, sceneT)}
          alt={`Claude is ${shownMood === 'done' ? 'celebrating' : shownMood === 'relax' ? 'relaxing' : shownMood}`}
          width={SCENE_WIDTH}
          height={SCENE_HEIGHT}
        />
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
