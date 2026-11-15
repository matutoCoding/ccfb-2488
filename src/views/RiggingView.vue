<template>
  <div class="page">
    <div class="panel col side-l">
      <h3>骨骼绑定</h3>
      <div class="row"><label>角色</label>
        <select v-model="store.currentCharacterId" style="flex:1">
          <option v-for="c in store.project.characters" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
      </div>
      <div class="col" style="gap:4px">
        <button :class="{ active: mode === 'select' }" @click="mode = 'select'">选择 / 调骨</button>
        <button :class="{ active: mode === 'add' }" @click="mode = 'add'">加骨骼(点住拖出骨长)</button>
        <button :class="{ active: mode === 'paint' }" @click="mode = 'paint'">刷权重</button>
      </div>
      <template v-if="mode === 'paint'">
        <div class="row"><label>部件</label>
          <select v-model="paintPartId" style="flex:1">
            <option v-for="p in character?.parts" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
        </div>
        <div class="row"><label>笔刷 {{ brushRadius }}px</label>
          <input type="range" min="10" max="120" v-model.number="brushRadius" />
        </div>
        <div class="row"><label>强度</label>
          <input type="range" min="0.05" max="1" step="0.05" v-model.number="brushStrength" />
        </div>
      </template>
      <div class="row"><label>平滑度</label>
        <input type="range" min="0" max="1" step="0.05" v-model.number="smoothness" />
      </div>
      <button class="primary" @click="autoWeightAll">自动权重(全部件)</button>
      <button @click="autoWeightOne" :disabled="!paintPartId">自动权重(当前部件)</button>
      <div class="row"><label>关节铆钉</label><input type="checkbox" v-model="showRivets" /></div>
      <div class="hint">
        红色越亮 = 当前骨骼权重越高。<br>
        硬片铰接的部件在角色库里设置,完全不形变;<br>
        柔性部件靠细分网格 + 平滑权重,大角度不撕裂,接缝由铆钉遮盖。
      </div>
    </div>

    <div class="canvas-wrap" ref="wrapEl">
      <canvas ref="canvasEl" class="gl"
        @pointerdown="onPointerDown" @pointermove="onPointerMove" @pointerup="onPointerUp"
        @wheel.prevent="onWheel"></canvas>
      <div class="brush-cursor" v-if="mode === 'paint' && brushVisible" :style="brushStyle"></div>
    </div>

    <div class="panel col side-r">
      <h3>骨骼列表</h3>
      <div class="scroll col bone-list">
        <div v-for="(b, i) in character?.bones || []" :key="b.id"
          class="bone-item" :class="{ on: i === selectedBoneIndex }" @click="selectBone(i)">
          <span>{{ b.name }}</span>
          <span class="hint">{{ parentName(b) }}</span>
        </div>
        <div v-if="!character?.bones.length" class="hint">还没有骨骼。选「加骨骼」,在画布上点住拖出第一根(躯干),再选中它接着加四肢。</div>
      </div>
      <template v-if="selectedBone">
        <div class="col props">
          <div class="row"><label>名字</label><input v-model="selectedBone.name" @change="store.autosave()" /></div>
          <div class="row"><label>骨长</label>
            <input type="number" v-model.number="selectedBone.length" style="width:80px" @change="boneChanged" />
          </div>
          <div class="row"><label>角度°</label>
            <input type="number" v-model.number="boneRotDeg" style="width:80px" @change="boneChanged" />
          </div>
          <button class="danger" @click="removeBone">删除骨骼(含子骨)</button>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { useProjectStore } from '../store/project.js'
import { EditorRenderer } from '../core/editorRenderer.js'
import { computeAutoWeights, paintWeights, boneWorldTransforms, boneSegment } from '../core/skinning.js'
import { mat3Invert, mat3Apply, distToSegment } from '../core/mat2d.js'

const store = useProjectStore()
const canvasEl = ref(null)
const wrapEl = ref(null)
const mode = ref('select')
const selectedBoneIndex = ref(-1)
const paintPartId = ref(null)
const brushRadius = ref(40)
const brushStrength = ref(0.3)
const smoothness = ref(0.5)
const showRivets = ref(true)
const brushVisible = ref(false)
const brushStyle = ref({})
let renderer = null
let raf = 0

const character = computed(() => store.currentCharacter)
const selectedBone = computed(() => character.value?.bones[selectedBoneIndex.value] || null)
const boneRotDeg = computed({
  get: () => selectedBone.value ? +(selectedBone.value.rotation * 180 / Math.PI).toFixed(1) : 0,
  set: v => { if (selectedBone.value) selectedBone.value.rotation = v * Math.PI / 180 },
})

function parentName(b) {
  const p = character.value?.bones.find(x => x.id === b.parentId)
  return p ? `← ${p.name}` : '根骨'
}

function selectBone(i) {
  selectedBoneIndex.value = i
  updateHeat()
}

function updateHeat() {
  if (!renderer || !character.value) return
  const pid = mode.value === 'paint' ? paintPartId.value : null
  if (pid && selectedBoneIndex.value >= 0) renderer.showWeightHeat(pid, selectedBoneIndex.value)
  else renderer.clearAllHeat()
}

function boneChanged() {
  renderer.updatePose({})
  store.autosave()
}

function removeBone() {
  if (!confirm(`删除骨骼「${selectedBone.value.name}」及其子骨?`)) return
  store.removeBone(character.value, selectedBone.value.id)
  selectedBoneIndex.value = -1
  renderer.updatePose({})
}

function doAutoWeight(part) {
  const entry = renderer.partMeshes.get(part.id)
  if (!entry || !character.value.bones.length) return
  character.value.weights[part.id] = computeAutoWeights(
    character.value.bones,
    boneWorldTransforms(character.value.bones, {}),
    entry.grid.positions, entry.grid.count,
    { rigid: part.rigid, smoothness: smoothness.value, pivotX: part.x, pivotY: part.y }
  )
  renderer.updatePartSkin(part)
}
function autoWeightAll() {
  if (!character.value?.bones.length) { alert('先加骨骼'); return }
  for (const p of character.value.parts) doAutoWeight(p)
  store.autosave(); updateHeat()
}
function autoWeightOne() {
  const p = character.value?.parts.find(x => x.id === paintPartId.value)
  if (p) { doAutoWeight(p); store.autosave(); updateHeat() }
}

// ---------- 交互 ----------
let addDrag = null   // { bone, parentWorld }
let painting = false

function boneAt(wx, wy) {
  const bones = character.value?.bones || []
  if (!bones.length) return -1
  const world = boneWorldTransforms(bones, {})
  let best = -1, bestD = 10
  bones.forEach((b, i) => {
    const s = boneSegment(bones, world, i)
    const d = Math.min(
      distToSegment(wx, wy, s.x1, s.y1, s.x2, s.y2),
      Math.hypot(wx - s.x1, wy - s.y1)
    )
    if (d < bestD) { bestD = d; best = i }
  })
  return best
}

function onPointerDown(e) {
  if (!character.value || !renderer) return
  const w = renderer.toWorld(e.clientX, e.clientY)
  if (mode.value === 'add') {
    const bones = character.value.bones
    const parent = selectedBoneIndex.value >= 0 ? bones[selectedBoneIndex.value] : null
    let lx, ly
    if (parent) {
      const world = boneWorldTransforms(bones, {})
      const inv = mat3Invert(world[selectedBoneIndex.value])
      ;[lx, ly] = mat3Apply(inv, w.x, w.y)
    } else { lx = w.x; ly = w.y }
    const bone = store.addBone(character.value, {
      name: `骨${bones.length + 1}`, parentId: parent?.id ?? null,
      x: lx, y: ly, rotation: 0, length: 1,
    })
    selectedBoneIndex.value = character.value.bones.findIndex(b => b.id === bone.id)
    addDrag = { bone }
    e.target.setPointerCapture(e.pointerId)
    renderer.updatePose({})
  } else if (mode.value === 'select') {
    const i = boneAt(w.x, w.y)
    if (i >= 0) selectBone(i)
  } else if (mode.value === 'paint') {
    painting = true
    paintAt(w.x, w.y)
    e.target.setPointerCapture(e.pointerId)
  }
}

function onPointerMove(e) {
  if (!renderer || !character.value) return
  const w = renderer.toWorld(e.clientX, e.clientY)
  // 笔刷光标
  if (mode.value === 'paint') {
    const rect = canvasEl.value.getBoundingClientRect()
    const px = brushRadius.value / renderer.viewSize * rect.height
    brushStyle.value = {
      left: (e.clientX - rect.left - px) + 'px', top: (e.clientY - rect.top - px) + 'px',
      width: px * 2 + 'px', height: px * 2 + 'px',
    }
    brushVisible.value = true
  }
  if (addDrag) {
    const bones = character.value.bones
    const b = addDrag.bone
    const world = boneWorldTransforms(bones, {})
    const idx = bones.findIndex(x => x.id === b.id)
    const inv = mat3Invert(world[idx])
    // 局部系下拖出的向量(此时 rotation=0,局部系即父系平移)
    const [jx, jy] = mat3Apply(world[idx], 0, 0)
    const ang = Math.atan2(w.y - jy, w.x - jx)
    // 世界角 → 局部角:减去父骨世界角
    const parentWorldRot = b.parentId ? worldRotOf(bones, world, bones.findIndex(x => x.id === b.parentId)) : 0
    b.rotation = ang - parentWorldRot
    b.length = Math.max(10, Math.hypot(w.x - jx, w.y - jy))
    renderer.updatePose({})
  } else if (painting) {
    paintAt(w.x, w.y)
  }
}

function worldRotOf(bones, world, i) {
  // 从世界矩阵提取旋转角
  const m = world[i]
  return Math.atan2(m[1], m[0])
}

function paintAt(wx, wy) {
  const part = character.value.parts.find(p => p.id === paintPartId.value)
  if (!part || selectedBoneIndex.value < 0) return
  const entry = renderer.partMeshes.get(part.id)
  if (!entry) return
  if (!character.value.weights[part.id]) doAutoWeight(part) // 先有个底
  paintWeights(character.value.weights[part.id], entry.grid.positions, entry.grid.count,
    wx, wy, brushRadius.value, selectedBoneIndex.value, brushStrength.value)
  renderer.updatePartSkin(part)
  updateHeat()
}

function onPointerUp() {
  if (addDrag) { addDrag = null; store.autosave() }
  if (painting) { painting = false; store.autosave() }
}

function onWheel(e) {
  renderer.viewSize *= e.deltaY > 0 ? 1.1 : 0.9
  renderer.resize()
}

watch(character, () => nextTick(() => {
  if (!renderer) return
  selectedBoneIndex.value = -1
  if (character.value) { renderer.setCharacter(character.value); renderer.fitToCharacter() }
  else renderer.clearCharacter()
}))
watch(mode, updateHeat)
watch(paintPartId, updateHeat)
watch(showRivets, v => { if (renderer) { renderer.showRivets = v; renderer.updatePose({}) } })

onMounted(() => {
  renderer = new EditorRenderer(canvasEl.value, {})
  const ro = new ResizeObserver(() => renderer.resize())
  ro.observe(wrapEl.value)
  if (character.value) { renderer.setCharacter(character.value); renderer.fitToCharacter() }
  const loop = () => { renderer.render(); raf = requestAnimationFrame(loop) }
  loop()
  onBeforeUnmount(() => { cancelAnimationFrame(raf); ro.disconnect(); renderer.dispose() })
})
</script>

<style scoped>
.page { display: flex; flex: 1; min-height: 0; gap: 10px; padding: 10px; }
.side-l { width: 240px; flex: none; }
.side-r { width: 230px; flex: none; }
.canvas-wrap { flex: 1; min-width: 0; position: relative; border: 1px solid var(--line); border-radius: 10px; overflow: hidden; background: radial-gradient(ellipse at center, #2a2118 0%, #17120d 80%); }
.bone-list { flex: 1; min-height: 100px; }
.bone-item { display: flex; justify-content: space-between; padding: 7px 10px; border-radius: 6px; cursor: pointer; border: 1px solid transparent; }
.bone-item:hover { background: var(--bg3); }
.bone-item.on { border-color: var(--accent2); color: var(--accent2); }
.props { border-top: 1px solid var(--line); padding-top: 10px; }
.props .row { justify-content: space-between; }
.brush-cursor { position: absolute; border: 1.5px solid var(--accent2); border-radius: 50%; pointer-events: none; }
</style>
