// ---------- 蒙皮与网格:防撕裂的核心 ----------
// 策略(三管齐下):
// 1) 网格细分:每部件切成 N×N 网格,大角度旋转时变形被分摊到多行顶点,不会一步拉穿。
// 2) 平滑双骨骼混合:关节带附近权重渐变,避免硬折;窄过渡带 + 细分网格 ≈ 皮影软皮效果。
// 3) 关节铆钉圆片:渲染层在关节处盖铆钉,物理上遮住残余接缝(真皮影本来就有铆钉)。
// 另有 rigid 模式:整片 100% 绑单骨骼,纯铰接零形变 —— 传统皮影做法,绝不撕裂。

import { mat3Multiply, mat3Translate, mat3Rotate, mat3Apply, mat3Invert, distToSegment } from './mat2d.js'

// 生成部件网格(角色绑定空间坐标 + uv + 索引)
export function buildGrid(part) {
  const seg = Math.max(2, part.segments | 0)
  const cos = Math.cos(part.rotation), sin = Math.sin(part.rotation)
  const positions = new Float32Array((seg + 1) * (seg + 1) * 2)
  const uvs = new Float32Array((seg + 1) * (seg + 1) * 2)
  const indices = []
  let vi = 0
  for (let j = 0; j <= seg; j++) {
    for (let i = 0; i <= seg; i++) {
      const u = i / seg, v = j / seg
      // 局部坐标:原点在 pivot,y 向上(贴图 y 向下,故翻转)
      const lx = u * part.width - part.pivot.x
      const ly = part.pivot.y - v * part.height
      // 转到角色空间
      const x = part.x + lx * cos - ly * sin
      const y = part.y + lx * sin + ly * cos
      positions[vi * 2] = x
      positions[vi * 2 + 1] = y
      uvs[vi * 2] = u
      uvs[vi * 2 + 1] = 1 - v // three 的 uv 原点在左下
      vi++
    }
  }
  for (let j = 0; j < seg; j++) {
    for (let i = 0; i < seg; i++) {
      const a = j * (seg + 1) + i, b = a + 1, c = a + seg + 1, d = c + 1
      indices.push(a, c, b, b, c, d)
    }
  }
  return { positions, uvs, indices, count: (seg + 1) * (seg + 1) }
}

// 骨骼世界变换(绑定姿势或带动画旋转偏移)
// extraRot: { boneId: 弧度偏移 }
export function boneWorldTransforms(bones, extraRot = {}) {
  const world = new Array(bones.length)
  const indexOf = {}
  bones.forEach((b, i) => { indexOf[b.id] = i })
  function compute(i) {
    if (world[i]) return world[i]
    const b = bones[i]
    const local = mat3Multiply(mat3Translate(b.x, b.y), mat3Rotate(b.rotation + (extraRot[b.id] || 0)))
    world[i] = b.parentId != null && indexOf[b.parentId] != null
      ? mat3Multiply(compute(indexOf[b.parentId]), local)
      : local
    return world[i]
  }
  bones.forEach((_, i) => compute(i))
  return world
}

// 骨骼线段端点(世界系):从关节原点沿局部 +x 方向 length
export function boneSegment(bones, world, i) {
  const [x1, y1] = mat3Apply(world[i], 0, 0)
  const [x2, y2] = mat3Apply(world[i], bones[i].length, 0)
  return { x1, y1, x2, y2 }
}

// 自动权重(皮影专用策略):
// 每个部件有一根「主骨」(离部件关节点最近的骨)。顶点默认 100% 跟主骨 —— 皮片是硬的;
// 只有在关节带(主骨关节点 / 子骨关节点附近)内的顶点,才按距离渐变分一部分权重给相邻骨,
// 形成窄而软的铰链过渡带。这样大角度旋转时形变只发生在关节带,绝不会把躯干拉穿。
export function computeAutoWeights(bones, bindWorld, positions, count, { rigid = false, smoothness = 0.5, pivotX = 0, pivotY = 0 } = {}) {
  const weights = new Array(count)
  if (bones.length === 0) {
    for (let v = 0; v < count; v++) weights[v] = [-1, 1, -1, 0]
    return weights
  }
  // 主骨:离部件关节点最近的骨线段
  const segs = bones.map((_, i) => boneSegment(bones, bindWorld, i))
  let home = 0, homeD = Infinity
  segs.forEach((s, i) => {
    const d = distToSegment(pivotX, pivotY, s.x1, s.y1, s.x2, s.y2)
    if (d < homeD) { homeD = d; home = i }
  })
  const homeBone = bones[home]
  const parentIdx = bones.findIndex(b => b.id === homeBone.parentId)
  const childIdxs = bones.map((b, i) => b.parentId === homeBone.id ? i : -1).filter(i => i >= 0)
  // 关节带宽度:随平滑度与骨长缩放
  const band = Math.max(12, (0.15 + smoothness * 0.55) * homeBone.length)
  const homeJoint = { x: segs[home].x1, y: segs[home].y1 }
  const childJoints = childIdxs.map(i => ({ i, x: segs[i].x1, y: segs[i].y1 }))

  for (let v = 0; v < count; v++) {
    const px = positions[v * 2], py = positions[v * 2 + 1]
    if (rigid) { weights[v] = [home, 1, -1, 0]; continue }
    // 最近的关联关节:主骨自身关节(→ 与父骨混合)或子骨关节(→ 与该子骨混合)
    let other = -1, bestD = Infinity
    if (parentIdx >= 0) {
      const d = Math.hypot(px - homeJoint.x, py - homeJoint.y)
      if (d < bestD) { bestD = d; other = parentIdx }
    }
    for (const cj of childJoints) {
      const d = Math.hypot(px - cj.x, py - cj.y)
      if (d < bestD) { bestD = d; other = cj.i }
    }
    if (other < 0 || bestD >= band) { weights[v] = [home, 1, -1, 0]; continue }
    // 平滑过渡:关节处最多五成,带外为零(smoothstep)
    const t = 1 - bestD / band
    const wOther = 0.5 * t * t * (3 - 2 * t)
    weights[v] = [home, 1 - wOther, other, wOther]
  }
  return weights
}

// CPU 线性蒙皮:v' = Σ w · (animWorld · bindWorld⁻¹) · v
export function skinPositions(positions, count, weights, bindWorld, animWorld, out) {
  const inv = bindWorld.map(mat3Invert)
  const delta = bones_delta(animWorld, inv)
  const target = out || new Float32Array(positions.length)
  for (let v = 0; v < count; v++) {
    const w = weights[v]
    const x = positions[v * 2], y = positions[v * 2 + 1]
    if (!w || w[0] < 0) { target[v * 2] = x; target[v * 2 + 1] = y; continue }
    let nx = 0, ny = 0
    for (let k = 0; k < 2; k++) {
      const bi = w[k * 2], wgt = w[k * 2 + 1]
      if (bi < 0 || wgt <= 0) continue
      const m = delta[bi]
      nx += wgt * (m[0] * x + m[2] * y + m[4])
      ny += wgt * (m[1] * x + m[3] * y + m[5])
    }
    target[v * 2] = nx
    target[v * 2 + 1] = ny
  }
  return target
}
function bones_delta(animWorld, invBind) {
  return animWorld.map((m, i) => mat3Multiply(m, invBind[i]))
}

// 笔刷刷权重:对半径内顶点增加目标骨权重(强度随距离衰减),再归一化
export function paintWeights(weights, positions, count, cx, cy, radius, boneIndex, strength) {
  for (let v = 0; v < count; v++) {
    const dx = positions[v * 2] - cx, dy = positions[v * 2 + 1] - cy
    const d = Math.hypot(dx, dy)
    if (d > radius) continue
    const fall = 1 - d / radius
    const add = strength * fall * fall
    let w = weights[v] ? [...weights[v]] : [-1, 0, -1, 0]
    // 找到目标骨槽位,没有则替换权重最小的槽
    let slot = -1
    if (w[0] === boneIndex) slot = 0
    else if (w[2] === boneIndex) slot = 1
    else slot = (w[1] <= (w[3] || 0)) ? 0 : 1
    w[slot * 2] = boneIndex
    w[slot * 2 + 1] = Math.min(1, w[slot * 2 + 1] + add)
    // 另一槽相应衰减并归一化
    const other = 1 - slot
    if (w[other * 2] >= 0) w[other * 2 + 1] = Math.max(0, w[other * 2 + 1] - add)
    const sum = w[1] + w[3]
    if (sum <= 1e-6) { w = [boneIndex, 1, -1, 0] }
    else { w[1] /= sum; w[3] /= sum }
    if (w[3] < 0.001) { w[2] = -1; w[3] = 0 }
    weights[v] = w
  }
}
