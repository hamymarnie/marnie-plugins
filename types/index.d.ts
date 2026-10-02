export type Mood = 'idle' | 'working' | 'done' | 'relax'
export type Limit = { kind: string; percentUsed: number; resetsAt?: string }
export type Ctx = { tokens?: number; window: number; percent?: number }

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
    }
  }
}
