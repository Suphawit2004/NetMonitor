// ─────────────────────────────────────────────
// Deterministic PRNG — ให้ข้อมูล mock นิ่งต่อ device
// (seed จาก id → ค่าเดิมทุกครั้งที่ render/refresh)
// ─────────────────────────────────────────────

export function hashString(input: string): number {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

// mulberry32
export function createRng(seed: number): () => number {
  let t = seed >>> 0
  return () => {
    t = (t + 0x6d2b79f5) >>> 0
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

export function randInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1))
}

export function pick<T>(rng: () => number, list: readonly T[]): T {
  return list[Math.floor(rng() * list.length)]
}

// ขยับค่าแบบคลื่น sin ตาม tick สำหรับโหมดจำลอง (tick = 0 → ค่าคงที่)
export function vary(value: number, tick: number, phase: number, amp: number): number {
  if (tick === 0 || value === 0) return value
  const v = value + Math.sin(tick * 0.55 + phase) * amp
  return Math.round(Math.max(0, Math.min(100, v)))
}
