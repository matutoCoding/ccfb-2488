// ---------- 数据模型工厂 ----------
// 坐标约定:角色空间为 2D 平面,x 向右,y 向上,单位=像素。
// 部件(part)局部空间以关节点(pivot)为原点。

let _uid = 0
export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${(_uid++).toString(36)}`
}

export function createPart({ name, image, width, height }) {
  return {
    id: uid('part'),
    name,                 // 头 / 身 / 臂 / 腿...
    image,                // dataURL
    width, height,        // 贴图像素尺寸
    x: 0, y: 0,           // 在角色空间中的位置(pivot 点坐标)
    rotation: 0,          // 初始摆放角(弧度)
    zIndex: 0,            // 层级
    pivot: { x: width / 2, y: height / 2 }, // 关节点(局部像素坐标,原点在贴图左上,y向下)
    rigid: false,         // true=硬片铰接(完全不形变,最保险); false=柔性蒙皮
    segments: 12,         // 网格细分数(防撕裂关键参数)
  }
}

export function createBone({ name, parentId = null, x = 0, y = 0, rotation = 0, length = 60 }) {
  return {
    id: uid('bone'),
    name,
    parentId,
    x, y,          // 关节点:相对父骨骼原点的位置
    rotation,      // 绑定姿势下的局部旋转(弧度)
    length,        // 骨长(用于自动权重与 IK)
  }
}

export function createCharacter(name) {
  return {
    id: uid('char'),
    name,
    parts: [],
    bones: [],
    // weights[partId] = Array(vtxCount) of [boneIndex1, w1, boneIndex2, w2] (骨骼索引指向 bones 数组下标,-1 表示无)
    weights: {},
  }
}

// 动作片段:tracks 的键为 boneId,特殊键 'root.x' / 'root.y' 表示角色整体位移
export function createClip(name, duration = 2) {
  return {
    id: uid('clip'),
    name,
    duration,                 // 秒
    tracks: {},               // { trackKey: [{ t, v, ease }] } ease: {type:'linear'|'easeIn'|'easeOut'|'easeInOut'|'bezier', x1,y1,x2,y2}
  }
}

export function createProject(name = '未命名皮影工程') {
  return {
    version: 1,
    name,
    characters: [],
    clips: [],
    stage: {
      screen: { width: 1280, height: 720 },
      // 灯在幕布后方,z 为灯到幕布距离,characters 位于灯与幕布之间 depth 处
      light: { x: 0, y: 120, distance: 600, intensity: 1.0, color: '#ffb45e', softness: 0.5 },
      cast: [],   // { id, characterId, clipId, clip2Id, blend, offset, x, y, scale, loop }
    },
    settings: {
      autosave: true,
      translucency: 0.85,   // 皮子透光度
      showRivets: true,     // 关节铆钉(遮接缝,仿古皮影)
      rivetSize: 5,
      fps: 30,
    },
  }
}
