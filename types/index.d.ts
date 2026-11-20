export type Limit = { kind: string; percentUsed: number; resetsAt?: string }
export type Mode = 'full' | 'compact' | 'hidden'

declare module 'claude-code' {
  interface PluginState {
    'han-muc': { limits: Limit[]; isHidden: boolean; mode: Mode }
  }
}
