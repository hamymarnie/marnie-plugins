export type Mood = 'idle' | 'working' | 'done' | 'relax'
export type Limit = { kind: string; percentUsed: number; resetsAt?: string }
export type Ctx = { tokens?: number; window: number; percent?: number }

// One session's spend inside a rate-limit window, its subagents included.
export type Thread = {
  id: string
  title: string
  project: string
  usd: number
  tokens: number
  firstAt: number
  lastAt: number
}
// One model's spend inside a window, by its display name ("Opus 5.5").
export type ModelSpend = { label: string; usd: number; tokens: number }
// `models` is absent from a report an older version stored.
export type WindowReport = { start: number; usd: number; tokens: number; threads: Thread[]; models?: ModelSpend[] }
// What every transcript on this machine has cost, priced at API rates, per window.
export type UsageReport = {
  at: number
  host: string
  working: number
  yourTurn: number
  five_hour?: WindowReport
  seven_day?: WindowReport
}
export type PopupView = { window: 'five_hour' | 'seven_day'; group: 'threads' | 'projects' }

declare module 'claude-code' {
  interface PluginState {
    'pixel-buddy': {
      mood: Mood
      moodAt: number
      frame: number
      cacheAt: number | null
      now: number
      minute: number
      ctx: Ctx | null
      limits: Limit[]
      report: UsageReport | null
      isPinned: boolean
      view: PopupView
    }
  }
}
