// Pixel-art scenes for the mascot. Each call draws ONE still frame of a mood at
// time `t` (seconds since the mood began): every pixel is a <rect> in a 100x18 grid
// drawn at 3x, and the motion comes from keyframe tracks evaluated here, so a
// redraw of the band can never restart the animation.

import type { Mood } from '../types'

// The band's own color, painted behind the scene.
export const BAND_BG = '#212121'

const W = 100
const H = 18

const PAL: Record<string, string> = {
  o: '#d97757', // claude orange
  O: '#b65a3c', // orange shade
  e: '#1a1a1a', // eyes
  K: '#262626',
  k: '#121212',
  w: '#f4efe4',
  y: '#f7dc6f',
  Y: '#e8a33d',
  t: '#c9a46a',
  b: '#8a5a2b',
  B: '#5b3a1c',
  g: '#8a8a8a',
  G: '#4a4a4a',
  c: '#7fd6e8',
  C: '#9fd8f0',
  n: '#5fbf6a',
  N: '#2f7d3a',
  r: '#e5534b',
  R: '#a8322c',
  p: '#f08fb0',
  u: '#5a8fe6',
  U: '#2d4f9e',
  V: '#1b2c5c',
  l: '#c3c7cf',
  L: '#7d838c',
  P: '#efe8d6',
  s: '#3a2a52',
  m: '#7d3b63',
  d: '#d9673f',
  f: '#f2a14a',
  h: '#ffd27a',
  v: '#9b6be0',
}

const fill = (c: string) => PAL[c] ?? c
const rect = (x: number, y: number, w: number, h: number, c: string) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill(c)}"/>`

// An ASCII sprite: one char per pixel, '.' is transparent; runs merge into one rect.
function spr(rows: string[], x = 0, y = 0): string {
  let out = ''
  rows.forEach((row, j) => {
    let i = 0
    while (i < row.length) {
      const c = row[i]
      if (c === '.' || c === ' ') {
        i++
        continue
      }
      let k = i
      while (k < row.length && row[k] === c) k++
      out += rect(x + i, y + j, k - i, 1, c)
      i = k
    }
  })
  return out
}

// Deterministic noise so the art is the same on every frame.
const rnd = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}

// ---------- keyframe tracks ----------

type Pose = { tx?: number; ty?: number; o?: number; sx?: number; sy?: number }
type Track = [number, Pose][]
const BASE: Required<Pose> = { tx: 0, ty: 0, o: 1, sx: 1, sy: 1 }

const KF: Record<string, Track> = {
  bob: [[0, { ty: 0 }], [50, { ty: -1 }], [100, { ty: 0 }]],
  hop: [[0, { ty: 0 }], [50, { ty: -3 }], [100, { ty: 0 }]],
  wave: [[0, { ty: 0 }], [50, { ty: -2 }], [100, { ty: 0 }]],
  blink: [[0, { o: 1 }], [92, { o: 1 }], [94, { o: 0 }], [97, { o: 0 }], [100, { o: 1 }]],
  sweep: [[0, { tx: 0 }], [50, { tx: -2 }], [100, { tx: 0 }]],
  dust: [[0, { tx: 0, ty: 0, o: 1 }], [100, { tx: -9, ty: -3, o: 0 }]],
  tw: [[0, { o: 0 }], [30, { o: 1 }], [60, { o: 1 }], [100, { o: 0 }]],
  rise: [[0, { tx: 0, ty: 0, o: 0 }], [15, { o: 1 }], [100, { tx: 0, ty: -10, o: 0 }]],
  riseR: [[0, { tx: 0, ty: 0, o: 0 }], [15, { o: 1 }], [100, { tx: 4, ty: -9, o: 0 }]],
  walk: [[0, { tx: -36 }], [45, { tx: 0 }], [50, { tx: 0 }], [95, { tx: -36 }], [100, { tx: -36 }]],
  look: [[0, { tx: 1 }], [50, { tx: -1 }], [100, { tx: -1 }]],
  scan: [[0, { tx: -1 }], [50, { tx: 1 }], [100, { tx: -1 }]],
  grow: [[0, { sx: 0 }], [70, { sx: 1 }], [100, { sx: 1 }]],
  growY: [[0, { sy: 0 }], [60, { sy: 1 }], [100, { sy: 1 }]],
  pull: [[0, { ty: 9 }], [12, { ty: 0 }], [100, { ty: 0 }]],
  fly: [[0, { tx: 0, ty: 0, o: 1 }], [100, { tx: -14, ty: -12, o: 0 }]],
  dispatch: [[0, { tx: 0, o: 0 }], [6, { o: 1 }], [88, { o: 1 }], [100, { tx: -48, o: 0 }]],
  fall: [[0, { tx: 0, ty: -4 }], [50, { tx: 2, ty: 10 }], [100, { tx: -1, ty: 24 }]],
  dance: [
    [0, { tx: 0, ty: 0 }], [12, { tx: 0, ty: -4 }], [25, { tx: 0, ty: 0 }], [37, { tx: 0, ty: -4 }], [50, { tx: 0, ty: 0 }],
    [62, { tx: -2, ty: -1 }], [75, { tx: 2, ty: 0 }], [87, { tx: -2, ty: -1 }], [100, { tx: 0, ty: 0 }],
  ],
  sink: [[0, { ty: 0 }], [100, { ty: 3 }]],
  swing: [[0, { tx: -1 }], [50, { tx: 1 }], [100, { tx: -1 }]],
  on: [[0, { o: 1 }], [50, { o: 0 }], [100, { o: 0 }]],
  off: [[0, { o: 0 }], [50, { o: 1 }], [100, { o: 1 }]],
  leap: [
    [0, { tx: 0, ty: 0, o: 0 }], [78, { tx: 0, ty: 0, o: 0 }], [82, { tx: -2, ty: -4, o: 1 }],
    [88, { tx: -4, ty: -5, o: 1 }], [94, { tx: -6, ty: 0, o: 0 }], [100, { tx: 0, ty: 0, o: 0 }],
  ],
  drift: [[0, { tx: 0, ty: 0 }], [100, { tx: -70, ty: -2 }]],
  zoom: [[0, { tx: 0 }], [100, { tx: -72 }]],
  flip: [[0, { sx: 1 }], [60, { sx: 1 }], [70, { sx: 0.5 }], [80, { sx: -0.5 }], [90, { sx: -1 }], [100, { sx: -1 }]],
  carry: [[0, { tx: 0 }], [8, { tx: 0 }], [45, { tx: -22 }], [55, { tx: -22 }], [92, { tx: 0 }], [100, { tx: 0 }]],
  pace: [[0, { tx: 0 }], [50, { tx: -6 }], [100, { tx: 0 }]],
  magscan: [[0, { tx: 0, ty: 0 }], [25, { tx: -14, ty: -2 }], [50, { tx: -8, ty: 3 }], [75, { tx: -18, ty: 2 }], [100, { tx: 0, ty: 0 }]],
  dash: [[0, { tx: 0 }], [100, { tx: -8 }]],
  flipfood: [[0, { ty: 0 }], [70, { ty: 0 }], [80, { ty: -3 }], [90, { ty: -2 }], [100, { ty: 0 }]],
  vis2: [[0, { o: 1 }], [50, { o: 0 }], [100, { o: 0 }]],
}
const visTrack = (n: number): Track => [[0, { o: 1 }], [100 / n, { o: 0 }], [100, { o: 0 }]]

type Timing = { kind: 'step' } | { kind: 'linear' } | { kind: 'steps'; n: number }
type Anim = { track: Track; dur: number; delay: number; timing: Timing; count: number; fwd: boolean; back: boolean }

const animCache = new Map<string, Anim>()
// Reads a CSS-style shorthand: "bob 1s step-end infinite -0.5s", "fall 2s steps(12) 0.4s 2 both".
function parseAnim(def: string): Anim {
  const hit = animCache.get(def)
  if (hit) return hit
  const parts = def.trim().split(/\s+/)
  const name = parts[0]
  const track = KF[name] ?? (name.startsWith('vis') ? visTrack(Number(name.slice(3))) : [[0, {}], [100, {}]] as Track)
  const times: number[] = []
  let timing: Timing = { kind: 'linear' }
  let count = 1
  let fwd = false
  let back = false
  for (const p of parts.slice(1)) {
    if (/^-?[\d.]+s$/.test(p)) times.push(parseFloat(p))
    else if (p === 'step-end') timing = { kind: 'step' }
    else if (p === 'linear') timing = { kind: 'linear' }
    else if (p.startsWith('steps(')) timing = { kind: 'steps', n: parseInt(p.slice(6), 10) }
    else if (p === 'infinite') count = Infinity
    else if (/^\d+$/.test(p)) count = Number(p)
    else if (p === 'forwards') fwd = true
    else if (p === 'backwards') back = true
    else if (p === 'both') fwd = back = true
  }
  const a: Anim = { track, dur: times[0] ?? 1, delay: times[1] ?? 0, timing, count, fwd, back }
  animCache.set(def, a)
  return a
}

function sampleProp(track: Track, key: keyof Pose, pct: number, timing: Timing): number {
  const pts = track.filter(([, p]) => p[key] !== undefined).map(([at, p]) => [at, p[key] as number] as const)
  if (!pts.length) return BASE[key]
  if (pts[0][0] > 0) pts.unshift([0, BASE[key]])
  if (pts[pts.length - 1][0] < 100) pts.push([100, BASE[key]])
  for (let i = 0; i < pts.length - 1; i++) {
    const [a, va] = pts[i]
    const [b, vb] = pts[i + 1]
    if (pct >= a && pct < b) {
      let f = (pct - a) / (b - a)
      if (timing.kind === 'step') f = 0
      else if (timing.kind === 'steps') f = Math.floor(f * timing.n) / timing.n
      return va + (vb - va) * f
    }
  }
  return pts[pts.length - 1][1]
}

// The pose of an animation at time t, or null where it has no effect (before or after its run).
function poseAt(def: string, t: number): Required<Pose> | null {
  const a = parseAnim(def)
  const el = t - a.delay
  let pct: number
  if (el < 0) {
    if (!a.back) return null
    pct = 0
  } else if (el >= a.dur * a.count) {
    if (!a.fwd) return null
    pct = 100
  } else {
    pct = ((el % a.dur) / a.dur) * 100
  }
  const keys: (keyof Pose)[] = ['tx', 'ty', 'o', 'sx', 'sy']
  const out = { ...BASE }
  for (const k of keys) out[k] = pct === 100 ? lastValue(a.track, k) : sampleProp(a.track, k, pct, a.timing)
  return out
}
function lastValue(track: Track, key: keyof Pose): number {
  for (let i = track.length - 1; i >= 0; i--) if (track[i][1][key] !== undefined) return track[i][1][key] as number
  return BASE[key]
}

const n2 = (v: number) => Math.round(v * 100) / 100

class Frame {
  readonly t: number
  constructor(t: number) {
    this.t = t
  }
  // A group posed by `anim` at this frame, placed at (x, y); `origin` is where it scales from.
  g(anim: string | null, inner: string, x = 0, y = 0, origin: [number, number] = [0, 0]): string {
    let body = inner
    if (anim) {
      const p = poseAt(anim, this.t)
      if (p) {
        if (p.o <= 0.02) return ''
        const tf: string[] = []
        if (p.tx || p.ty) tf.push(`translate(${n2(p.tx)} ${n2(p.ty)})`)
        if (p.sx !== 1 || p.sy !== 1) {
          tf.push(`translate(${origin[0]} ${origin[1]}) scale(${n2(p.sx) || 0.001} ${n2(p.sy) || 0.001}) translate(${-origin[0]} ${-origin[1]})`)
        }
        const attrs = (tf.length ? ` transform="${tf.join(' ')}"` : '') + (p.o < 1 ? ` opacity="${n2(p.o)}"` : '')
        if (attrs) body = `<g${attrs}>${inner}</g>`
      }
    }
    return x || y ? `<g transform="translate(${x} ${y})">${body}</g>` : body
  }
  // Shows sub-scene i of n for its slice of a T-second cycle, building only the one on screen.
  cycle(scenes: (() => string)[], T: number): string {
    const n = scenes.length
    const i = Math.floor((((this.t % T) + T) % T) / (T / n))
    return scenes[i]()
  }
}

// ---------- the mascot ----------

type Eyes = 'normal' | 'look' | 'lookL' | 'lookR' | 'down' | 'focus' | 'happy' | 'shades' | 'closed' | 'scan'
type ClawdOpts = {
  eyes?: Eyes
  bob?: string | null
  armL?: string | null
  armR?: string | null
  armLUp?: boolean
  armRUp?: boolean
  walk?: boolean
  sit?: boolean
  extra?: string
}

function eyes(f: Frame, kind: Eyes): string {
  const pair = rect(4, 1, 1, 2, 'e') + rect(11, 1, 1, 2, 'e')
  switch (kind) {
    case 'normal':
      return f.g('blink 4s step-end infinite', pair)
    case 'look':
      return f.g('look 8s step-end infinite', pair)
    case 'scan':
      return f.g('scan .9s step-end infinite', pair)
    case 'lookL':
      return f.g('blink 3.5s step-end infinite', rect(3, 1, 1, 2, 'e') + rect(10, 1, 1, 2, 'e'))
    case 'lookR':
      return f.g('blink 3.1s step-end infinite', rect(5, 1, 1, 2, 'e') + rect(12, 1, 1, 2, 'e'))
    case 'down':
      return rect(3, 2, 1, 2, 'e') + rect(10, 2, 1, 2, 'e')
    case 'focus':
      return rect(3, 2, 2, 1, 'e') + rect(10, 2, 2, 1, 'e') + rect(3, 1, 2, 1, 'O') + rect(10, 1, 2, 1, 'O')
    case 'happy':
      return spr(['.e......e.', 'e.e....e.e'], 3, 1)
    case 'closed':
      return rect(3, 2, 2, 1, 'e') + rect(10, 2, 2, 1, 'e')
    case 'shades':
      return spr(['kkkkk.kkkkk', 'kkkkkkkkkkk', '.kkk...kkk.'], 2, 1) + rect(3, 1, 1, 1, 'w') + rect(9, 1, 1, 1, 'w')
  }
}

// 16x8: body 12x6, arms 2x2 at the sides, four 1x2 legs.
function clawd(f: Frame, x: number, y: number, o: ClawdOpts = {}): string {
  const body = rect(2, 0, 12, 6, 'o') + rect(2, 5, 12, 1, 'O')
  const armL = f.g(o.armL ?? null, o.armLUp ? rect(0, 0, 2, 2, 'o') + rect(1, 2, 1, 1, 'o') : rect(0, 2, 2, 2, 'o'))
  const armR = f.g(o.armR ?? null, o.armRUp ? rect(14, 0, 2, 2, 'o') + rect(14, 2, 1, 1, 'o') : rect(14, 2, 2, 2, 'o'))
  let legs = ''
  if (!o.sit) {
    const a = rect(3, 6, 1, 2, 'o') + rect(10, 6, 1, 2, 'o')
    const c = rect(5, 6, 1, 2, 'o') + rect(12, 6, 1, 2, 'o')
    legs = o.walk ? f.g('bob .3s step-end infinite', a) + f.g('bob .3s step-end infinite -.15s', c) : a + c
  }
  return f.g(o.bob ?? null, legs + body + armL + armR + eyes(f, o.eyes ?? 'normal') + (o.extra ?? ''), x, y)
}

// 8x5 helper mascot.
function mini(f: Frame, x: number, y: number, carry = '', walk = true): string {
  const body = rect(1, 0, 6, 3, 'o') + rect(0, 1, 1, 1, 'o') + rect(7, 1, 1, 1, 'o') + rect(2, 1, 1, 1, 'e') + rect(5, 1, 1, 1, 'e')
  const la = rect(2, 3, 1, 2, 'o')
  const lb = rect(5, 3, 1, 2, 'o')
  const legs = walk ? f.g('bob .3s step-end infinite', la) + f.g('bob .3s step-end infinite -.15s', lb) : la + lb
  return `<g transform="translate(${x} ${y})">${legs}${body}${carry}</g>`
}

const SPARK = ['.y.', 'yyy', '.y.']
const sparkle = (f: Frame, x: number, y: number, d: number, dur = 1.6) => f.g(`tw ${dur}s step-end infinite ${-d}s`, spr(SPARK), x, y)

const BANG = ['.wwww.', 'ww.www', 'ww.www', 'wwwwww', 'ww.www', '.wwww.', '.w....']
const BOX = ['BbbbB', 'bbYbb', 'bbbbb', 'BbbbB']
const SUN = ['..hhhh..', '.hhhhhh.', 'hhyyyyhh', 'hyyyyyyh', 'hyyyyyyh']

// A horizontally banded backdrop for the right of the band, its left edge dithered.
function backdrop(bands: [string, number][], x0 = 30): string {
  let out = ''
  let y = 0
  for (const [c, h] of bands) {
    for (let j = 0; j < h; j++, y++) {
      out += rect(x0 + 4, y, W - x0 - 4, 1, c)
      for (let dx = 0; dx < 4; dx++) {
        const xx = x0 + dx
        const on = dx === 3 ? (xx + y) % 4 !== 1 : dx === 2 ? (xx + y) % 2 === 0 : dx === 1 ? (xx + y) % 4 === 0 : false
        if (on) out += rect(xx, y, 1, 1, c)
      }
    }
  }
  return out
}

// The dotted field that fades in from the left, as in the band's art.
function dots(f: Frame): string {
  let out = ''
  for (let x = 0; x < W; x += 2) {
    for (let y = 1; y < H; y += 2) {
      const r = rnd(x * 31 + y)
      const p = Math.pow(x / W, 1.6) * 0.6
      if (r < p) {
        out += r < p * 0.12
          ? f.g(`tw ${(2 + rnd(x + y * 7) * 3).toFixed(2)}s step-end infinite ${(-rnd(x * y + 1) * 4).toFixed(2)}s`, rect(x, y, 1, 1, '#555'))
          : rect(x, y, 1, 1, r < p * 0.35 ? '#3c3c3c' : '#2c2c2c')
      }
    }
  }
  return out
}

const stars = (f: Frame, n: number, seed: number) =>
  Array.from({ length: n }, (_, i) => {
    const x = 36 + Math.floor(rnd(seed + i * 4.3) * 62)
    const y = Math.floor(rnd(seed + i * 8.9) * 8)
    return f.g(`tw ${(1.5 + rnd(i + seed) * 2).toFixed(2)}s step-end infinite -${(rnd(i * 2 + seed) * 2).toFixed(2)}s`, rect(x, y, 1, 1, 'w'))
  }).join('')

const palm = (x: number) =>
  rect(x, 4, 2, 14, 'b') + rect(x, 6, 2, 1, 'B') + rect(x, 10, 2, 1, 'B') + spr(['.nnn.nnn.', 'nnNnnnNnn', 'n..nNn..n', '...yny...'], x - 3, 1)

// ---------- idle: sweeping, walking, phone, chatting, reading ----------

function idle(f: Frame): string {
  const sweeping = () =>
    clawd(f, 60, 10, { bob: 'bob 1.2s step-end infinite' }) +
    f.g('sweep .6s step-end infinite', rect(76, 4, 1, 11, 't') + rect(75, 14, 4, 1, 'B') + spr(['YYYYY', 'YyYyY', 'Y.Y.Y'], 74, 15)) +
    [0, 0.4, 0.8].map((d, i) => f.g(`dust 1.2s linear infinite ${-d}s`, rect(0, 0, 1 + (i % 2), 1, 'g'), 73, 16 - i)).join('') +
    sparkle(f, 86, 3, 0) + sparkle(f, 92, 9, 0.6) + sparkle(f, 83, 12, 1.1) +
    f.g('tw 1.2s step-end infinite -.3s', spr(['yyy', '.y.']), 90, 1)

  const walking = () => {
    const butterfly = f.g('on .3s step-end infinite', spr(['v.v', '.k.'])) + f.g('off .3s step-end infinite', spr(['...', 'vkv']))
    return (
      f.g('walk 8s steps(18) infinite', clawd(f, 70, 10, { walk: true, eyes: 'look' })) +
      f.g('walk 8s steps(18) infinite -.5s', f.g('bob .9s step-end infinite', butterfly), 82, 4)
    )
  }

  const phone = () =>
    clawd(f, 66, 10, { eyes: 'down', bob: 'bob 2.4s step-end infinite' }) +
    spr(['KKKK', 'KccK', 'KccK', 'KccK', 'KKKK'], 62, 9) +
    f.g('on .6s step-end infinite', rect(63, 10, 2, 1, 'w') + rect(63, 12, 1, 1, 'w')) +
    f.g('off .6s step-end infinite', rect(63, 11, 2, 1, 'w') + rect(64, 13, 1, 1, 'w')) +
    f.g('rise 2.4s linear infinite', spr(['p.p', 'ppp', '.p.']), 60, 6) +
    f.g('rise 2.4s linear infinite -1.2s', spr(['y', 'y', '.', 'y']), 64, 5) +
    f.g('rise 2.4s linear infinite -.6s', spr(['nnn', 'n.n', 'nnn']), 56, 7)

  const chatting = () =>
    clawd(f, 40, 10, { eyes: 'lookR', bob: 'bob .6s step-end infinite', armR: 'wave 1.2s step-end infinite' }) +
    clawd(f, 64, 10, { eyes: 'lookL', bob: 'bob .6s step-end infinite -.3s', armL: 'wave 1.2s step-end infinite -.6s' }) +
    f.g('on 2.4s step-end infinite', spr(['.wwwwwww.', 'wwwwwwwww', 'wwKwKwKww', 'wwwwwwwww', '.wwwwwww.', '..ww.....', '..w......'], 48, 1)) +
    f.g('off 2.4s step-end infinite', spr(['.wwwwwww.', 'wwwpwpwww', 'wwwpppwww', 'wwwwpwwww', '.wwwwwww.', '.....ww..', '......w..'], 60, 1)) +
    f.g('tw 4.8s step-end infinite -2s', spr(['y.y', '.y.', 'y.y']), 58, 9)

  const reading = () =>
    clawd(f, 64, 10, { eyes: 'down', bob: 'bob 3s step-end infinite' }) +
    spr(['UwwwwUwwwwU', 'UwgggUwgggU', 'UwwwwUwwwwU', 'UwgggUwggwU', 'UUUUUUUUUUU'], 55, 11) +
    f.g('flip 3s step-end infinite', spr(['wwww', 'wggw', 'wwww', 'wgww']), 61, 11) +
    f.g('tw 3s step-end infinite -1s', spr(['.y.', 'yyy', 'yyy', '.w.']), 80, 3)

  return f.cycle([sweeping, walking, phone, chatting, reading], 40)
}

// ---------- working: laptop, papers, delegating, boxes, office, analysis ----------

function working(f: Frame): string {
  const typing = () => {
    const lines = [4, 6, 3, 5]
      .map((w, i) => f.g(`grow 1.6s steps(${w}) infinite ${-i * 0.4}s`, rect(54, 9 + i, w, 1, i % 2 ? 'c' : 'n'), 0, 0, [54, 9 + i]))
      .join('')
    const laptop = f.g('pull 6s steps(3) infinite', rect(52, 8, 10, 6, 'L') + rect(53, 8, 8, 5, 'k') + lines + rect(50, 14, 14, 1, 'l') + rect(51, 15, 12, 1, 'L'))
    const bits = [0, 0.5, 1, 1.5].map((d, i) => f.g(`rise 2s linear infinite ${-d}s`, i % 2 ? spr(['n', 'n', 'n']) : spr(['nn', 'nn', 'nn']), 54 + i * 2, 6)).join('')
    return laptop + bits + clawd(f, 64, 10, { eyes: 'focus', bob: 'bob .6s step-end infinite', armL: 'bob .3s step-end infinite', armR: 'bob .3s step-end infinite -.15s' })
  }

  const papers = () => {
    const sheet = spr(['PPP', 'PgP', 'PPP', 'PgP'])
    return (
      spr(['PPPPPP', 'PggggP', 'PPPPPP', 'PgggPP', 'PPPPPP', 'PggggP'], 50, 12) +
      [0, 0.5, 1].map(d => f.g(`fly 1.5s steps(7) infinite ${-d}s`, sheet, 52, 10)).join('') +
      clawd(f, 66, 10, { eyes: 'scan' }) +
      f.g('bob 1.2s step-end infinite', spr(['PPPP', 'PggP', 'PPPP', 'PgPP', 'PPPP']), 63, 11) +
      f.g('tw 2s step-end infinite', spr(['y', 'y', '.', 'y']), 72, 5)
    )
  }

  const delegate = () => {
    const box = rect(2, -2, 4, 2, 'b') + rect(3, -2, 2, 1, 'Y')
    const doc = rect(2, -3, 3, 3, 'P') + rect(3, -2, 1, 1, 'g')
    return (
      clawd(f, 74, 10, { armLUp: true, armL: 'wave .6s step-end infinite' }) +
      spr(BANG, 66, 2) +
      [0, 2, 4].map((d, i) => f.g(`dispatch 6s steps(24) infinite ${-d}s`, mini(f, 0, 0, i === 1 ? doc : box), 66, 13)).join('')
    )
  }

  const boxes = () =>
    spr(BOX, 32, 14) + spr(BOX, 38, 14) + spr(BOX, 35, 10) + spr(BOX, 86, 14) + spr(BOX, 92, 14) +
    f.g('off 6s step-end infinite', spr(BOX, 41, 10)) +
    f.g('carry 6s steps(24) infinite',
      clawd(f, 66, 10, { walk: true, armLUp: true, armRUp: true, extra: f.g('on 6s step-end infinite', spr(BOX, 5, -4)) }))

  const office = () =>
    [28, 43, 58].map((x, i) =>
      f.g(`bob .3s step-end infinite ${-i * 0.15}s`, mini(f, x, 13, '', false)) +
      spr(['LLLLL', 'LkkkL', 'LkkkL', 'LLLLL', '..L..'], x + 8, 9) +
      f.g(`on .6s step-end infinite ${-i * 0.3}s`, rect(x + 9, 10, 2, 1, 'n') + rect(x + 9, 11, 3, 1, 'c')) +
      f.g(`off .6s step-end infinite ${-i * 0.3}s`, rect(x + 9, 10, 3, 1, 'c') + rect(x + 10, 11, 2, 1, 'n')) +
      rect(x + 7, 14, 7, 1, 'b') + rect(x + 8, 15, 1, 3, 'B') + rect(x + 12, 15, 1, 3, 'B'),
    ).join('') +
    f.g('pace 4s steps(6) infinite', clawd(f, 80, 10, { walk: true, armLUp: true, armL: 'wave .6s step-end infinite' })) +
    f.g('tw 2s step-end infinite', spr(BANG), 86, 1)

  const analyze = () =>
    rect(36, 2, 22, 13, 'L') + rect(37, 3, 20, 11, 'k') + rect(45, 15, 4, 2, 'L') + rect(42, 17, 10, 1, 'L') +
    [2, 5, 3, 7, 4, 8]
      .map((h, i) => f.g(`growY 3s steps(${h}) infinite ${-i * 0.3}s`, rect(39 + i * 3, 13 - h, 2, h, i % 2 ? 'c' : 'n'), 0, 0, [40 + i * 3, 13]))
      .join('') +
    clawd(f, 68, 10, { eyes: 'focus', armLUp: true }) +
    f.g('magscan 5s steps(10) infinite', spr(['.lll...', 'lcccl..', 'lcccl..', 'lcccl..', '.lllb..', '....bb.', '.....bb']), 58, 5) +
    f.g('tw 5s step-end infinite', spr(['www', '..w', '.ww', '...', '.w.']), 78, 1)

  return f.cycle([typing, papers, delegate, boxes, office, analyze], 36)
}

// ---------- task complete: one burst of confetti, jumping and dancing ----------

export const DONE_SECONDS = 6.5

function done(f: Frame): string {
  const colors = ['r', 'y', 'c', 'n', 'p', 'v', 'f', 'u']
  let confetti = ''
  for (let i = 0; i < 34; i++) {
    const x = 26 + Math.floor(rnd(i * 3.7) * 72)
    const dur = (1.6 + rnd(i * 5.1) * 1.2).toFixed(2)
    const d = (rnd(i * 9.3) * 1.2).toFixed(2)
    const c = colors[i % colors.length]
    const piece =
      f.g(`on ${(0.3 + Math.round(rnd(i) * 2) * 0.15).toFixed(2)}s step-end infinite`, rnd(i) > 0.5 ? rect(0, 0, 1, 2, c) : rect(0, 0, 2, 1, c)) +
      f.g(`off ${(0.3 + Math.round(rnd(i) * 2) * 0.15).toFixed(2)}s step-end infinite`, rect(0, 0, 1, 1, colors[(i + 3) % colors.length]))
    confetti += f.g(`fall ${dur}s steps(12) ${d}s 2 both`, piece, x, 0)
  }
  return (
    confetti +
    f.g('dance 2.4s step-end 0s 2 forwards', clawd(f, 66, 10, { eyes: 'happy', armL: 'wave .3s step-end infinite', armR: 'wave .3s step-end infinite -.15s', walk: true })) +
    f.g('hop .6s step-end 0s 9', mini(f, 52, 13, '', false)) +
    f.g('hop .6s step-end -.3s 9', mini(f, 86, 13, '', false)) +
    sparkle(f, 60, 2, 0, 0.9) + sparkle(f, 88, 4, 0.45, 0.9) + sparkle(f, 46, 6, 0.3, 0.9)
  )
}

// ---------- relaxing: sunset chair, fishing, hammock, campfire, barbecue, sunset drive ----------

function relax(f: Frame): string {
  const sunset = () =>
    backdrop([['s', 3], ['m', 3], ['d', 3], ['f', 3], ['U', 3], ['t', 3]]) +
    f.g('sink 8s steps(3) infinite', spr(SUN), 76, 7) +
    rect(34, 12, 66, 3, 'U') +
    [0, 0.4, 0.8, 1.2].map((d, i) => f.g(`tw 1.6s step-end infinite ${-d}s`, rect(0, 0, 2 + (i % 2), 1, 'h'), 72 + i * 4, 12 + (i % 3))).join('') +
    f.g('drift 16s linear infinite', spr(['K.K', '.K.']) + spr(['K.K', '.K.'], 5, 2), 96, 2) +
    spr(['r......', 'wr.....', 'rwr....', 'wrwrwrw', 'b.....b', 'b.....b'], 46, 10) +
    clawd(f, 46, 8, { eyes: 'shades', bob: 'bob 3s step-end infinite' }) +
    spr(['..p..', '.ppp.', '..t..', 'cccc.', 'cccc.', '.cc..'], 63, 10) +
    f.g('riseR 3s linear infinite', spr(['.ww', '.w.', 'ww.']), 58, 5) +
    f.g('riseR 3s linear infinite -1.5s', spr(['ww', 'w.', 'w.']), 52, 5)

  const fishing = () =>
    backdrop([['V', 4], ['s', 4], ['V', 3], ['U', 7]]) +
    stars(f, 14, 3) +
    spr(['.ww.', 'wwww', 'wwww', '.ww.'], 90, 1) +
    [0, 1, 2].map(i => f.g(`tw 2s step-end infinite ${-i * 0.6}s`, rect(0, 0, 3, 1, 'u'), 40 + i * 15, 13 + i)).join('') +
    rect(38, 10, 26, 2, 'b') + rect(38, 10, 26, 1, 't') + rect(40, 12, 1, 6, 'B') + rect(60, 12, 1, 6, 'B') +
    clawd(f, 46, 4, { eyes: 'closed', bob: 'bob 3s step-end infinite' }) +
    spr(['.......t', '......t.', '.....t..', '....t...', '...t....', '..t.....', '.t......'], 60, 0) +
    rect(68, 1, 1, 12, 'g') +
    f.g('bob 1.2s step-end infinite', rect(67, 12, 3, 1, 'r') + rect(67, 13, 3, 1, 'w')) +
    f.g('leap 8s steps(10) infinite', spr(['.uu.u', 'uuuuu', '.uu.u']), 86, 13)

  const hammockScene = () => {
    // The hammock sags between the palms: tied high at the trunks, lowest in the middle.
    let hammock = ''
    for (let x = 48; x <= 82; x++) {
      const t = (x - 65) / 17
      hammock += rect(x, Math.round(9 + 4 * (1 - t * t)), 1, 1, x % 3 ? 'w' : 'r')
    }
    return (
      backdrop([['C', 11], ['c', 2], ['t', 5]]) +
      palm(46) + palm(83) +
      f.g('swing 3s step-end infinite', clawd(f, 57, 7, { eyes: 'closed', sit: true }) + hammock) +
      f.g('riseR 3s linear infinite', spr(['www', '.w.', 'www']), 70, 2) +
      f.g('riseR 3s linear infinite -1.5s', spr(['ww', 'ww']), 74, 3)
    )
  }

  const campfire = () =>
    backdrop([['V', 5], ['s', 5], ['m', 2], ['N', 6]]) +
    stars(f, 12, 11) +
    f.g('on .3s step-end infinite', spr(['..r...', '.rfr..', '.rfyr.', 'rfyyfr']), 70, 10) +
    f.g('off .3s step-end infinite', spr(['...r..', '..rfr.', '.ryfr.', 'rfyyfr']), 70, 10) +
    spr(['BB..BB', '.BBBB.', 'BB..BB'], 70, 14) +
    [0, 0.7, 1.4].map((d, i) => f.g(`rise 2.1s linear infinite ${-d}s`, rect(0, 0, 1, 1, 'h'), 71 + i * 2, 8)).join('') +
    f.g('on .6s step-end infinite', rect(64, 16, 18, 1, 'O')) +
    rect(46, 15, 14, 3, 'B') +
    clawd(f, 47, 9, { eyes: 'closed', bob: 'bob 3.6s step-end infinite' }) +
    spr(['www.', 'wwwP', 'www.'], 61, 12) +
    f.g('rise 2.4s linear infinite', spr(['g', '.', 'g']), 62, 9) +
    f.g('rise 2.4s linear infinite -1.2s', spr(['g', 'g']), 63, 9)

  const barbecue = () => {
    let fence = ''
    for (let x = 35; x < W; x += 3) fence += rect(x, 7, 2, 6, 'w')
    return (
      backdrop([['C', 13], ['n', 2], ['N', 3]]) +
      fence + rect(34, 9, 66, 1, 'w') +
      spr(['KKKKKKKKKKKK', '.GGGGGGGGGG.', '..GGGGGGGG..', '...G....G...', '...G....G...', '..GG....GG..'], 46, 11) +
      f.g('on .6s step-end infinite', rect(49, 12, 6, 1, 'd') + rect(56, 12, 1, 1, 'f')) +
      f.g('off .6s step-end infinite', rect(48, 12, 2, 1, 'f') + rect(51, 12, 6, 1, 'd')) +
      f.g('flipfood 2s steps(4) infinite', rect(47, 10, 3, 1, 'B')) +
      rect(51, 10, 3, 1, 'r') +
      f.g('flipfood 2s steps(4) infinite -1s', rect(55, 10, 2, 1, 'B')) +
      [0, 0.8, 1.6].map((d, i) => f.g(`rise 2.4s linear infinite ${-d}s`, spr(['g.', '.g']), 48 + i * 3, 6)).join('') +
      clawd(f, 64, 10, { eyes: 'happy', extra: spr(['.wwwwww.', 'wwwwwwww', '.wwwwww.'], 4, -3) }) +
      f.g('wave .6s step-end infinite', rect(60, 11, 4, 1, 't') + rect(58, 10, 2, 2, 'l'))
    )
  }

  const drive = () => {
    const palmSmall = rect(0, 4, 1, 8, 'B') + spr(['.N.N.', 'NNNNN', 'N.N.N'], -2, 2)
    let dashes = ''
    for (let x = 40; x < W + 8; x += 8) dashes += rect(x, 16, 4, 1, 'y')
    const car = spr([
      '.................c....',
      '.................c....',
      'rrrrrrrrrrrrrrrrrrrrrr',
      'rrrrrrrrrrrrrrrrrrrrhh',
      'RRRRRRRRRRRRRRRRRRRRRR',
    ])
    const wheels =
      spr(['.KKK............KKK...', '.KKK............KKK...'], 0, 5) +
      f.g('on .3s step-end infinite', rect(2, 5, 1, 1, 'g') + rect(18, 5, 1, 1, 'g')) +
      f.g('off .3s step-end infinite', rect(2, 6, 1, 1, 'g') + rect(18, 6, 1, 1, 'g'))
    return (
      backdrop([['s', 3], ['m', 3], ['d', 3], ['f', 3], ['N', 2], ['G', 4]]) +
      spr(SUN, 74, 8) + rect(34, 12, 66, 2, 'N') + rect(34, 14, 66, 4, 'G') +
      f.g('dash .6s steps(4) infinite', dashes) +
      f.g('zoom 2.4s steps(24) infinite', palmSmall, 100, 0) +
      f.g('zoom 2.4s steps(24) infinite -1.2s', palmSmall, 100, 0) +
      f.g('drift 16s linear infinite', spr(['K.K', '.K.']), 96, 2) +
      f.g('bob .6s step-end infinite', clawd(f, 48, 6, { eyes: 'shades', sit: true, armRUp: true, armR: 'wave 1.2s step-end infinite' }) + `<g transform="translate(46 9)">${car}${wheels}</g>`) +
      [0, 0.3].map(d => f.g(`dust .6s linear infinite ${-d}s`, rect(0, 0, 2, 1, 'g'), 45, 13)).join('')
    )
  }

  return f.cycle([sunset, fishing, hammockScene, campfire, barbecue, drive], 48)
}

// One still frame of `mood`, `t` seconds after it began.
export function sceneSvg(mood: Mood, t: number): string {
  const f = new Frame(t)
  const body = mood === 'working' ? working(f) : mood === 'done' ? done(f) : mood === 'relax' ? relax(f) : idle(f)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W * 3}" height="${H * 3}" shape-rendering="crispEdges">` +
    `<rect x="-2" y="-2" width="${W + 4}" height="${H + 4}" fill="${BAND_BG}"/>${dots(f)}${body}</svg>`
  )
}

export const SCENE_WIDTH = W * 3
export const SCENE_HEIGHT = H * 3
