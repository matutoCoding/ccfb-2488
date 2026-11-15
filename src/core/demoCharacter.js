// ---------- 示例角色:程序化生成皮影风分件 PNG + 骨骼 + 权重 + 一个挥手动作 ----------
// 让剧团开箱就能看到完整流程效果。

import { createCharacter, createPart, createBone, createClip } from './model.js'
import { buildGrid, computeAutoWeights, boneWorldTransforms } from './skinning.js'

function drawPartCanvas(w, h, drawFn) {
  const cv = document.createElement('canvas')
  cv.width = w; cv.height = h
  const ctx = cv.getContext('2d')
  drawFn(ctx, w, h)
  return cv.toDataURL('image/png')
}

// 皮影风:皮色底 + 深色勾边 + 镂空花纹(destination-out)
function leather(ctx, color, pathFn, holes = []) {
  ctx.save()
  pathFn(ctx)
  ctx.fillStyle = color
  ctx.globalAlpha = 0.92
  ctx.fill()
  ctx.globalAlpha = 1
  ctx.lineWidth = 3
  ctx.strokeStyle = 'rgba(60,20,8,0.9)'
  ctx.stroke()
  // 镂空
  ctx.globalCompositeOperation = 'destination-out'
  for (const h of holes) {
    ctx.beginPath()
    ctx.arc(h[0], h[1], h[2], 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

function limbPath(ctx, w, h) {
  // 从顶部关节向下延伸的肢体条
  const cx = w / 2
  ctx.beginPath()
  ctx.moveTo(cx - w * 0.28, 6)
  ctx.quadraticCurveTo(cx - w * 0.42, h * 0.5, cx - w * 0.2, h - 8)
  ctx.quadraticCurveTo(cx, h - 2, cx + w * 0.2, h - 8)
  ctx.quadraticCurveTo(cx + w * 0.42, h * 0.5, cx + w * 0.28, 6)
  ctx.quadraticCurveTo(cx, -2, cx - w * 0.28, 6)
  ctx.closePath()
}

export function buildDemoCharacter() {
  const c = createCharacter('示例·小生')
  const D = Math.PI / 180

  // ---- 骨骼(世界布局,y 向上)----
  const bones = [
    createBone({ name: '躯干', parentId: null, x: 0, y: 0, rotation: 90 * D, length: 140 }),
  ]
  const [root] = bones
  const neck = createBone({ name: '头颈', parentId: root.id, x: 140, y: 0, rotation: 0, length: 60 })
  const lArm1 = createBone({ name: '左上臂', parentId: root.id, x: 120, y: 0, rotation: 120 * D, length: 70 })
  const lArm2 = createBone({ name: '左前臂', parentId: lArm1.id, x: 70, y: 0, rotation: 30 * D, length: 60 })
  const rArm1 = createBone({ name: '右上臂', parentId: root.id, x: 120, y: 0, rotation: 240 * D, length: 70 })
  const rArm2 = createBone({ name: '右前臂', parentId: rArm1.id, x: 70, y: 0, rotation: -30 * D, length: 60 })
  const lLeg1 = createBone({ name: '左大腿', parentId: root.id, x: 0, y: 0, rotation: 170 * D, length: 80 })
  const lLeg2 = createBone({ name: '左小腿', parentId: lLeg1.id, x: 80, y: 0, rotation: 10 * D, length: 70 })
  const rLeg1 = createBone({ name: '右大腿', parentId: root.id, x: 0, y: 0, rotation: 190 * D, length: 80 })
  const rLeg2 = createBone({ name: '右小腿', parentId: rLeg1.id, x: 80, y: 0, rotation: -10 * D, length: 70 })
  bones.push(neck, lArm1, lArm2, rArm1, rArm2, lLeg1, lLeg2, rLeg1, rLeg2)
  c.bones = bones

  // ---- 部件 ----
  const RED = '#a83c22', GREEN = '#2f6b4f', AMBER = '#c8842a', DARK = '#7a2e1a'
  const parts = []

  // 头(小生冠帽侧脸)
  parts.push({
    name: '头', w: 100, h: 120, pivot: { x: 50, y: 108 }, x: 0, y: 140, rotation: 0, z: 5,
    draw: (ctx, w, h) => leather(ctx, AMBER, (c2) => {
      c2.beginPath()
      c2.moveTo(30, h - 6)
      c2.quadraticCurveTo(8, h * 0.45, 30, 26)
      c2.quadraticCurveTo(50, 2, 72, 22)       // 冠
      c2.quadraticCurveTo(96, 40, 82, 66)       // 脸侧
      c2.quadraticCurveTo(76, 82, 60, 88)       // 下颌
      c2.lineTo(58, h - 6)
      c2.closePath()
    }, [[52, 48, 7], [68, 40, 4], [40, 70, 5]]),
  })
  // 身(颈关节在图像顶部,躯干从颈部向下垂)
  parts.push({
    name: '身', w: 130, h: 160, pivot: { x: 65, y: 4 }, x: 0, y: 140, rotation: 0, z: 1,
    draw: (ctx, w, h) => leather(ctx, RED, (c2) => {
      c2.beginPath()
      c2.moveTo(30, 4)
      c2.lineTo(w - 30, 4)
      c2.quadraticCurveTo(w - 8, h * 0.4, w - 22, h - 6)
      c2.lineTo(22, h - 6)
      c2.quadraticCurveTo(8, h * 0.4, 30, 4)
      c2.closePath()
    }, [[65, 40, 9], [45, 80, 6], [85, 80, 6], [65, 115, 8], [50, 140, 4], [80, 140, 4]]),
  })
  // 四肢(上段粗、下段细)
  const limbDefs = [
    { name: '左上臂', color: GREEN, w: 42, h: 84, joint: [0, 120], theta: 210, z: 3 },
    { name: '左前臂', color: GREEN, w: 34, h: 72, joint: [0 + 70 * Math.cos(210 * D), 120 + 70 * Math.sin(210 * D)], theta: 240, z: 3 },
    { name: '右上臂', color: GREEN, w: 42, h: 84, joint: [0, 120], theta: 330, z: 0 },
    { name: '右前臂', color: GREEN, w: 34, h: 72, joint: [70 * Math.cos(330 * D), 120 + 70 * Math.sin(330 * D)], theta: 300, z: 0 },
    { name: '左大腿', color: DARK, w: 46, h: 92, joint: [0, 0], theta: 260, z: 2 },
    { name: '左小腿', color: DARK, w: 36, h: 82, joint: [80 * Math.cos(260 * D), 80 * Math.sin(260 * D)], theta: 270, z: 2 },
    { name: '右大腿', color: DARK, w: 46, h: 92, joint: [0, 0], theta: 280, z: 4 },
    { name: '右小腿', color: DARK, w: 36, h: 82, joint: [80 * Math.cos(280 * D), 80 * Math.sin(280 * D)], theta: 270, z: 4 },
  ]
  for (const L of limbDefs) {
    parts.push({
      name: L.name, w: L.w, h: L.h, pivot: { x: L.w / 2, y: 8 },
      x: L.joint[0], y: L.joint[1], rotation: (L.theta + 90) * D, z: L.z,
      draw: (ctx, w, h) => leather(ctx, L.color, (c2) => limbPath(c2, w, h),
        [[w / 2, h * 0.3, 4], [w / 2, h * 0.55, 3], [w / 2, h * 0.78, 3]]),
    })
  }

  for (const def of parts) {
    const p = createPart({
      name: def.name,
      image: drawPartCanvas(def.w, def.h, def.draw),
      width: def.w, height: def.h,
    })
    p.pivot = def.pivot
    p.x = def.x; p.y = def.y
    p.rotation = def.rotation
    p.zIndex = def.z
    p.segments = 12
    c.parts.push(p)
  }
  c.parts.sort((a, b) => a.zIndex - b.zIndex)
  c.parts.forEach((p, i) => { p.zIndex = i })

  // ---- 自动权重 ----
  const bindWorld = boneWorldTransforms(c.bones, {})
  for (const p of c.parts) {
    const grid = buildGrid(p)
    c.weights[p.id] = computeAutoWeights(c.bones, bindWorld, grid.positions, grid.count, { smoothness: 0.5, pivotX: p.x, pivotY: p.y })
  }

  // ---- 示例动作:挥手(手臂向上举起再摆动) ----
  const clip = createClip('挥手', 1.6)
  const ease = { type: 'easeInOut' }
  clip.tracks[rArm1.id] = [
    { t: 0, v: 0, ease }, { t: 0.4, v: 1.5, ease }, { t: 0.8, v: 1.2, ease },
    { t: 1.2, v: 1.5, ease }, { t: 1.6, v: 0, ease },
  ]
  clip.tracks[rArm2.id] = [
    { t: 0, v: 0, ease }, { t: 0.4, v: 0.5, ease }, { t: 0.8, v: 0.1, ease },
    { t: 1.2, v: 0.5, ease }, { t: 1.6, v: 0, ease },
  ]
  clip.tracks[neck.id] = [
    { t: 0, v: 0, ease }, { t: 0.8, v: 0.15, ease }, { t: 1.6, v: 0, ease },
  ]

  return { character: c, clip }
}
