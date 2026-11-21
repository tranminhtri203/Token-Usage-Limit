import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderInput } from 'claude-code'

import type { Limit, Mode } from '../types'

const limits = atom({ plugin: 'han-muc', key: 'limits' } as const, [] as Limit[])
const isFooter = atom({ plugin: 'han-muc', key: 'isFooter' } as const, true)
const mode = atom({ plugin: 'han-muc', key: 'mode' } as const, 'full' as Mode)

const PANE = 'han-muc'

type Info = { name: string; short: string; spanMs?: number }
const INFO: Record<string, Info> = {
  five_hour: { name: 'Phiên 5 giờ', short: '5g', spanMs: 5 * 3_600_000 },
  seven_day: { name: 'Tuần 7 ngày', short: '7n', spanMs: 7 * 86_400_000 },
  spend_limit: { name: 'Chi tiêu', short: '$' },
}
const info = (k: string): Info => INFO[k] ?? { name: k, short: k }

// Màu cố định (hex) để luôn hiện màu, không phụ thuộc giao diện
const C = { green: '#22c55e', amber: '#f59e0b', red: '#ef4444', title: '#d97757', label: '#93c5fd' }
const tone = (p: number) => (p >= 90 ? C.red : p >= 70 ? C.amber : C.green)

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

/** Icon: còn nhiều (đã dùng dưới 70%) → 🔋, còn ít (từ 70%) → 🪫 */
const dot = (p: number) => (p >= 70 ? '🪫' : '🔋')
/** Thanh ô màu 10 ô: 🟩 phần còn lại, 🟥 phần đã dùng, ô ranh giới 🟨 (khi còn ô xanh) */
const colorBar = (p: number, w = 10) => {
  const green = Math.round((Math.max(0, Math.min(100, 100 - p)) / 100) * w)
  const used = w - green
  if (used === 0) return '🟩'.repeat(w)
  return '🟩'.repeat(green) + (green > 0 ? '🟨' + '🟥'.repeat(used - 1) : '🟥'.repeat(used))
}
const summary = (list: Limit[], now: number) =>
  list.length === 0
    ? 'Chưa có số liệu hạn mức (cần gói thuê bao; có sau lượt trả lời đầu tiên).'
    : list
        .map(l => {
          const r = left(l.resetsAt, now)
          const when = r === '' ? '' : r === 'sắp làm mới' ? ' · sắp làm mới' : ` · còn ${r}`
          return `${dot(l.percentUsed)} ${info(l.kind).name.padEnd(11)} ${colorBar(l.percentUsed)}  ${l.percentUsed}%${when}`
        })
        .join('\n')
const statusText = (list: Limit[]) =>
  list.length === 0 ? undefined : list.map(l => `${dot(l.percentUsed)} ${info(l.kind).short} ${colorBar(l.percentUsed, 5)} ${l.percentUsed}%`).join('  ')

/** Ghi số liệu ra file cho skill đọc. Chỉ ghi khi đường dẫn hợp với hệ điều hành đang chạy. */
const writeOut = async ($: EngineInterface, outFile: string, list: Limit[]) => {
  if (!outFile || list.length === 0) return
  const isWinPath = /^[A-Za-z]:[\\/]/.test(outFile)
  const isWin = /win/i.test((await $.session.machine()).sysname)
  if (isWinPath !== isWin) return
  const now = await $.clock.now()
  const data = { updatedAt: new Date(now).toISOString(), limits: list, text: summary(list, now) }
  await $.fs.write(outFile, JSON.stringify(data, null, 2)).catch(() => undefined)
}

export const register: Register = (on, options) => {
  const outFile = typeof options?.outFile === 'string' ? options.outFile.trim() : ''

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    const u = await $.session.usage()
    await update($, limits, () => u.rateLimits)
    $.ui.status(statusText(u.rateLimits))
    void $.ui.open({ id: PANE, title: 'Hạn mức sử dụng', placement: 'widget' })
    $.command.register({ name: 'han-muc', description: 'Xem hạn mức sử dụng; đổi thanh: đầy đủ → gọn → ẩn (hoặc /han-muc day|gon|an)' })
    return r
  })

  on('session.measure', async ($, e, next) => {
    const before = await read($, limits)
    await update($, limits, () => e.rateLimits)
    $.ui.status(statusText(e.rateLimits))
    await writeOut($, outFile, e.rateLimits)
    for (const l of e.rateLimits) {
      const old = before.find(b => b.kind === l.kind)?.percentUsed ?? 0
      if (l.percentUsed >= 90 && old < 90) $.ui.toast(`⚠ ${info(l.kind).name}: đã dùng ${l.percentUsed}%`)
    }
    return next(e)
  })

  // Sau mỗi câu trả lời: in bảng hạn mức bên dưới (mô hình không đọc dòng này, không tốn token)
  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId !== undefined || e.reason !== 'answer' || !(await read($, isFooter))) return r
    const list = (await $.session.usage()).rateLimits
    if (list.length === 0) return r
    await update($, limits, () => list)
    await writeOut($, outFile, list)
    return { ...r, text: summary(list, await $.clock.now()) }
  })

  on('command.run', { command: 'han-muc' }, async ($, e) => {
    const a = e.args.trim().toLowerCase()
    if (a.startsWith('c')) {
      const on2 = await update($, isFooter, v => !v)
      return { text: on2 ? 'Đã bật bảng hạn mức cuối mỗi câu trả lời.' : 'Đã tắt bảng hạn mức cuối mỗi câu trả lời.' }
    }
    const pick: Mode | undefined = a.startsWith('d') ? 'full' : a.startsWith('g') ? 'compact' : a.startsWith('a') ? 'hidden' : undefined
    const m = await update($, mode, v => pick ?? (v === 'full' ? 'compact' : v === 'compact' ? 'hidden' : 'full'))
    const fresh = (await $.session.usage()).rateLimits
    await update($, limits, () => fresh)
    $.ui.status(statusText(fresh))
    const opened = await $.ui.open({ id: PANE, title: 'Hạn mức sử dụng', placement: 'widget' })
    const label = m === 'full' ? 'đầy đủ' : m === 'compact' ? 'gọn' : 'ẩn'
    return { text: `${summary(fresh, await $.clock.now())}\n(Thanh trên ô nhập: ${label} · /han-muc day|gon|an · /han-muc cuoi: bật/tắt bảng cuối câu trả lời)${opened.isPlaced ? '' : `\n(Khung bên cạnh chưa hiện: ${opened.reason})`}` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => draw($, e, 'pane'))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const m = await read($, mode)
    if (e.props.hasSurvey || m === 'hidden') return next(e)
    return draw($, e, m)
  })
}

async function draw($: EngineInterface, e: RenderInput<'Pane' | 'AbovePrompt'>, m: Mode | 'pane') {
  {

    const list = await read($, limits)
    const now = await $.clock.now()
    const { Box, Text } = $.ui.resolve(e)

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
              <Text>{colorBar(l.percentUsed, 5)}</Text>
              <Text color={tone(l.percentUsed)} weight="bold">{l.percentUsed}%</Text>
            </Box>
          ))}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" borderStyle="round" borderColor={C.title} paddingX={1}>
        <Text color={C.title} weight="bold">✻ Hạn mức sử dụng</Text>
        {list.map(l => {
          const p = l.percentUsed
          const f = elapsed(l, now)
          const pace = f === undefined ? '' : p / 100 > f + 0.1 ? 'nhanh hơn nhịp' : p / 100 < f - 0.1 ? 'trong nhịp' : 'đúng nhịp'
          const reset = left(l.resetsAt, now)
          return (
            <Box key={l.kind} flexDirection="row" gap={1}>
              <Text>{dot(p)}</Text>
              <Text color={C.label}>{info(l.kind).name.padEnd(11)}</Text>
              <Text>{colorBar(p)}</Text>
              <Text color={tone(p)} weight="bold">{`${p}%`.padStart(4)}</Text>
              <Text color="subtle">
                {[reset && `còn ${reset}`, pace].filter(Boolean).join(' · ')}
              </Text>
            </Box>
          )
        })}
      </Box>
    )
  }
}
