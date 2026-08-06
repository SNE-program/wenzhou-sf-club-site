// ============================================
// 五环浑天仪 · 可嵌入三维组件（ES Module）
// 依赖：页面需提供 importmap 指向 three（见 index.html）
// 用法：createArmillary(container, options)
// 设计：极光深空配色 · 精简优雅模型 · 舞台化展示
// ============================================

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// 五环极光配色：外→内 青 → 紫 → 青绿 → 靛 → 金
const RING_PALETTE = [
  { ring: '#7ce8ff', glow: '#38bdf8' }, // 环1 最外 · 青
  { ring: '#b9a2ff', glow: '#8b5cf6' }, // 环2 · 紫
  { ring: '#7ff0e2', glow: '#2dd4bf' }, // 环3 · 青绿
  { ring: '#94a5ff', glow: '#6366f1' }, // 环4 · 靛
  { ring: '#ffd98c', glow: '#f5c877' }, // 环5 最内 · 金
];

// 环参数：半径 / 管径 / 倾斜 / 基础转速 / 星点数量
// spin:'x' 表示该环绕水平轴翻转（立起 / 侧倾），其余环绕竖直轴进动
const RINGS = [
  { radius: 3.02, tube: 0.06, tiltX: 0,    tiltZ: 14,  baseSpeed: 0.9,  markers: 8, markerSize: 0.07,  markerGlow: 1.3, spin: 'x' },
  { radius: 2.70, tube: 0.055,tiltX: 23.5, tiltZ: 4,   baseSpeed: -0.42, markers: 7 },
  { radius: 2.40, tube: 0.05, tiltX: -32,  tiltZ: 14,  baseSpeed: 0.52, markers: 8 },
  { radius: 2.12, tube: 0.047,tiltX: 52,   tiltZ: -10, baseSpeed: -0.46, markers: 6 },
  { radius: 1.82, tube: 0.045,tiltX: 68,   tiltZ: 21,  baseSpeed: 0.56, markers: 7 },
];

// 确定性相位（不随机，姿态稳定、更显工整）
const PHASES = [
  { f1: 0.62, f2: 1.24, f3: 1.90, a1: 0.10, a2: 0.06, a3: 0.03 },
  { f1: 0.70, f2: 1.35, f3: 2.05, a1: 0.09, a2: 0.05, a3: 0.03 },
  { f1: 0.55, f2: 1.15, f3: 1.80, a1: 0.11, a2: 0.07, a3: 0.04 },
  { f1: 0.80, f2: 1.50, f3: 2.20, a1: 0.08, a2: 0.05, a3: 0.03 },
  { f1: 0.66, f2: 1.28, f3: 1.96, a1: 0.10, a2: 0.06, a3: 0.04 },
];

export function createArmillary(container, options = {}) {
  const {
    interactive = true,      // 允许拖拽旋转
    wheelZoom = false,       // 滚轮缩放（页面内嵌时关闭，避免劫持滚动）
    showHint = false,        // 是否显示操作提示
    autoRotate = true,       // 自动旋转
    speed = 1,               // 全局速度倍率
  } = options;

  const hintEl = (typeof showHint === 'object' && showHint) ? showHint : null;
  const reduceMotion =
    typeof matchMedia === 'function' &&
    matchMedia('(prefers-reduced-motion: reduce)').matches;

  // 自动旋转开关（可变，供外部 setAutoRotate 调整）
  let autoRotateActive = autoRotate && !reduceMotion;

  const isMobile = (w, h) => Math.min(w, h) < 480;

  // ==================== 渲染器 ====================
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.setClearColor(0x000000, 0); // 透明背景，融入页面星野
  container.appendChild(renderer.domElement);

  // ==================== 场景与相机 ====================
  const scene = new THREE.Scene();
  const w = () => container.clientWidth || 1;
  const h = () => container.clientHeight || 1;

  const camera = new THREE.PerspectiveCamera(46, w() / h(), 0.5, 40);

  // 小容器（移动端 / 窄舞台）时拉远视角，保证完整构图
  const compact = isMobile(w(), h());
  const camDist = compact ? 5.6 : 4.8;
  camera.position.set(camDist * 0.72, camDist * 0.45, camDist);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.enableZoom = wheelZoom;
  controls.autoRotate = autoRotateActive;
  controls.autoRotateSpeed = 0.5 * speed;
  controls.minDistance = 3.0;
  controls.maxDistance = 11;
  controls.maxPolarAngle = Math.PI * 0.72;
  controls.minPolarAngle = Math.PI * 0.28;
  if (!interactive) {
    controls.enableRotate = false;
    controls.enableZoom = false;
    controls.enableDamping = false;
  }
  controls.update();

  // ==================== 光照（冷主光 + 暖核心光） ====================
  scene.add(new THREE.AmbientLight(0x2a3a6e, 1.2));
  scene.add(new THREE.HemisphereLight(0x9fe8ff, 0x140b24, 0.55));

  const key = new THREE.DirectionalLight(0xcfe9ff, 2.4);
  key.position.set(6, 4, 5);
  scene.add(key);

  const rim = new THREE.DirectionalLight(0x8f7bff, 1.5); // 紫罗兰轮廓光
  rim.position.set(-4, 3, -6);
  scene.add(rim);

  const fill = new THREE.DirectionalLight(0x6ee7f9, 0.9);
  fill.position.set(-2, -1, -4);
  scene.add(fill);

  // ==================== 中心光源（暖金 · 照亮环体） ====================
  const coreLight = new THREE.PointLight(0xffc078, 18, 6.5, 1.6);
  coreLight.position.set(0, 0, 0);
  scene.add(coreLight);

  // 逐粒子闪烁材质：每个光点按自身相位明暗脉动，更醒目
  const sparkleMats = [];
  function sparkleMaterial(color, baseSize, opacity, twinkle) {
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(color) },
        uSize: { value: baseSize },
        uOpacity: { value: opacity },
        uTwinkle: { value: twinkle },
      },
      vertexShader: `
        attribute float aPhase;
        attribute float aSize;
        uniform float uTime;
        uniform float uSize;
        uniform float uTwinkle;
        varying float vTw;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float dist = max(-mv.z, 0.5);
          gl_PointSize = min(uSize * aSize * (300.0 / dist), 52.0);
          vTw = sin(uTime * uTwinkle + aPhase);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uOpacity;
        varying float vTw;
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          float d = length(uv);
          float a = smoothstep(0.5, 0.12, d);          // 实心亮核 + 柔边
          a *= 0.45 + 0.55 * (0.5 + 0.5 * vTw);        // 明暗闪烁
          gl_FragColor = vec4(uColor, a * uOpacity);
        }
      `,
    });
    sparkleMats.push(mat);
    return mat;
  }

  // 给几何体补充逐粒子属性（相位 / 大小）
  function addSparkleAttrs(geom, count) {
    const phases = new Float32Array(count);
    const sizes = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      phases[i] = Math.random() * Math.PI * 2;
      sizes[i] = 0.6 + Math.random() * 1.2;
    }
    geom.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    geom.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  }

  // ==================== 主体：五环 + 星点 ====================
  const mainGroup = new THREE.Group();
  scene.add(mainGroup);

  const ringGroups = [];

  RINGS.forEach((def, i) => {
    const palette = RING_PALETTE[i];
    const phase = PHASES[i];

    const tiltGroup = new THREE.Group();
    tiltGroup.rotation.x = THREE.MathUtils.degToRad(def.tiltX);
    tiltGroup.rotation.z = THREE.MathUtils.degToRad(def.tiltZ);

    // 环体：细腻金属 + 微弱自发光
    const ringMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(palette.ring),
      roughness: 0.28,
      metalness: 0.85,
      emissive: new THREE.Color(palette.glow).multiplyScalar(0.14),
    });
    const torus = new THREE.Mesh(
      new THREE.TorusGeometry(def.radius, def.tube, 16, 128),
      ringMat
    );
    torus.rotation.x = -Math.PI / 2; // 翻转至 XZ 平面
    tiltGroup.add(torus);

    // 星点：小而精的发光珠（可逐环指定尺寸与亮度）
    const markerMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(palette.ring),
      roughness: 0.2,
      metalness: 0.6,
      emissive: new THREE.Color(palette.glow).multiplyScalar(0.55),
      emissiveIntensity: def.markerGlow || 0.9,
    });
    const markerR = def.markerSize || (def.markers === 8 ? 0.052 : def.markers === 7 ? 0.048 : 0.045);
    const markerGeom = new THREE.SphereGeometry(markerR, 12, 12);
    for (let m = 0; m < def.markers; m++) {
      const a = (m / def.markers) * Math.PI * 2;
      const marker = new THREE.Mesh(markerGeom, markerMat);
      marker.position.set(def.radius * Math.cos(a), 0, def.radius * Math.sin(a));
      tiltGroup.add(marker);
    }

    // 环上流动的星屑：沿环周圈流动的发光点，随环一起运动
    const streamCount = 32;
    const streamGeom = new THREE.BufferGeometry();
    const streamPos = new Float32Array(streamCount * 3);
    for (let s = 0; s < streamCount; s++) {
      const a = (s / streamCount) * Math.PI * 2;
      streamPos[s * 3] = def.radius * Math.cos(a);
      streamPos[s * 3 + 1] = 0;
      streamPos[s * 3 + 2] = def.radius * Math.sin(a);
    }
    streamGeom.setAttribute('position', new THREE.BufferAttribute(streamPos, 3));
    addSparkleAttrs(streamGeom, streamCount);
    const stream = new THREE.Points(streamGeom, sparkleMaterial(palette.glow, 0.34, 0.95, 6));
    tiltGroup.add(stream);

    ringGroups.push({
      group: tiltGroup, stream,
      baseSpeed: def.baseSpeed, flowSpeed: 0.5 + Math.random() * 0.4,
      ...phase,
    });
    mainGroup.add(tiltGroup);
  });

  // ==================== 中心核心（暖金 · 呼吸） ====================
  const coreMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#f2c98a'),
    roughness: 0.18,
    metalness: 0.65,
    emissive: new THREE.Color('#ffb866'),
    emissiveIntensity: 1.5,
  });
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.52, 48, 48), coreMat);
  mainGroup.add(core);

  const innerGlowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff3dd') });
  const innerGlow = new THREE.Mesh(new THREE.SphereGeometry(0.34, 32, 32), innerGlowMat);
  mainGroup.add(innerGlow);

  // 光晕 Sprite
  function glowSprite(color, radius, opacity) {
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 256;
    const ctx = cv.getContext('2d');
    const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    g.addColorStop(0, color);
    g.addColorStop(0.2, color.replace('rgb', 'rgba').replace(')', ',0.55)'));
    g.addColorStop(0.5, color.replace('rgb', 'rgba').replace(')', ',0.16)'));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(cv),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity,
    }));
    sprite.scale.setScalar(radius);
    return sprite;
  }

  const halo1 = glowSprite('rgb(255,196,120)', 4.4, 0.42);
  const halo2 = glowSprite('rgb(255,225,180)', 2.7, 0.3);
  mainGroup.add(halo1);
  mainGroup.add(halo2);

  // ==================== 悬浮结构：无转轴、无底座，仅五环 + 中心球 ====================
  // 极简的悬浮浑天仪形态，旋转更显轻盈

  // ==================== 粒子特效：环上星屑（已随环创建）+ 公转星尘 + 星核余烬 + 远空星野 ====================

  // 公转星尘层：绕浑天仪漂移的发光尘埃（逐粒子闪烁）
  function makeOrbitParticles(count, color, size, opacity, twinkle, rMin, rMax, speedMin, speedMax) {
    const geom = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const data = [];
    for (let i = 0; i < count; i++) {
      const r = rMin + Math.random() * (rMax - rMin);
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      pos[i * 3 + 2] = r * Math.cos(phi);
      data.push({
        r, theta, phi, baseY: pos[i * 3 + 1],
        orbitSpeed: (speedMin + Math.random() * (speedMax - speedMin)) * (Math.random() > 0.5 ? 1 : -1),
        driftFreq: 0.3 + Math.random() * 0.7,
        driftAmp: 0.02 + Math.random() * 0.1,
      });
    }
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    addSparkleAttrs(geom, count);
    const pts = new THREE.Points(geom, sparkleMaterial(color, size, opacity, twinkle));
    mainGroup.add(pts);
    return { geom, data, count };
  }

  // 青蓝星尘（主层）
  const dustA = makeOrbitParticles(260, 0xaee7ff, 0.26, 0.85, 3, 1.6, 4.6, 0.05, 0.21);
  // 暖金星尘（点缀层，靠近核心更密）
  const dustB = makeOrbitParticles(120, 0xffd98c, 0.22, 0.8, 4, 1.1, 3.2, 0.06, 0.24);

  // 星核余烬：从核心向外脉动的细碎光点
  const emberCount = 48;
  const emberGeom = new THREE.BufferGeometry();
  const emberPos = new Float32Array(emberCount * 3);
  const emberData = [];
  for (let i = 0; i < emberCount; i++) {
    const dir = new THREE.Vector3(
      Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1
    ).normalize();
    emberData.push({ dx: dir.x, dy: dir.y, dz: dir.z, phase: Math.random() * Math.PI * 2, maxR: 0.7 + Math.random() * 1.1 });
  }
  emberGeom.setAttribute('position', new THREE.BufferAttribute(emberPos, 3));
  addSparkleAttrs(emberGeom, emberCount);
  const embers = new THREE.Points(emberGeom, sparkleMaterial(0xffc078, 0.24, 0.9, 5));
  mainGroup.add(embers);

  // 远空：静止星野（提供视差深度，微微闪烁）
  const farCount = 380;
  const farGeom = new THREE.BufferGeometry();
  const farPos = new Float32Array(farCount * 3);
  for (let i = 0; i < farCount; i++) {
    const r = 6 + Math.random() * 13;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    farPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    farPos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    farPos[i * 3 + 2] = r * Math.cos(phi);
  }
  farGeom.setAttribute('position', new THREE.BufferAttribute(farPos, 3));
  addSparkleAttrs(farGeom, farCount);
  const farParticles = new THREE.Points(farGeom, sparkleMaterial(0x9db4f0, 0.14, 0.55, 2));
  scene.add(farParticles);

  // ==================== 交互与提示 ====================
  let hintShown = false;
  function fadeHint() {
    if (hintShown || !hintEl) return;
    hintShown = true;
    if (hintEl.classList) hintEl.classList.add('faded');
  }
  if (hintEl) {
    setTimeout(fadeHint, 6000);
    renderer.domElement.addEventListener('pointerdown', fadeHint, { once: true });
  }

  // 拖拽时暂停自动旋转，松手后延时恢复
  let autoPaused = false;
  let focusTimer = 0;
  controls.addEventListener('start', () => {
    autoPaused = true;
    controls.autoRotate = false;
    fadeHint();
  });
  controls.addEventListener('end', () => {
    setTimeout(() => {
      autoPaused = false;
      if (autoRotateActive) controls.autoRotate = true;
    }, 2600);
  });

  // ==================== 动画循环 ====================
  const clock = new THREE.Clock();
  let t = 0;
  let rafId = 0;

  function animate() {
    rafId = requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.1);
    t += dt;

    // 环：多层正弦调制转速，运动有机而不失沉稳
    ringGroups.forEach((rd) => {
      const mod =
        1 +
        rd.a1 * Math.sin(t * rd.f1 + 0.7) +
        rd.a2 * Math.sin(t * rd.f2 + 1.3) +
        rd.a3 * Math.sin(t * rd.f3 + 2.1);
      if (rd.spin === 'x') {
        // 绕水平轴翻转：环在水平 / 竖直 / 侧倾之间翻滚
        rd.group.rotation.x += rd.baseSpeed * mod * dt * speed;
      } else {
        // 绕竖直轴进动
        rd.group.rotation.y += rd.baseSpeed * mod * dt * speed;
      }
    });

    // 核心呼吸
    const breathe = 1 + Math.sin(t * 0.7) * 0.03 + Math.sin(t * 1.4 + 0.5) * 0.02;
    core.scale.setScalar(breathe);
    innerGlow.scale.setScalar(breathe * 1.06);

    // 光晕脉动
    halo1.scale.setScalar(4.4 * (1 + Math.sin(t * 0.6) * 0.1));
    halo2.scale.setScalar(2.7 * (1 + Math.sin(t * 0.5 + 2.4) * 0.08));
    halo1.material.opacity = 0.36 + Math.sin(t * 0.6) * 0.06;
    coreLight.intensity = 18 + Math.sin(t * 0.7) * 3;

    // 环上星屑：沿环周圈流动
    ringGroups.forEach((rd) => {
      rd.stream.rotation.y += rd.flowSpeed * dt * speed;
    });

    // 公转星尘：双色层漂移
    [dustA, dustB].forEach((layer) => {
      const pos = layer.geom.attributes.position.array;
      for (let i = 0; i < layer.count; i++) {
        const d = layer.data[i];
        d.theta += d.orbitSpeed * dt;
        const y = d.baseY + Math.sin(t * d.driftFreq + d.phi) * d.driftAmp;
        pos[i * 3] = d.r * Math.sin(d.phi) * Math.cos(d.theta);
        pos[i * 3 + 1] = y;
        pos[i * 3 + 2] = d.r * Math.sin(d.phi) * Math.sin(d.theta);
      }
      layer.geom.attributes.position.needsUpdate = true;
    });

    // 星核余烬：向外脉动再收回
    const ePos = emberGeom.attributes.position.array;
    for (let i = 0; i < emberCount; i++) {
      const e = emberData[i];
      const pulse = (Math.sin(t * 0.45 + e.phase) * 0.5 + 0.5); // 0..1
      const dist = 0.28 + pulse * e.maxR;
      ePos[i * 3] = e.dx * dist;
      ePos[i * 3 + 1] = e.dy * dist;
      ePos[i * 3 + 2] = e.dz * dist;
    }
    emberGeom.attributes.position.needsUpdate = true;

    // 远空星野：缓慢自转（闪烁由逐粒子材质驱动）
    farParticles.rotation.y += dt * 0.02;
    farParticles.rotation.x += dt * 0.006;

    // 驱动所有闪烁粒子的时间
    for (let i = 0; i < sparkleMats.length; i++) {
      sparkleMats[i].uniforms.uTime.value = t;
    }

    controls.update();
    renderer.render(scene, camera);
  }

  // ==================== 尺寸自适应 ====================
  const resize = () => {
    const W = w(), H = h();
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    renderer.setSize(W, H, false);
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  window.addEventListener('resize', resize);

  // 启动动画循环
  requestAnimationFrame(animate);

  // ==================== 对外 API ====================
  return {
    container,
    setAutoRotate(b) {
      autoRotateActive = b && !reduceMotion;
      controls.autoRotate = autoRotateActive && !autoPaused;
    },
    zoomBy(factor) {
      const dir = new THREE.Vector3().subVectors(camera.position, controls.target).normalize();
      const dist = controls.target.distanceTo(camera.position) * factor;
      const clamped = Math.min(controls.maxDistance, Math.max(controls.minDistance, dist));
      camera.position.copy(controls.target).addScaledVector(dir, clamped);
      controls.update();
    },
    resetView() {
      camera.position.set(camDist * 0.72, camDist * 0.45, camDist);
      controls.target.set(0, 0, 0);
      controls.update();
    },
    focusView(mode) {
      const dist = camDist;
      const views = {
        front: () => camera.position.set(0, 0, dist),
        back: () => camera.position.set(0, 0, -dist),
        top: () => camera.position.set(0, dist, 0.01),
        reset: () => camera.position.set(camDist * 0.72, camDist * 0.45, camDist),
      };
      (views[mode] || views.reset)();
      controls.target.set(0, 0, 0);
      // 手动视角时暂停自动旋转，稍后恢复
      controls.autoRotate = false;
      clearTimeout(focusTimer);
      focusTimer = setTimeout(() => {
        if (autoRotateActive) controls.autoRotate = true;
      }, 3000);
      controls.update();
    },
    dispose() {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      window.removeEventListener('resize', resize);
      controls.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
    },
  };
}
