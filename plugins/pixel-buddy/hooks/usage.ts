// Dollar figures for the usage meters. Claude Code writes every session's transcript
// under <config>/projects/<project>/<session>.jsonl; each assistant line carries the
// API usage of one request. Pricing those lines, across every session on this machine,
// gives what each rate-limit window has cost so far, and against the window's percent
// how many dollars one percent is worth.

import type { Thread, UsageReport, WindowReport } from '../types'

// Per million tokens: [input, output, cache read]. Cache writes are 1.25x input for
// the 5-minute cache and 2x for the hour cache. Longest matching prefix wins.
const PRICES: [string, number, number, number][] = (
  [
    ['claude-fable-5-1', 10, 50, 0.25],
    ['claude-fable-5', 10, 50, 1],
    ['claude-mythos', 10, 50, 1],
    ['claude-opus-5-5', 4, 20, 0.2],
    ['claude-opus-5', 5, 25, 0.5],
    ['claude-opus-4-8', 5, 25, 0.5],
    ['claude-opus-4-7', 5, 25, 0.5],
    ['claude-opus-4-6', 5, 25, 0.5],
    ['claude-opus-4-5', 5, 25, 0.5],
    ['claude-opus-4', 15, 75, 1.5],
    ['claude-3-opus', 15, 75, 1.5],
    ['claude-sonnet-5-5', 2, 10, 0.2],
    ['claude-sonnet-5', 2, 10, 0.2],
    ['claude-sonnet-4', 3, 15, 0.3],
    ['claude-3-7-sonnet', 3, 15, 0.3],
    ['claude-3-5-sonnet', 3, 15, 0.3],
    ['claude-haiku-5-5', 0.1, 0.5, 0.01],
    ['claude-haiku-4-5', 1, 5, 0.1],
    ['claude-3-5-haiku', 0.8, 4, 0.08],
    ['claude-3-haiku', 0.25, 1.25, 0.03],
  ] as [string, number, number, number][]
).sort((a, b) => b[0].length - a[0].length)

type Usage = {
  input_tokens?: number
  output_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number }
  server_tool_use?: { web_search_requests?: number }
  speed?: string
}

function price(model: string, u: Usage): number {
  const id = model.toLowerCase().replace(/^(us\.|eu\.|global\.)?anthropic\./, '')
  const p = PRICES.find(([prefix]) => id.startsWith(prefix))
  if (!p) return 0
  const [, inp, out, read] = p
  const write = u.cache_creation_input_tokens ?? 0
  const w1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0
  const w5m = u.cache_creation ? (u.cache_creation.ephemeral_5m_input_tokens ?? 0) : write
  const usd =
    ((u.input_tokens ?? 0) * inp +
      (u.output_tokens ?? 0) * out +
      (u.cache_read_input_tokens ?? 0) * read +
      w5m * inp * 1.25 +
      w1h * inp * 2) /
    1_000_000
  return usd * (u.speed === 'fast' ? 2 : 1) + (u.server_tool_use?.web_search_requests ?? 0) * 0.01
}

const tokensOf = (u: Usage) =>
  (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)

// One priced request. `id` dedupes the lines a streamed message writes, and the
// copies a resumed or forked session carries over from its parent.
type Entry = { id: string; at: number; usd: number; tok: number }

export type FileSummary = {
  size: number
  mtimeMs: number
  parsedAt: number
  session: string // the main session the file belongs to (a subagent's parent)
  isMain: boolean
  entries: Entry[]
  cwd?: string
  title?: string
  agentName?: string
  lastPrompt?: string
  // What the session is doing: waiting on the model, or on the person.
  last: 'user' | 'assistant' | 'idle' | undefined
  lastStop?: string
}

export type WindowSpec = { kind: 'five_hour' | 'seven_day'; start: number }

// Files over this are streamed through a child process, since one $.fs.read stops at 4 MiB.
export const READ_LIMIT = 4 * 1024 * 1024 - 1024
// Work done in one dispatch before handing the rest to a fresh timer.
export const SLICE_MS = 800
const WORKING_STALE_MS = 10 * 60_000

function baseName(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? p
}

export function parseLines(text: string, f: FileSummary, carry: { rest: string }, seen: Set<string>) {
  const chunk = carry.rest + text
  const lines = chunk.split('\n')
  carry.rest = lines.pop() ?? ''
  for (const line of lines) parseLine(line, f, seen)
}

export function parseLine(line: string, f: FileSummary, seen: Set<string>) {
  if (line.length < 2) return
  const head = line.slice(0, 400)
  if (head.startsWith('{"parentUuid"') && head.includes('"type":"user"')) {
    f.last = line.includes('[Request interrupted by user') ? 'idle' : 'user'
    return
  }
  if (line.includes('"type":"assistant"') && line.includes('"usage"')) {
    let d: any
    try {
      d = JSON.parse(line)
    } catch {
      return
    }
    if (d?.type !== 'assistant' || !d.message?.usage) return
    if (d.cwd) f.cwd = d.cwd
    f.last = 'assistant'
    f.lastStop = d.message.stop_reason ?? f.lastStop
    const id = `${d.message.id ?? d.uuid}:${d.requestId ?? ''}`
    if (seen.has(id)) return
    seen.add(id)
    const at = Date.parse(d.timestamp)
    if (!Number.isFinite(at)) return
    const u = d.message.usage as Usage
    f.entries.push({ id, at, usd: price(String(d.message.model ?? ''), u), tok: tokensOf(u) })
    return
  }
  if (!f.isMain || line.length > 4000) return
  if (head.includes('"type":"custom-title"') || head.includes('"type":"agent-name"') || head.includes('"type":"last-prompt"') || head.includes('"type":"summary"')) {
    try {
      const d = JSON.parse(line)
      if (d.type === 'custom-title' && d.customTitle) f.title = d.customTitle
      else if (d.type === 'agent-name' && d.agentName) f.agentName = d.agentName
      else if (d.type === 'last-prompt' && d.lastPrompt) f.lastPrompt = d.lastPrompt
      else if (d.type === 'summary' && d.summary && !f.title) f.agentName ??= d.summary
    } catch {}
  }
}

export type Listed = { path: string; size: number; mtimeMs: number; session: string; isMain: boolean }

// Totals each window from every file read, each request billed once.
export function summarize(
  files: ReadonlyMap<string, FileSummary>,
  specs: WindowSpec[],
  now: number,
  hostLabel: string,
): UsageReport {
  const owner = new Map<string, string>() // entry id -> the first file that billed it
  const sessions = new Map<string, FileSummary[]>()
  for (const [path, f] of files) {
    const list = sessions.get(f.session) ?? []
    list.push(f)
    sessions.set(f.session, list)
    for (const e of f.entries) if (!owner.has(e.id)) owner.set(e.id, path)
  }
  const meta = (id: string) => {
    const list = sessions.get(id) ?? []
    const main = list.find(f => f.isMain)
    const cwd = main?.cwd ?? list.find(f => f.cwd)?.cwd
    const title = main?.title ?? main?.agentName ?? main?.lastPrompt ?? id.slice(0, 8)
    return { title, project: cwd ? baseName(cwd) : '' }
  }

  const out: Partial<Record<WindowSpec['kind'], WindowReport>> = {}
  for (const w of specs) {
    const threads = new Map<string, Thread>()
    let usd = 0
    let tok = 0
    for (const [path, f] of files) {
      for (const e of f.entries) {
        if (e.at < w.start || owner.get(e.id) !== path) continue
        usd += e.usd
        tok += e.tok
        let t = threads.get(f.session)
        if (!t) {
          const m = meta(f.session)
          t = { id: f.session, title: m.title, project: m.project, usd: 0, tokens: 0, firstAt: e.at, lastAt: e.at }
          threads.set(f.session, t)
        }
        t.usd += e.usd
        t.tokens += e.tok
        t.firstAt = Math.min(t.firstAt, e.at)
        t.lastAt = Math.max(t.lastAt, e.at)
      }
    }
    out[w.kind] = { start: w.start, usd, tokens: tok, threads: [...threads.values()].sort((a, b) => b.usd - a.usd) }
  }

  // Sessions with activity in the 5h window: working while the model holds the turn.
  const since = specs.find(w => w.kind === 'five_hour')?.start ?? now - 5 * 3_600_000
  let working = 0
  let yourTurn = 0
  for (const [, list] of sessions) {
    const main = list.find(f => f.isMain)
    if (!main || main.mtimeMs < since) continue
    const isBusy =
      now - main.mtimeMs < WORKING_STALE_MS &&
      (main.last === 'user' || (main.last === 'assistant' && main.lastStop !== 'end_turn'))
    if (isBusy) working++
    else yourTurn++
  }
  return { at: now, host: hostLabel, working, yourTurn, five_hour: out.five_hour, seven_day: out.seven_day }
}
