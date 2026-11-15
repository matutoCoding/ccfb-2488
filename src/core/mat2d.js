// ---------- 2D 仿射变换小工具(mat3,行主序 [a c e; b d f; 0 0 1]) ----------

export function mat3Identity() { return [1, 0, 0, 1, 0, 0] }

export function mat3Multiply(m, n) {
  // 返回 m * n
  const [a, b, c, d, e, f] = m
  const [A, B, C, D, E, F] = n
  return [
    a * A + c * B, b * A + d * B,
    a * C + c * D, b * C + d * D,
    a * E + c * F + e, b * E + d * F + f,
  ]
}

export function mat3Translate(x, y) { return [1, 0, 0, 1, x, y] }

export function mat3Rotate(rad) {
  const c = Math.cos(rad), s = Math.sin(rad)
  return [c, s, -s, c, 0, 0]
}

export function mat3Apply(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
}

export function mat3Invert(m) {
  const [a, b, c, d, e, f] = m
  const det = a * d - b * c
  if (Math.abs(det) < 1e-12) return mat3Identity()
  const ia = d / det, ib = -b / det, ic = -c / det, idd = a / det
  return [ia, ib, ic, idd, -(ia * e + ic * f), -(ib * e + idd * f)]
}

// 点到线段最短距离
export function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1
  const len2 = dx * dx + dy * dy
  let t = len2 > 0 ? ((px - x1) * dx + (py - y1) * dy) / len2 : 0
  t = Math.max(0, Math.min(1, t))
  const cx = x1 + t * dx, cy = y1 + t * dy
  return Math.hypot(px - cx, py - cy)
}
