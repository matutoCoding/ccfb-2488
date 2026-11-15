// ---------- 编辑器渲染器(角色库/绑定/动画三个页面共用) ----------
// Three.js(WebGL)正交相机 2D 场景:部件网格 + 骨骼线 + 关节铆钉 + 权重热力图。

import * as THREE from 'three'
import { buildGrid, boneWorldTransforms, skinPositions, boneSegment } from './skinning.js'
import { mat3Apply } from './mat2d.js'

export class EditorRenderer {
  constructor(canvas, opts = {}) {
    this.canvas = canvas
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.scene = new THREE.Scene()
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -100, 100)
    this.viewSize = 600      // 视野高度(世界单位)
    this.camX = 0; this.camY = 0
    this.character = null
    this.partMeshes = new Map()   // partId -> { mesh, grid, skinned }
    this.boneGroup = new THREE.Group()
    this.rivetGroup = new THREE.Group()
    this.scene.add(this.boneGroup, this.rivetGroup)
    this.showBones = true
    this.showRivets = opts.showRivets ?? true
    this.rivetSize = opts.rivetSize ?? 5
    this.heatPartId = null        // 权重热力图目标部件
    this.heatBoneIndex = -1
    this.extraRot = {}
    this.rootOffset = { x: 0, y: 0 }
    this._texLoader = new THREE.TextureLoader()
  }

  setCharacter(character) {
    this.clearCharacter()
    this.character = character
    for (const part of character.parts) this.addPartMesh(part)
    this.sortLayers()
    this.updatePose({})
  }

  clearCharacter() {
    for (const { mesh } of this.partMeshes.values()) {
      this.scene.remove(mesh)
      mesh.geometry.dispose()
      mesh.material.map?.dispose()
      mesh.material.dispose()
    }
    this.partMeshes.clear()
    this.character = null
  }

  addPartMesh(part) {
    const grid = buildGrid(part)
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(grid.count * 3), 3))
    geo.setAttribute('uv', new THREE.BufferAttribute(grid.uvs, 2))
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(grid.count * 3).fill(1), 3))
    geo.setIndex(grid.indices)
    const tex = this._texLoader.load(part.image)
    tex.colorSpace = THREE.SRGBColorSpace
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, side: THREE.DoubleSide,
      vertexColors: true, depthTest: false,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.renderOrder = part.zIndex
    mesh.userData.partId = part.id
    this.scene.add(mesh)
    const entry = { mesh, grid, skinned: new Float32Array(grid.positions.length) }
    this.partMeshes.set(part.id, entry)
    this.updatePartSkin(part, entry)
  }

  rebuildPartMesh(part) { // 细分数等变化后重建
    const old = this.partMeshes.get(part.id)
    if (old) {
      this.scene.remove(old.mesh)
      old.mesh.geometry.dispose()
      old.mesh.material.map?.dispose()
      old.mesh.material.dispose()
      this.partMeshes.delete(part.id)
    }
    this.addPartMesh(part)
    this.sortLayers()
    this.updatePose(this.extraRot)
  }

  sortLayers() {
    if (!this.character) return
    for (const part of this.character.parts) {
      const e = this.partMeshes.get(part.id)
      if (e) e.mesh.renderOrder = part.zIndex
    }
  }

  updatePartSkin(part, entry) {
    entry = entry || this.partMeshes.get(part.id)
    if (!entry) return
    const weights = this.character.weights[part.id]
    const bindWorld = boneWorldTransforms(this.character.bones, {})
    const animWorld = boneWorldTransforms(this.character.bones, this.extraRot)
    const skinned = weights
      ? skinPositions(entry.grid.positions, entry.grid.count, weights, bindWorld, animWorld)
      : entry.grid.positions
    entry.skinned = skinned
    const pos = entry.mesh.geometry.attributes.position
    for (let v = 0; v < entry.grid.count; v++) {
      pos.setXYZ(v, skinned[v * 2] + this.rootOffset.x, skinned[v * 2 + 1] + this.rootOffset.y, 0)
    }
    pos.needsUpdate = true
    entry.mesh.geometry.computeBoundingSphere()
    if (this.heatPartId === part.id) this.applyHeatmap(part)
  }

  // 当前姿态下整体更新
  updatePose(extraRot, rootOffset) {
    this.extraRot = extraRot || {}
    if (rootOffset) this.rootOffset = rootOffset
    if (!this.character) return
    for (const part of this.character.parts) this.updatePartSkin(part)
    this.updateBoneOverlay()
  }

  // ---------- 骨骼线 + 铆钉 ----------
  updateBoneOverlay() {
    this.boneGroup.clear()
    this.rivetGroup.clear()
    if (!this.character) return
    const bones = this.character.bones
    const animWorld = boneWorldTransforms(bones, this.extraRot)
    const ox = this.rootOffset.x, oy = this.rootOffset.y
    if (this.showBones) {
      bones.forEach((b, i) => {
        const s = boneSegment(bones, animWorld, i)
        const pts = [new THREE.Vector3(s.x1 + ox, s.y1 + oy, 1), new THREE.Vector3(s.x2 + ox, s.y2 + oy, 1)]
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(pts),
          new THREE.LineBasicMaterial({ color: 0x36c5f0, depthTest: false })
        )
        line.renderOrder = 999
        line.userData.boneIndex = i
        this.boneGroup.add(line)
        const joint = new THREE.Mesh(
          new THREE.CircleGeometry(4, 20),
          new THREE.MeshBasicMaterial({ color: 0xffd166, depthTest: false })
        )
        joint.position.set(s.x1 + ox, s.y1 + oy, 1)
        joint.renderOrder = 1000
        joint.userData.boneIndex = i
        this.boneGroup.add(joint)
      })
    }
    if (this.showRivets) {
      bones.forEach((b, i) => {
        const [jx, jy] = mat3Apply(animWorld[i], 0, 0)
        const rivet = new THREE.Mesh(
          new THREE.CircleGeometry(this.rivetSize, 24),
          new THREE.MeshBasicMaterial({ color: 0x5a2d18, transparent: true, opacity: 0.92, depthTest: false })
        )
        rivet.position.set(jx + ox, jy + oy, 0.5)
        rivet.renderOrder = 500 // 盖在皮片上遮住接缝
        this.rivetGroup.add(rivet)
        const dot = new THREE.Mesh(
          new THREE.CircleGeometry(this.rivetSize * 0.4, 16),
          new THREE.MeshBasicMaterial({ color: 0xd9a05b, depthTest: false })
        )
        dot.position.set(jx + ox, jy + oy, 0.6)
        dot.renderOrder = 501
        this.rivetGroup.add(dot)
      })
    }
  }

  // ---------- 权重热力图 ----------
  showWeightHeat(partId, boneIndex) {
    this.heatPartId = partId
    this.heatBoneIndex = boneIndex
    if (!this.character) return
    for (const part of this.character.parts) {
      const entry = this.partMeshes.get(part.id)
      if (!entry) continue
      if (part.id === partId) this.applyHeatmap(part)
      else this.clearHeatmap(part)
    }
  }

  applyHeatmap(part) {
    const entry = this.partMeshes.get(part.id)
    const weights = this.character.weights[part.id]
    const colAttr = entry.mesh.geometry.attributes.color
    for (let v = 0; v < entry.grid.count; v++) {
      let w = 0
      const rec = weights?.[v]
      if (rec) {
        if (rec[0] === this.heatBoneIndex) w += rec[1]
        if (rec[2] === this.heatBoneIndex) w += rec[3]
      }
      // 红=权重高,蓝=权重低,与贴图混色
      colAttr.setXYZ(v, 1, 1 - w * 0.85, 1 - w * 0.6)
    }
    colAttr.needsUpdate = true
  }

  clearHeatmap(part) {
    const entry = this.partMeshes.get(part.id)
    if (!entry) return
    const colAttr = entry.mesh.geometry.attributes.color
    for (let v = 0; v < entry.grid.count; v++) colAttr.setXYZ(v, 1, 1, 1)
    colAttr.needsUpdate = true
  }

  clearAllHeat() {
    this.heatPartId = null
    if (!this.character) return
    for (const part of this.character.parts) this.clearHeatmap(part)
  }

  // ---------- 坐标换算 ----------
  resize() {
    const w = this.canvas.clientWidth || 1, h = this.canvas.clientHeight || 1
    this.renderer.setSize(w, h, false)
    const halfH = this.viewSize / 2
    const halfW = halfH * (w / h)
    this.camera.left = this.camX - halfW
    this.camera.right = this.camX + halfW
    this.camera.top = this.camY + halfH
    this.camera.bottom = this.camY - halfH
    this.camera.updateProjectionMatrix()
  }

  toWorld(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect()
    const nx = (clientX - rect.left) / rect.width
    const ny = (clientY - rect.top) / rect.height
    return {
      x: this.camera.left + nx * (this.camera.right - this.camera.left),
      y: this.camera.top - ny * (this.camera.top - this.camera.bottom),
    }
  }

  fitToCharacter(margin = 1.4) {
    if (!this.character || this.character.parts.length === 0) { this.resize(); return }
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9
    for (const part of this.character.parts) {
      const hw = Math.max(part.width, part.height)
      minX = Math.min(minX, part.x - hw); maxX = Math.max(maxX, part.x + hw)
      minY = Math.min(minY, part.y - hw); maxY = Math.max(maxY, part.y + hw)
    }
    this.camX = (minX + maxX) / 2
    this.camY = (minY + maxY) / 2
    this.viewSize = Math.max(maxY - minY, (maxX - minX) * 0.6, 200) * margin
    this.resize()
  }

  render() { this.renderer.render(this.scene, this.camera) }

  dispose() {
    this.clearCharacter()
    this.renderer.dispose()
  }
}
