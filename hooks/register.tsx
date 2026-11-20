import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Limit, Mode } from '../types'

const limits = atom({ plugin: 'han-muc', key: 'limits' } as const, [] as Limit[])
const mode = atom({ plugin: 'han-muc', key: 'mode' } as const, 'full' as Mode)

type Info = { name: string; short: string; spanMs?: number }
const INFO: Record<string, Info> = {
  five_hour: { name: 'Phiên 5 giờ', short: '5g', spanMs: 5 * 3_600_000 },
  seven_day: { name: 'Tuần 7 ngày', short: '7n', spanMs: 7 * 86_400_000 },
  spend_limit: { name: 'Chi tiêu', short: '$' },
}
const info = (k: string): Info => INFO[k] ?? { name: k, short: k }

// Màu cố định (hex) để luôn hiện màu, không phụ thuộc giao diện
const C = { green: '#22c55e', lime: '#a3e635', amber: '#f59e0b', orange: '#f97316', red: '#ef4444', rest: '#4b5563', mark: '#e5e7eb', title: '#d97757', label: '#93c5fd' }
const tone = (p: number) => (p >= 90 ? C.red : p >= 70 ? C.amber : C.green)
/** Màu từng ô theo vị trí trên thanh: dải xanh → vàng → đỏ */
const heat = (pos: number) => (pos < 40 ? C.green : pos < 60 ? C.lime : pos < 75 ? C.amber : pos < 90 ? C.orange : C.red)
const icon = (p: number) => (p >= 90 ? '●' : p >= 70 ? '◐' : '○')

const left = (iso: string | undefined, now: number) => {
  if (!iso) return ''
  const ms = Date.parse(iso) - now
  if (!(ms > 0)) return 'sắp làm mới'
  const d = Math.floor(ms / 86_400_000)
  const h = Math.floor((ms % 86_400_000) / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return d > 0 ? `${d} ngày ${h} giờ` : h > 0 ? `${h} giờ ${m} phút` : `${m} phút`
}

/** Phần thời gian đã trôi của khung (0..1), để so nhịp dùng. */
const elapsed = (l: Limit, now: number) => {
  const span = info(l.kind).spanMs
  if (!span || !l.resetsAt) return undefined
  const f = 1 - (Date.parse(l.resetsAt) - now) / span
  return f >= 0 && f <= 1 ? f : undefined
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    const u = await $.session.usage()
    await update($, limits, () => u.rateLimits)
    $.command.register({ name: 'han-muc', description: 'Thanh hạn mức: đầy đủ → gọn → ẩn (hoặc /han-muc day|gon|an)' })
    return r
  })

  on('session.measure', async ($, e, next) => {
    const before = await read($, limits)
    await update($, limits, () => e.rateLimits)
    for (const l of e.rateLimits) {
      const old = before.find(b => b.kind === l.kind)?.percentUsed ?? 0
      if (l.percentUsed >= 90 && old < 90) $.ui.toast(`⚠ ${info(l.kind).name}: đã dùng ${l.percentUsed}%`)
    }
    return next(e)
  })

  on('command.run', { command: 'han-muc' }, async ($, e) => {
    const a = e.args.trim().toLowerCase()
    const pick: Mode | undefined = a.startsWith('d') ? 'full' : a.startsWith('g') ? 'compact' : a.startsWith('a') ? 'hidden' : undefined
    const m = await update($, mode, v => pick ?? (v === 'full' ? 'compact' : v === 'compact' ? 'hidden' : 'full'))
    return { text: `Thanh hạn mức: ${m === 'full' ? 'đầy đủ' : m === 'compact' ? 'gọn' : 'ẩn'}.` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const m = await read($, mode)
    if (e.props.hasSurvey || m === 'hidden') return next(e)

    const list = await read($, limits)
    const now = await $.clock.now()
    const { Box, Text } = $.ui.resolve(e)

    const bar = (l: Limit, width: number) => {
      const p = Math.max(0, Math.min(100, l.percentUsed))
      const filled = Math.round((p / 100) * width)
      const f = elapsed(l, now)
      const mark = f === undefined ? -1 : Math.min(width - 1, Math.round(f * width))
      const cells = Array.from({ length: width }, (_, i) => i)
      // gom các ô liền nhau cùng kiểu thành một đoạn Text
      const kind = (i: number) => (i === mark ? 'mark' : i < filled ? heat(((i + 0.5) / width) * 100) : 'rest')
      const runs: { k: string; n: number }[] = []
      for (const i of cells) {
        const k = kind(i)
        const last = runs[runs.length - 1]
        if (last && last.k === k) last.n += 1
        else runs.push({ k, n: 1 })
      }
      return (
        <Text>
          {runs.map((r, i) =>
            r.k === 'mark' ? <Text key={String(i)} color={C.mark} weight="bold">{'┃'}</Text>
            : r.k === 'rest' ? <Text key={String(i)} color={C.rest}>{'─'.repeat(r.n)}</Text>
            : <Text key={String(i)} color={r.k}>{'━'.repeat(r.n)}</Text>,
          )}
        </Text>
      )
    }

    if (list.length === 0) {
      return (
        <Box paddingX={1}>
          <Text color="subtle">◌ Hạn mức: chờ số liệu sau lượt trả lời đầu (cần gói thuê bao)</Text>
        </Box>
      )
    }

    if (m === 'compact') {
      return (
        <Box flexDirection="row" gap={2} paddingX={1}>
          {list.map(l => (
            <Box key={l.kind} flexDirection="row" gap={1}>
              <Text color={C.label}>{info(l.kind).short}</Text>
              {bar(l, 10)}
              <Text color={tone(l.percentUsed)} weight="bold">{l.percentUsed}%</Text>
            </Box>
          ))}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" borderStyle="round" borderColor={C.title} paddingX={1}>
        <Box flexDirection="row" justifyContent="space-between">
          <Text color={C.title} weight="bold">✻ Hạn mức sử dụng</Text>
          <Text color="subtle">┃ = thời gian đã trôi</Text>
        </Box>
        {list.map(l => {
          const p = l.percentUsed
          const f = elapsed(l, now)
          const pace = f === undefined ? '' : p / 100 > f + 0.1 ? 'nhanh hơn nhịp' : p / 100 < f - 0.1 ? 'trong nhịp' : 'đúng nhịp'
          const reset = left(l.resetsAt, now)
          return (
            <Box key={l.kind} flexDirection="row" gap={1}>
              <Text color={tone(p)}>{icon(p)}</Text>
              <Text color={C.label}>{info(l.kind).name.padEnd(11)}</Text>
              {bar(l, 24)}
              <Text color={tone(p)} weight="bold">{`${p}%`.padStart(4)}</Text>
              <Text color="subtle">
                {[reset && `còn ${reset}`, pace].filter(Boolean).join(' · ')}
              </Text>
            </Box>
          )
        })}
      </Box>
    )
  })
}
