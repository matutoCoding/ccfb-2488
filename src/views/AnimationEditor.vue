<template>
  <div class="page">
    <!-- 顶栏 -->
    <div class="panel row topbar">
      <label>角色</label>
      <select v-model="store.currentCharacterId">
        <option v-for="c in store.project.characters" :key="c.id" :value="c.id">{{ c.name }}</option>
      </select>
      <label>动作片段</label>
      <select v-model="store.currentClipId">
        <option v-for="c in store.project.clips" :key="c.id" :value="c.id">{{ c.name }}</option>
      </select>
      <button class="primary" @click="newClip">新建片段</button>
      <button class="danger" @click="removeClip" :disabled="!clip">删片段</button>
      <template v-if="clip">
        <label>时长s</label>
        <input type="number" v-model.number="clip.duration" min="0.5" step="0.5" style="width:60px" @change="store.autosave()" />
        <button @click="togglePlay">{{ playing ? '⏸ 停' : '▶ 演' }}</button>
        <span class="hint">{{ time.toFixed(2) }}s</span>
      </template>
    </div>

    <div class="mid">
      <!-- 画布 -->
      <div class="canvas-wrap" ref="wrapEl">
        <canvas ref="canvasEl" class="gl"
          @pointerdown="onPointerDown" @pointermove="onPointerMove" @pointerup="onPointerUp"
          @wheel.prevent="onWheel"></canvas>
        <div class="toolbar row">
          <button :class="{ active: manipMode === 'pose' }" @click="manipMode = 'pose'">旋转骨(FK)</button>
          <button :class="{ active: manipMode === 'ik' }" @click="manipMode = 'ik'">IK 拖末端</button>
          <button :class="{ active: manipMode === 'root' }" @click="manipMode = 'root'">整体移动</button>
          <button @click="keyAllBones" :disabled="!clip">K 全部骨</button>
          <span class="hint">拖动即自动在当前帧打关键帧</span>
        </div>
      </div>

      <!-- 右侧:缓动 + 混合 -->
      <div class="panel col side-r scroll">
        <h3>缓动曲线</h3>
        <template v-if="selectedKey">
          <div class="row"><label>类型</label>
            <select v-model="selectedKey.ease.type" @change="easeChanged">
              <option value="linear">线性</option>
              <option value="easeIn">缓入</option>
              <option value="easeOut">缓出</option>
              <option value="easeInOut">缓入出</option>
              <option value="bezier">自定义贝塞尔</option>
            </select>
          </div>
          <template v-if="selectedKey.ease.type === 'bezier'">
            <canvas ref="bezierCanvas" width="200" height="140" class="bezier-cv"
              @pointerdown="bezDown" @pointermove="bezMove" @pointerup="bezUp"></canvas>
            <div class="hint">拖动两个手柄调曲线</div>
          </template>
          <button class="danger" @click="deleteSelectedKey">删除此帧</button>
        </template>
        <div v-else class="hint">在时间线上点选一个关键帧(菱形)可调它的缓动。</div>

        <h3 style="margin-top:14px">动作混合</h3>
        <div class="row"><label>动作A</label>
          <select v-model="blendA"><option v-for="c in store.project.clips" :key="c.id" :value="c.id">{{ c.name }}</option></select>
        </div>
        <div class="row"><label>动作B</label>
          <select v-model="blendB"><option v-for="c in store.project.clips" :key="c.id" :value="c.id">{{ c.name }}</option></select>
        </div>
        <div class="row"><label>混合 {{ blendAlpha.toFixed(2) }}</label>
          <input type="range" min="0" max="1" step="0.01" v-model.number="blendAlpha" />
        </div>
        <button :class="{ active: blendPreview }" @click="blendPreview = !blendPreview" :disabled="!blendA || !blendB">
          {{ blendPreview ? '停止预览' : '预览混合' }}
        </button>
        <button class="primary" @click="bakeBlendClip" :disabled="!blendA || !blendB">烘焙为新片段</button>
        <div class="hint">0 = 纯动作A,1 = 纯动作B。烘焙后可在舞台复用。</div>
      </div>
    </div>

    <!-- 时间线 -->
    <div class="panel timeline" v-if="clip">
      <div class="ruler" ref="rulerEl" @pointerdown="scrubStart">
        <div class="playhead" :style="{ left: playheadX + 'px' }"></div>
        <span v-for="s in rulerTicks" :key="s" class="tick" :style="{ left: s * pxPerSec + 'px' }">{{ s }}s</span>
      </div>
      <div class="tracks scroll">
        <div v-for="tr in trackList" :key="tr.key" class="track-row">
          <div class="track-name" :title="tr.key">{{ tr.label }}</div>
          <div class="track-lane" @pointerdown="scrubStart">
            <div v-for="(k, ki) in clip.tracks[tr.key] || []" :key="ki"
              class="key" :class="{ on: isKeySelected(tr.key, k) }"
              :style="{ left: k.t * pxPerSec - 5 + 'px' }"
              @pointerdown.stop="keyDown($event, tr.key, k)"></div>
          </div>
        </div>
      </div>
    </div>
    <div v-else class="panel hint" style="margin:10px">先「新建片段」再摆动作。每个片段就是一段可复用的动作,舞台上直接挂。</div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { useProjectStore } from '../store/project.js'
import { EditorRenderer } from '../core/editorRenderer.js'
import { boneWorldTransforms, boneSegment } from '../core/skinning.js'
import { solveTwoBoneIK } from '../core/ik.js'
import { sampleClip, blendClipsAngular, bakeBlend, defaultEase } from '../core/animation.js'
import { createClip } from '../core/model.js'
import { distToSegment } from '../core/mat2d.js'

const store = useProjectStore()
const canvasEl = ref(null)
const wrapEl = ref(null)
const rulerEl = ref(null)
const bezierCanvas = ref(null)
const manipMode = ref('pose')
const playing = ref(false)
const time = ref(0)
const pxPerSec = 100
const blendA = ref(null)
const blendB = ref(null)
const blendAlpha = ref(0.5)
const blendPreview = ref(false)
const selectedKeyRef = ref(null) // { trackKey, key }
let renderer = null
let raf = 0
let lastTs = 0

const character = computed(() => store.currentCharacter)
const clip = computed(() => store.currentClip)
const selectedKey = computed(() => selectedKeyRef.value?.key || null)

const trackList = computed(() => {
  if (!character.value || !clip.value) return []
  const list = character.value.bones.map(b => ({ key: b.id, label: `🦴 ${b.name}` }))
  list.push({ key: 'root.x', label: '↔ 整体X' }, { key: 'root.y', label: '↕ 整体Y' })
  return list
})
const playheadX = computed(() => time.value * pxPerSec)
const rulerTicks = computed(() => {
  const d = clip.value?.duration || 2
  const ticks = []
  for (let s = 0; s <= Math.ceil(d); s++) ticks.push(s)
  return ticks
})

// ---------- 片段 ----------
function newClip() {
  const c = store.newClip()
  blendA.value = blendA.value || c.id
}
function removeClip() {
  if (clip.value && confirm(`删除动作「${clip.value.name}」?`)) store.removeClip(clip.value.id)
}

// ---------- 姿态 ----------
const currentPose = computed(() => {
  if (blendPreview.value && blendA.value && blendB.value) {
    const a = store.clipById(blendA.value), b = store.clipById(blendB.value)
    return blendClipsAngular(a, b, time.value, blendAlpha.value)
  }
  return clip.value ? sampleClip(clip.value, time.value) : {}
})

function applyPose() {
  if (!renderer || !character.value) return
  const pose = currentPose.value
  const extraRot = {}
  for (const b of character.value.bones) if (pose[b.id] != null) extraRot[b.id] = pose[b.id]
  renderer.updatePose(extraRot, { x: pose['root.x'] || 0, y: pose['root.y'] || 0 })
}

// ---------- 关键帧 ----------
function setKey(trackKey, t, v) {
  if (!clip.value) return
  const tracks = clip.value.tracks
  if (!tracks[trackKey]) tracks[trackKey] = []
  const keys = tracks[trackKey]
  const hit = keys.find(k => Math.abs(k.t - t) < 0.03)
  if (hit) hit.v = v
  else {
    keys.push({ t, v, ease: defaultEase() })
    keys.sort((a, b) => a.t - b.t)
  }
}
function keyAllBones() {
  if (!character.value || !clip.value) return
  const pose = currentPose.value
  for (const b of character.value.bones) setKey(b.id, time.value, pose[b.id] || 0)
  setKey('root.x', time.value, pose['root.x'] || 0)
  setKey('root.y', time.value, pose['root.y'] || 0)
  store.autosave()
}
function isKeySelected(trackKey, k) {
  return selectedKeyRef.value?.trackKey === trackKey && selectedKeyRef.value?.key === k
}
function deleteSelectedKey() {
  const sel = selectedKeyRef.value
  if (!sel || !clip.value) return
  const keys = clip.value.tracks[sel.trackKey]
  const i = keys.indexOf(sel.key)
  if (i >= 0) keys.splice(i, 1)
  selectedKeyRef.value = null
  store.autosave()
}
function easeChanged() { store.autosave(); drawBezier() }

// ---------- 时间线交互 ----------
let keyDrag = null
function keyDown(e, trackKey, k) {
  selectedKeyRef.value = { trackKey, key: k }
  keyDrag = { trackKey, key: k, startX: e.clientX, origT: k.t }
  const move = (ev) => {
    const dt = (ev.clientX - keyDrag.startX) / pxPerSec
    k.t = Math.max(0, Math.min(clip.value.duration, +(keyDrag.origT + dt).toFixed(3)))
  }
  const up = () => {
    clip.value.tracks[trackKey].sort((a, b) => a.t - b.t)
    store.autosave()
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  nextTick(drawBezier)
}
let scrubbing = false
function scrubStart(e) {
  scrubbing = true
  scrubTo(e)
  const move = (ev) => scrubTo(ev)
  const up = () => { scrubbing = false; window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}
function scrubTo(e) {
  const lane = e.currentTarget?.classList?.contains('track-lane') ? e.currentTarget : rulerEl.value
  const rect = (lane || rulerEl.value).getBoundingClientRect()
  time.value = Math.max(0, Math.min(clip.value?.duration || 0, (e.clientX - rect.left) / pxPerSec))
}

// ---------- 画布操纵 ----------
let manip = null
function onPointerDown(e) {
  if (!character.value || !renderer || !clip.value || blendPreview.value) return
  const w = renderer.toWorld(e.clientX, e.clientY)
  const pose = currentPose.value
  const ox = pose['root.x'] || 0, oy = pose['root.y'] || 0
  const wx = w.x - ox, wy = w.y - oy
  const bones = character.value.bones
  const extraRot = {}
  for (const b of bones) if (pose[b.id] != null) extraRot[b.id] = pose[b.id]
  const world = boneWorldTransforms(bones, extraRot)

  if (manipMode.value === 'root') {
    manip = { type: 'root', startWX: w.x, startWY: w.y, origX: ox, origY: oy }
  } else if (manipMode.value === 'pose') {
    // 选最近的骨
    let best = -1, bestD = 14
    bones.forEach((b, i) => {
      const s = boneSegment(bones, world, i)
      const d = distToSegment(wx, wy, s.x1, s.y1, s.x2, s.y2)
      if (d < bestD) { bestD = d; best = i }
    })
    if (best < 0) return
    const s = boneSegment(bones, world, best)
    manip = {
      type: 'fk', boneIndex: best, jx: s.x1, jy: s.y1,
      startAng: Math.atan2(wy - s.y1, wx - s.x1),
      origRot: extraRot[bones[best].id] || 0,
    }
  } else if (manipMode.value === 'ik') {
    // 找最近的骨末端作为末端执行器,要求它有父骨(两骨链)
    let best = -1, bestD = 30
    bones.forEach((b, i) => {
      if (!b.parentId) return
      const s = boneSegment(bones, world, i)
      const d = Math.hypot(wx - s.x2, wy - s.y2)
      if (d < bestD) { bestD = d; best = i }
    })
    if (best < 0) { return }
    const b2 = bones[best]
    const i1 = bones.findIndex(b => b.id === b2.parentId)
    if (i1 < 0) return
    const s1 = boneSegment(bones, world, i1)
    manip = {
      type: 'ik', i1, i2: best,
      rx: s1.x1, ry: s1.y1, L1: bones[i1].length, L2: b2.length,
    }
  }
  if (manip) e.target.setPointerCapture(e.pointerId)
}

function onPointerMove(e) {
  if (!manip || !renderer || !character.value) return
  const w = renderer.toWorld(e.clientX, e.clientY)
  const pose = currentPose.value
  const bones = character.value.bones
  if (manip.type === 'root') {
    setKey('root.x', time.value, manip.origX + (w.x - manip.startWX))
    setKey('root.y', time.value, manip.origY + (w.y - manip.startWY))
  } else if (manip.type === 'fk') {
    const ox = pose['root.x'] || 0, oy = pose['root.y'] || 0
    const ang = Math.atan2(w.y - oy - manip.jy, w.x - ox - manip.jx)
    let delta = ang - manip.startAng
    const b = bones[manip.boneIndex]
    setKey(b.id, time.value, manip.origRot + delta)
  } else if (manip.type === 'ik') {
    const ox = pose['root.x'] || 0, oy = pose['root.y'] || 0
    const tx = w.x - ox, ty = w.y - oy
    const b1 = bones[manip.i1], b2 = bones[manip.i2]
    // 当前世界角(用于选肘向 & 换算局部增量)
    const extraRot = {}
    for (const b of bones) if (pose[b.id] != null) extraRot[b.id] = pose[b.id]
    const world = boneWorldTransforms(bones, extraRot)
    const curW1 = Math.atan2(world[manip.i1][1], world[manip.i1][0])
    // 两种肘向都解,取离当前姿态近的
    const solA = solveTwoBoneIK(manip.rx, manip.ry, manip.L1, manip.L2, tx, ty, true)
    const solB = solveTwoBoneIK(manip.rx, manip.ry, manip.L1, manip.L2, tx, ty, false)
    const dA = Math.abs(normAng(solA.rot1 - curW1)), dB = Math.abs(normAng(solB.rot1 - curW1))
    const sol = dA <= dB ? solA : solB
    // 世界角 → 局部增量:extraRot = 世界角 - 父世界角 - 绑定局部角
    const parentIdx = bones.findIndex(b => b.id === b1.parentId)
    const parentW = parentIdx >= 0 ? Math.atan2(world[parentIdx][1], world[parentIdx][0]) : 0
    setKey(b1.id, time.value, sol.rot1 - parentW - b1.rotation)
    setKey(b2.id, time.value, sol.rot2 - sol.rot1 - b2.rotation)
  }
  applyPose()
}
function normAng(a) {
  while (a > Math.PI) a -= Math.PI * 2
  while (a < -Math.PI) a += Math.PI * 2
  return a
}

function onPointerUp() {
  if (manip) { manip = null; store.autosave() }
}

function onWheel(e) {
  renderer.viewSize *= e.deltaY > 0 ? 1.1 : 0.9
  renderer.resize()
}

// ---------- 贝塞尔手柄 ----------
let bezDrag = null
function drawBezier() {
  const cv = bezierCanvas.value
  if (!cv || !selectedKey.value || selectedKey.value.ease.type !== 'bezier') return
  const ctx = cv.getContext('2d')
  const e = selectedKey.value.ease
  const W = cv.width, H = cv.height
  ctx.clearRect(0, 0, W, H)
  ctx.strokeStyle = '#3d3226'; ctx.strokeRect(0.5, 0.5, W - 1, H - 1)
  const px = (x) => x * W, py = (y) => H - y * H
  ctx.strokeStyle = '#a89880'
  ctx.beginPath(); ctx.moveTo(px(0), py(0)); ctx.lineTo(px(e.x1 ?? 0.4), py(e.y1 ?? 0)); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(px(1), py(1)); ctx.lineTo(px(e.x2 ?? 0.6), py(e.y2 ?? 1)); ctx.stroke()
  ctx.strokeStyle = '#ffb45e'; ctx.lineWidth = 2
  ctx.beginPath(); ctx.moveTo(px(0), py(0))
  ctx.bezierCurveTo(px(e.x1 ?? 0.4), py(e.y1 ?? 0), px(e.x2 ?? 0.6), py(e.y2 ?? 1), px(1), py(1))
  ctx.stroke()
  ctx.lineWidth = 1
  ctx.fillStyle = '#d94f2b'
  for (const [x, y] of [[e.x1 ?? 0.4, e.y1 ?? 0], [e.x2 ?? 0.6, e.y2 ?? 1]]) {
    ctx.beginPath(); ctx.arc(px(x), py(y), 6, 0, Math.PI * 2); ctx.fill()
  }
}
function bezDown(e) {
  const ez = selectedKey.value?.ease
  if (!ez) return
  const rect = bezierCanvas.value.getBoundingClientRect()
  const mx = (e.clientX - rect.left) / rect.width, my = 1 - (e.clientY - rect.top) / rect.height
  const d1 = Math.hypot(mx - (ez.x1 ?? 0.4), my - (ez.y1 ?? 0))
  const d2 = Math.hypot(mx - (ez.x2 ?? 0.6), my - (ez.y2 ?? 1))
  bezDrag = d1 < d2 ? 'p1' : 'p2'
  e.target.setPointerCapture(e.pointerId)
}
function bezMove(e) {
  if (!bezDrag || !selectedKey.value) return
  const rect = bezierCanvas.value.getBoundingClientRect()
  const mx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  const my = 1 - (e.clientY - rect.top) / rect.height
  const ez = selectedKey.value.ease
  if (bezDrag === 'p1') { ez.x1 = +mx.toFixed(3); ez.y1 = +my.toFixed(3) }
  else { ez.x2 = +mx.toFixed(3); ez.y2 = +my.toFixed(3) }
  drawBezier()
}
function bezUp() { if (bezDrag) { bezDrag = null; store.autosave() } }

// ---------- 混合 ----------
function bakeBlendClip() {
  const a = store.clipById(blendA.value), b = store.clipById(blendB.value)
  if (!a || !b) return
  const nc = createClip(`${a.name}+${b.name}`)
  bakeBlend(a, b, blendAlpha.value, store.project.settings.fps, nc)
  store.saveClip(nc)
  blendPreview.value = false
}

// ---------- 播放 ----------
function togglePlay() { playing.value = !playing.value }

watch(character, () => nextTick(() => {
  if (!renderer) return
  if (character.value) { renderer.setCharacter(character.value); renderer.fitToCharacter() }
  else renderer.clearCharacter()
}))
watch(clip, () => { time.value = 0; selectedKeyRef.value = null })
watch(selectedKey, () => nextTick(drawBezier))

onMounted(() => {
  renderer = new EditorRenderer(canvasEl.value, { showRivets: store.project.settings.showRivets })
  const ro = new ResizeObserver(() => renderer.resize())
  ro.observe(wrapEl.value)
  if (character.value) { renderer.setCharacter(character.value); renderer.fitToCharacter() }
  const loop = (ts) => {
    const dt = lastTs ? (ts - lastTs) / 1000 : 0
    lastTs = ts
    if (playing.value && (clip.value || blendPreview.value)) {
      const dur = blendPreview.value
        ? Math.max(store.clipById(blendA.value)?.duration || 1, store.clipById(blendB.value)?.duration || 1)
        : clip.value.duration
      time.value = (time.value + dt) % dur
    }
    applyPose()
    renderer.render()
    raf = requestAnimationFrame(loop)
  }
  loop()
  onBeforeUnmount(() => { cancelAnimationFrame(raf); ro.disconnect(); renderer.dispose() })
})
</script>

<style scoped>
.page { display: flex; flex-direction: column; flex: 1; min-height: 0; gap: 10px; padding: 10px; }
.topbar { flex: none; flex-wrap: wrap; }
.mid { flex: 1; min-height: 0; display: flex; gap: 10px; }
.canvas-wrap { flex: 1; min-width: 0; position: relative; border: 1px solid var(--line); border-radius: 10px; overflow: hidden; background: radial-gradient(ellipse at center, #2a2118 0%, #17120d 80%); }
.toolbar { position: absolute; top: 10px; left: 10px; right: 10px; pointer-events: none; flex-wrap: wrap; }
.toolbar > * { pointer-events: auto; }
.side-r { width: 250px; flex: none; }
.bezier-cv { background: var(--bg); border-radius: 6px; cursor: crosshair; width: 100%; }
.timeline { flex: none; height: 190px; display: flex; flex-direction: column; padding: 8px; }
.ruler { position: relative; height: 22px; border-bottom: 1px solid var(--line); cursor: ew-resize; margin-left: 110px; }
.tick { position: absolute; top: 2px; font-size: 10px; color: var(--fg-dim); border-left: 1px solid var(--line); padding-left: 3px; }
.playhead { position: absolute; top: 0; bottom: -160px; width: 2px; background: var(--accent); z-index: 5; pointer-events: none; }
.tracks { flex: 1; min-height: 0; }
.track-row { display: flex; height: 26px; align-items: center; }
.track-name { width: 110px; flex: none; font-size: 12px; color: var(--fg-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.track-lane { flex: 1; height: 100%; position: relative; border-bottom: 1px solid #2a2118; cursor: ew-resize; }
.key {
  position: absolute; top: 7px; width: 11px; height: 11px; background: var(--accent2);
  transform: rotate(45deg); cursor: ew-resize; border-radius: 2px;
}
.key.on { background: var(--accent); box-shadow: 0 0 6px var(--accent); }
</style>
