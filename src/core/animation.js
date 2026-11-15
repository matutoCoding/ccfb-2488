// ---------- 关键帧 / 缓动 / 片段混合 ----------

export const EASING_TYPES = ['linear', 'easeIn', 'easeOut', 'easeInOut', 'bezier']

export function easeValue(ease, t) {
  if (!ease || ease.type === 'linear') return t
  switch (ease.type) {
    case 'easeIn': return t * t * t
    case 'easeOut': return 1 - Math.pow(1 - t, 3)
    case 'easeInOut': return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
    case 'bezier': return cubicBezier(ease.x1 ?? 0.4, ease.y1 ?? 0, ease.x2 ?? 0.6, ease.y2 ?? 1, t)
    default: return t
  }
}

// 三次贝塞尔缓动(与 CSS cubic-bezier 同义),牛顿迭代解 x(t)
function cubicBezier(x1, y1, x2, y2, t) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by
  const sampleX = (u) => ((ax * u + bx) * u + cx) * u
  const sampleY = (u) => ((ay * u + by) * u + cy) * u
  const sampleDX = (u) => (3 * ax * u + 2 * bx) * u + cx
  let u = t
  for (let i = 0; i < 8; i++) {
    const err = sampleX(u) - t
    if (Math.abs(err) < 1e-6) return sampleY(u)
    const d = sampleDX(u)
    if (Math.abs(d) < 1e-6) break
    u -= err / d
  }
  // 二分兜底
  let lo = 0, hi = 1
  u = t
  while (hi - lo > 1e-6) {
    if (sampleX(u) < t) lo = u; else hi = u
    u = (lo + hi) / 2
  }
  return sampleY(u)
}

export function defaultEase() { return { type: 'easeInOut' } }

// 在一条轨道上采样(keys 已按 t 排序)
export function sampleTrack(keys, t) {
  if (!keys || keys.length === 0) return 0
  if (t <= keys[0].t) return keys[0].v
  const last = keys[keys.length - 1]
  if (t >= last.t) return last.v
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1]
    if (t >= a.t && t <= b.t) {
      const span = b.t - a.t
      const local = span > 1e-9 ? (t - a.t) / span : 0
      const k = easeValue(a.ease, local) // 缓动挂在区间起点那一帧上
      return a.v + (b.v - a.v) * k
    }
  }
  return last.v
}

// 采样整个片段 → { trackKey: value }
export function sampleClip(clip, t) {
  const out = {}
  for (const key of Object.keys(clip.tracks)) {
    out[key] = sampleTrack(clip.tracks[key], t)
  }
  return out
}

// 两个片段按 alpha 混合(0=全a,1=全b),时间各自按自身时长归一
export function blendClips(clipA, clipB, t, alpha) {
  const ta = clipA.duration > 0 ? (t / clipA.duration) % 1 : 0
  const tb = clipB.duration > 0 ? (t / clipB.duration) % 1 : 0
  const pa = sampleClip(clipA, ta * clipA.duration)
  const pb = sampleClip(clipB, tb * clipB.duration)
  const keys = new Set([...Object.keys(pa), ...Object.keys(pb)])
  const out = {}
  for (const k of keys) {
    const va = pa[k] ?? 0, vb = pb[k] ?? 0
    out[k] = va * (1 - alpha) + vb * alpha
  }
  return out
}

// 角度插值走最短弧(混合旋转时防止绕远路)
export function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return a + d * t
}

export function blendClipsAngular(clipA, clipB, t, alpha) {
  const ta = clipA.duration > 0 ? (t / clipA.duration) % 1 : 0
  const tb = clipB.duration > 0 ? (t / clipB.duration) % 1 : 0
  const pa = sampleClip(clipA, ta * clipA.duration)
  const pb = sampleClip(clipB, tb * clipB.duration)
  const keys = new Set([...Object.keys(pa), ...Object.keys(pb)])
  const out = {}
  for (const k of keys) {
    const va = pa[k] ?? 0, vb = pb[k] ?? 0
    out[k] = (k === 'root.x' || k === 'root.y') ? va * (1 - alpha) + vb * alpha : lerpAngle(va, vb, alpha)
  }
  return out
}

// 把混合结果烘焙成新片段
export function bakeBlend(clipA, clipB, alpha, fps, newClip) {
  const duration = Math.max(clipA.duration, clipB.duration)
  const frames = Math.max(2, Math.round(duration * fps))
  const keys = new Set([...Object.keys(clipA.tracks), ...Object.keys(clipB.tracks)])
  newClip.duration = duration
  newClip.tracks = {}
  for (const key of keys) newClip.tracks[key] = []
  for (let f = 0; f <= frames; f++) {
    const t = (f / frames) * duration
    const pose = blendClipsAngular(clipA, clipB, t, alpha)
    for (const key of keys) {
      newClip.tracks[key].push({ t, v: pose[key] ?? 0, ease: { type: 'linear' } })
    }
  }
  return newClip
}
