// ---------- 两骨 IK(手臂/腿拖动手腕脚踝自动解算肘膝) ----------

// 已知:根骨关节世界位置 (rx,ry),两骨长度 L1 L2,目标点 (tx,ty)(角色空间)
// 返回 { rot1, rot2 } 为两根骨的绝对世界角(弧度)。elbowUp 控制肘/膝朝向。
export function solveTwoBoneIK(rx, ry, L1, L2, tx, ty, elbowUp = true) {
  let dx = tx - rx, dy = ty - ry
  let d = Math.hypot(dx, dy)
  const maxD = (L1 + L2) * 0.999, minD = Math.abs(L1 - L2) * 1.001
  d = Math.max(minD, Math.min(maxD, d))
  const baseAng = Math.atan2(dy, dx)
  const cosA = (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d)
  const a = Math.acos(Math.max(-1, Math.min(1, cosA)))
  const rot1 = elbowUp ? baseAng - a : baseAng + a
  // 末端骨指向目标
  const jx = rx + Math.cos(rot1) * L1
  const jy = ry + Math.sin(rot1) * L1
  const rot2 = Math.atan2(ty - jy, tx - jx)
  return { rot1, rot2 }
}

// 把世界绝对角换算回骨骼局部旋转增量(供写回骨骼)
// parentWorldRot: 父骨在动画状态下的世界绝对角;bindRot: 该骨绑定姿势下的世界绝对角
export function worldToLocalDelta(worldAngle, parentWorldRot, bindWorldRot) {
  return worldAngle - parentWorldRot - bindWorldRot
}
