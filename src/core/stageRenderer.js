// ---------- 演出舞台渲染器 ----------
// 物理布局(侧视): 灯(z=-L) → 影人(z=-p) → 幕布(z=0) → 观众
// 影子:把影人顶点从灯的位置透视投影到幕布上,再按灯距做高斯模糊 ——
//   灯越近:影子越大、越虚;灯越远:影子越小、越实。
// 皮质感:自定义 shader,灯光颜色透过半透明皮子,叠加幕布纸纹与光晕。

import * as THREE from 'three'
import { buildGrid, boneWorldTransforms, skinPositions } from './skinning.js'
import { sampleClip, blendClipsAngular } from './animation.js'

const PUPPET_DEPTH = 80 // 影人到幕布的距离(世界单位)

const LEATHER_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`

const LEATHER_FRAG = `
uniform sampler2D map;
uniform vec3 lightColor;
uniform float translucency;
uniform float glow;
varying vec2 vUv;
void main() {
  vec4 tex = texture2D(map, vUv);
  if (tex.a < 0.02) discard;
  // 灯光透染:皮子颜色被背后灯光点亮,透光发亮
  vec3 col = tex.rgb * lightColor * (0.9 + glow * 0.7);
  col += lightColor * 0.12 * glow;
  gl_FragColor = vec4(col, tex.a * translucency);
}`

const PAPER_FRAG = `
uniform vec3 lightColor;
uniform vec2 lightPos;     // 灯在幕布上的投影点(幕布局部像素)
uniform vec2 screenSize;
uniform float intensity;
varying vec2 vUv;
// 简易纸纹噪声
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x),
             mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
}
void main() {
  vec2 px = vUv * screenSize;
  float n = noise(px * 0.08) * 0.5 + noise(px * 0.3) * 0.3 + noise(px * 1.2) * 0.2;
  vec3 paper = vec3(0.96, 0.90, 0.78) * (0.92 + n * 0.12);
  // 灯光在幕布上的光晕
  float d = distance(px, lightPos) / (screenSize.x * 0.6);
  float halo = exp(-d * d * 2.2) * intensity;
  vec3 col = paper * (0.55 + 0.45 * intensity) + lightColor * halo * 0.5;
  gl_FragColor = vec4(col, 0.94); // 幕布微透,后面的影人能显出来
}`

const BLUR_FRAG = `
uniform sampler2D tex;
uniform vec2 dir;      // (1/w,0) 或 (0,1/h)
uniform float radius;
varying vec2 vUv;
void main() {
  vec4 sum = vec4(0.0);
  float w[5]; w[0]=0.227; w[1]=0.194; w[2]=0.121; w[3]=0.054; w[4]=0.016;
  sum += texture2D(tex, vUv) * w[0];
  for (int i = 1; i < 5; i++) {
    vec2 off = dir * float(i) * radius;
    sum += texture2D(tex, vUv + off) * w[i];
    sum += texture2D(tex, vUv - off) * w[i];
  }
  gl_FragColor = sum;
}`

const QUAD_VERT = `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`

export class StageRenderer {
  constructor(canvas) {
    this.canvas = canvas
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.autoClear = false

    this.scene = new THREE.Scene()
    this.camera = new THREE.OrthographicCamera(-640, 360, 640, -360, -1000, 100)

    // 幕布
    this.paperMat = new THREE.ShaderMaterial({
      vertexShader: LEATHER_VERT, fragmentShader: PAPER_FRAG, transparent: true, depthTest: false,
      uniforms: {
        lightColor: { value: new THREE.Color('#ffb45e') },
        lightPos: { value: new THREE.Vector2(640, 480) },
        screenSize: { value: new THREE.Vector2(1280, 720) },
        intensity: { value: 1 },
      },
    })
    this.screenMesh = new THREE.Mesh(new THREE.PlaneGeometry(1280, 720), this.paperMat)
    this.screenMesh.renderOrder = 0
    this.scene.add(this.screenMesh)

    // 影子合成面(贴在幕布上)
    this.shadowMat = new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, opacity: 0.85 })
    this.shadowQuad = new THREE.Mesh(new THREE.PlaneGeometry(1280, 720), this.shadowMat)
    this.shadowQuad.position.z = 0.1
    this.shadowQuad.renderOrder = 1
    this.scene.add(this.shadowQuad)

    // 影子离屏渲染:RT_A → 模糊 → RT_B
    this.rtA = new THREE.WebGLRenderTarget(1280, 720)
    this.rtB = new THREE.WebGLRenderTarget(1280, 720)
    this.shadowScene = new THREE.Scene()
    this.blurMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT, fragmentShader: BLUR_FRAG, depthTest: false,
      uniforms: { tex: { value: null }, dir: { value: new THREE.Vector2(1 / 1280, 0) }, radius: { value: 1.5 } },
    })
    this.blurQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blurMat)
    this.blurScene = new THREE.Scene()
    this.blurScene.add(this.blurQuad)
    this.blurCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

    this.members = new Map() // castId -> { group, parts: Map(partId -> {mesh, grid}), shadows: Map(partId -> {mesh, grid}) }
    this.light = { x: 0, y: 120, distance: 600, intensity: 1, color: '#ffb45e', softness: 0.5 }
    this.translucency = 0.85
    this._texLoader = new THREE.TextureLoader()
  }

  setScreen(w, h) {
    this.camera.left = -w / 2; this.camera.right = w / 2
    this.camera.top = h / 2; this.camera.bottom = -h / 2
    this.camera.updateProjectionMatrix()
    this.screenMesh.geometry.dispose()
    this.screenMesh.geometry = new THREE.PlaneGeometry(w, h)
    this.shadowQuad.geometry.dispose()
    this.shadowQuad.geometry = new THREE.PlaneGeometry(w, h)
    this.paperMat.uniforms.screenSize.value.set(w, h)
    this.rtA.setSize(w, h)
    this.rtB.setSize(w, h)
    this.blurMat.uniforms.dir.value.set(1 / w, 0)
  }

  setLight(light) {
    this.light = { ...light }
    this.paperMat.uniforms.lightColor.value.set(light.color)
    this.paperMat.uniforms.intensity.value = light.intensity
    // 灯投影到幕布上的位置(幕布局部坐标,左下原点)
    const w = this.paperMat.uniforms.screenSize.value
    this.paperMat.uniforms.lightPos.value.set(light.x + w.x / 2, light.y + w.y / 2)
  }

  syncCast(cast, characters, translucency) {
    this.translucency = translucency
    const alive = new Set()
    for (const member of cast) {
      alive.add(member.id)
      if (!this.members.has(member.id)) this._buildMember(member, characters)
    }
    for (const [id, m] of this.members) {
      if (!alive.has(id)) this._disposeMember(id, m)
    }
  }

  _buildMember(member, characters) {
    const character = characters.find(c => c.id === member.characterId)
    if (!character) return
    const group = new THREE.Group()
    group.renderOrder = 2
    const shadowGroup = new THREE.Group()
    const parts = new Map(), shadows = new Map()
    for (const part of character.parts) {
      const grid = buildGrid(part)
      // 幕前影人(皮子材质)
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(grid.count * 3), 3))
      geo.setAttribute('uv', new THREE.BufferAttribute(grid.uvs, 2))
      geo.setIndex(grid.indices)
      const tex = this._texLoader.load(part.image)
      tex.colorSpace = THREE.SRGBColorSpace
      const mat = new THREE.ShaderMaterial({
        vertexShader: LEATHER_VERT, fragmentShader: LEATHER_FRAG, transparent: true, depthTest: false, side: THREE.DoubleSide,
        uniforms: {
          map: { value: tex },
          lightColor: { value: new THREE.Color(this.light.color) },
          translucency: { value: this.translucency },
          glow: { value: this.light.intensity },
        },
      })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.renderOrder = 2 + part.zIndex * 0.01
      group.add(mesh)
      parts.set(part.id, { mesh, grid })
      // 影子网格(带贴图镂空,只投皮子实处的影)
      const sgeo = new THREE.BufferGeometry()
      sgeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(grid.count * 3), 3))
      sgeo.setAttribute('uv', new THREE.BufferAttribute(grid.uvs, 2))
      sgeo.setIndex(grid.indices)
      const smesh = new THREE.Mesh(sgeo, new THREE.MeshBasicMaterial({
        map: tex, color: 0x1a0f08, alphaTest: 0.4, transparent: false, depthTest: false,
      }))
      shadowGroup.add(smesh)
      shadows.set(part.id, { mesh: smesh, grid })
    }
    this.scene.add(group)
    this.shadowScene.add(shadowGroup)
    this.members.set(member.id, { group, shadowGroup, parts, shadows, character })
  }

  _disposeMember(id, m) {
    for (const { mesh } of m.parts.values()) {
      m.group.remove(mesh); mesh.geometry.dispose(); mesh.material.uniforms.map.value?.dispose(); mesh.material.dispose()
    }
    for (const { mesh } of m.shadows.values()) {
      m.shadowGroup.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose()
    }
    this.scene.remove(m.group)
    this.shadowScene.remove(m.shadowGroup)
    this.members.delete(id)
  }

  // 每帧:按时间采样所有成员的片段,蒙皮 + 投影影子
  updateFrame(cast, clips, time) {
    const L = Math.max(this.light.distance, PUPPET_DEPTH + 10)
    const projT = L / (L - PUPPET_DEPTH) // 影子放大倍数
    for (const member of cast) {
      const m = this.members.get(member.id)
      if (!m) continue
      const character = m.character
      // 姿态采样(支持双片段混合)
      let pose
      const clipA = clips.find(c => c.id === member.clipId)
      const clipB = clips.find(c => c.id === member.clip2Id)
      const t = Math.max(0, time - member.offset)
      if (clipA && clipB && member.blend > 0) {
        pose = blendClipsAngular(clipA, clipB, t, member.blend)
      } else if (clipA) {
        const tt = member.loop && clipA.duration > 0 ? t % clipA.duration : Math.min(t, clipA.duration)
        pose = sampleClip(clipA, tt)
      } else pose = {}
      const extraRot = {}
      for (const b of character.bones) if (pose[b.id] != null) extraRot[b.id] = pose[b.id]
      const rootX = (pose['root.x'] || 0) + member.x
      const rootY = (pose['root.y'] || 0) + member.y
      const bindWorld = boneWorldTransforms(character.bones, {})
      const animWorld = boneWorldTransforms(character.bones, extraRot)
      const s = member.scale
      for (const part of character.parts) {
        const entry = m.parts.get(part.id)
        const weights = character.weights[part.id]
        const skinned = weights
          ? skinPositions(entry.grid.positions, entry.grid.count, weights, bindWorld, animWorld)
          : entry.grid.positions
        const pos = entry.mesh.geometry.attributes.position
        const spos = m.shadows.get(part.id).mesh.geometry.attributes.position
        for (let v = 0; v < entry.grid.count; v++) {
          const px = (skinned[v * 2] + rootX) * s
          const py = (skinned[v * 2 + 1] + rootY) * s
          pos.setXYZ(v, px, py, -PUPPET_DEPTH)
          // 从灯心投影到幕布平面
          const sx = this.light.x + projT * (px - this.light.x)
          const sy = this.light.y + projT * (py - this.light.y)
          spos.setXYZ(v, sx, sy, 0)
        }
        pos.needsUpdate = true
        spos.needsUpdate = true
        entry.mesh.material.uniforms.lightColor.value.set(this.light.color)
        entry.mesh.material.uniforms.translucency.value = this.translucency
        entry.mesh.material.uniforms.glow.value = this.light.intensity
      }
    }
    // 灯越近影子越虚越大
    const proximity = PUPPET_DEPTH / Math.max(L - PUPPET_DEPTH, 10)
    this.blurRadius = 1.0 + this.light.softness * (0.5 + proximity * 10)
    this.shadowMat.opacity = Math.min(0.95, 0.35 + this.light.intensity * 0.5)
  }

  render() {
    const w = this.paperMat.uniforms.screenSize.value
    // 1) 影子渲染到 RT_A
    this.renderer.setRenderTarget(this.rtA)
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.clear()
    this.renderer.render(this.shadowScene, this.camera)
    // 2) 高斯模糊(两轮 H/V,大半径也平滑无阶梯)
    for (let pass = 0; pass < 2; pass++) {
      this.blurMat.uniforms.radius.value = (this.blurRadius || 1.5) * (pass === 0 ? 0.6 : 1.0)
      this.blurMat.uniforms.tex.value = this.rtA.texture
      this.blurMat.uniforms.dir.value.set(1 / w.x, 0)
      this.renderer.setRenderTarget(this.rtB)
      this.renderer.render(this.blurScene, this.blurCam)
      this.blurMat.uniforms.tex.value = this.rtB.texture
      this.blurMat.uniforms.dir.value.set(0, 1 / w.y)
      this.renderer.setRenderTarget(this.rtA)
      this.renderer.render(this.blurScene, this.blurCam)
    }
    // 3) 主画面:幕布 → 影子 → 影人
    this.shadowMat.map = this.rtA.texture
    this.shadowMat.needsUpdate = true
    this.renderer.setRenderTarget(null)
    this.renderer.setClearColor(0x14100c, 1)
    this.renderer.clear()
    this.renderer.render(this.scene, this.camera)
  }

  resize() {
    const w = this.canvas.clientWidth || 1, h = this.canvas.clientHeight || 1
    this.renderer.setSize(w, h, false)
  }

  dispose() {
    for (const [id, m] of this.members) this._disposeMember(id, m)
    this.rtA.dispose(); this.rtB.dispose()
    this.renderer.dispose()
  }
}
