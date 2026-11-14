import { expect, mock, test } from 'claude-code/testing'

import { sceneSvg } from '../hooks/scene'
import { modelLabel, parseLines, summarize } from '../hooks/usage'
import type { FileSummary } from '../hooks/usage'

const HOUR = 3_600_000
const near = (a: number | undefined, b: number) => a !== undefined && Math.abs(a - b) < 1e-9
const NOW = Date.parse('2026-10-09T12:00:00Z')

function assistantLine(id: string, at: number, stop: string, usage: object, model = 'claude-opus-5-5') {
  return JSON.stringify({
    parentUuid: 'p',
    message: { model, id, role: 'assistant', stop_reason: stop, usage },
    requestId: `req_${id}`,
    type: 'assistant',
    timestamp: new Date(at).toISOString(),
    cwd: 'G:\\Projects\\pixel-buddy',
    sessionId: 's1',
  })
}

function summaryOf(session: string, isMain: boolean, mtimeMs: number, lines: string[]): FileSummary {
  const f: FileSummary = { size: 0, mtimeMs, parsedAt: NOW, session, isMain, entries: [], last: undefined }
  parseLines(lines.join('\n') + '\n', f, { rest: '' }, new Set())
  return f
}

test('prices requests once each and totals them per window', async () => {
  // Opus 5.5: $4 in, $20 out, $0.20 cache read, 2x input for an hour cache write.
  const usage = {
    input_tokens: 1_000_000,
    output_tokens: 100_000,
    cache_read_input_tokens: 1_000_000,
    cache_creation_input_tokens: 100_000,
    cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 100_000 },
  }
  const recent = assistantLine('m1', NOW - HOUR, 'end_turn', usage)
  const old = assistantLine('m2', NOW - 30 * HOUR, 'end_turn', usage)
  const main = summaryOf('s1', true, NOW - HOUR, [
    JSON.stringify({ type: 'custom-title', customTitle: 'Dollar usage', sessionId: 's1' }),
    recent,
    recent, // a streamed message writes its usage on several lines
    old,
  ])
  const files = new Map([['a.jsonl', main]])
  const r = summarize(
    files,
    [
      { kind: 'five_hour', start: NOW - 5 * HOUR },
      { kind: 'seven_day', start: NOW - 7 * 24 * HOUR },
    ],
    NOW,
    'ROG',
  )
  const one = 4 + 2 + 0.2 + 0.8
  expect(near(r.five_hour?.usd, one)).toBe(true)
  expect(near(r.seven_day?.usd, 2 * one)).toBe(true)
  expect(r.five_hour?.threads[0]?.title).toBe('Dollar usage')
  expect(r.five_hour?.threads[0]?.project).toBe('pixel-buddy')
  expect(r.yourTurn).toBe(1)
  expect(r.working).toBe(0)
})

test('bills a subagent to its session and a forked copy only once', async () => {
  const usage = { input_tokens: 0, output_tokens: 1_000_000 }
  const shared = assistantLine('m1', NOW - HOUR, 'tool_use', usage, 'claude-sonnet-5-5')
  const parent = summaryOf('s1', true, NOW - 1000, [shared])
  const fork = summaryOf('s2', true, NOW - 2 * HOUR, [shared, assistantLine('m3', NOW - HOUR, 'end_turn', usage, 'claude-sonnet-5-5')])
  const agent = summaryOf('s1', false, NOW - HOUR, [assistantLine('m4', NOW - HOUR, 'end_turn', usage, 'claude-haiku-5-5')])
  const files = new Map([
    ['s1.jsonl', parent],
    ['s2.jsonl', fork],
    ['s1/subagents/agent-a.jsonl', agent],
  ])
  const r = summarize(files, [{ kind: 'five_hour', start: NOW - 5 * HOUR }], NOW, '')
  expect(near(r.five_hour?.usd, 10 + 10 + 0.5)).toBe(true)
  const s1 = r.five_hour?.threads.find(t => t.id === 's1')
  expect(near(s1?.usd, 10.5)).toBe(true)
  // The parent's last request asked for a tool: the model still holds the turn.
  expect(r.working).toBe(1)
  expect(r.yourTurn).toBe(1)
})

test('prices Fable 5.2 and Mythos 5.2 at their own rates, fast mode at double', async () => {
  // Fable / Mythos 5.2: $8 in, $40 out, $0.20 cache read.
  const usage = { input_tokens: 1_000_000, output_tokens: 100_000, cache_read_input_tokens: 1_000_000 }
  const one = 8 + 4 + 0.2
  const main = summaryOf('s1', true, NOW - HOUR, [
    assistantLine('f1', NOW - HOUR, 'end_turn', usage, 'claude-fable-5-2'),
    assistantLine('f2', NOW - HOUR, 'end_turn', usage, 'claude-mythos-5-2'),
    assistantLine('f3', NOW - HOUR, 'end_turn', { ...usage, speed: 'fast' }, 'claude-fable-5-2'),
  ])
  const r = summarize(new Map([['a.jsonl', main]]), [{ kind: 'five_hour', start: NOW - 5 * HOUR }], NOW, '')
  expect(near(r.five_hour?.usd, one + one + 2 * one)).toBe(true)
})

test('splits a window by model, each model used in it once', async () => {
  const usage = { input_tokens: 0, output_tokens: 1_000_000 }
  const main = summaryOf('s1', true, NOW - HOUR, [
    assistantLine('a1', NOW - HOUR, 'end_turn', usage, 'claude-fable-5-2'),
    assistantLine('a2', NOW - 2 * HOUR, 'end_turn', usage, 'claude-fable-5-2'),
    assistantLine('a3', NOW - HOUR, 'end_turn', usage, 'claude-opus-5-5'),
    assistantLine('a4', NOW - 3 * 24 * HOUR, 'end_turn', usage, 'claude-haiku-5-5'),
    assistantLine('a5', NOW - HOUR, 'end_turn', { input_tokens: 0, output_tokens: 0 }, '<synthetic>'),
  ])
  const r = summarize(
    new Map([['a.jsonl', main]]),
    [
      { kind: 'five_hour', start: NOW - 5 * HOUR },
      { kind: 'seven_day', start: NOW - 7 * 24 * HOUR },
    ],
    NOW,
    '',
  )
  expect(r.seven_day?.models?.map(m => [m.label, m.usd])).toEqual([
    ['Fable 5.2', 80],
    ['Opus 5.5', 20],
    ['Haiku 5.5', 0.5],
  ])
  // Haiku ran three days ago: it is in the week, not the five hours.
  expect(r.five_hour?.models?.map(m => m.label)).toEqual(['Fable 5.2', 'Opus 5.5'])
})

test('names models by family and version', async () => {
  expect(modelLabel('claude-opus-5-5')).toBe('Opus 5.5')
  expect(modelLabel('claude-fable-5')).toBe('Fable 5')
  expect(modelLabel('claude-3-5-sonnet-20241022')).toBe('Sonnet 3.5')
  expect(modelLabel('us.anthropic.claude-haiku-4-5-20251001-v1:0')).toBe('Haiku 4.5')
  expect(modelLabel('claude-opus-4-5@20251101')).toBe('Opus 4.5')
  expect(modelLabel('some-other-model')).toBe('some-other-model')
})

test('the info button pins the usage card open on desktop', async ($, on) => {
  mock.clock(on, { now: NOW })
  const ui = await $.ui.mount({
    plugin: 'pixel-buddy',
    surface: 'desktop',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 40 }, view: {} },
  })
  expect(await ui.find({ type: 'Button', key: 'pb-info' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /5h limit/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'pb-close' })).toBeUndefined()
  await ui.press({ key: 'pb-info' })
  expect(await ui.find({ type: 'Button', key: 'pb-close' })).toBeDefined()
  await ui.press({ key: 'pb-close' })
  expect(await ui.find({ type: 'Button', key: 'pb-close' })).toBeUndefined()
  await ui.unmount()
})

test('the mascot is one animated drawing per mood, so the band need not redraw to move it', async () => {
  const idle = sceneSvg('idle')
  expect(sceneSvg('idle')).toBe(idle)
  expect(idle.includes('@keyframes')).toBe(true)
  expect(idle.length).toBeLessThan(131_072)
  for (const mood of ['working', 'done', 'relax'] as const) expect(sceneSvg(mood).length).toBeLessThan(131_072)
})

test('a redrawn mascot picks its animation up where it was', async () => {
  const fresh = sceneSvg('working')
  const later = sceneSvg('working', 2.5)
  expect(fresh.includes('{{')).toBe(false)
  expect(later.includes('{{')).toBe(false)
  // "bob .3s step-end infinite -.15s" starts 2.5s further on: -.15 - 2.5.
  expect(fresh.includes('bob .3s step-end infinite -0.15s')).toBe(true)
  expect(later.includes('bob .3s step-end infinite -2.65s')).toBe(true)
})
