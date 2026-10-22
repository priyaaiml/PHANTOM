import { useEffect, useRef } from 'react'
import * as THREE from 'three'

/**
 * Ambient particle wave — a plane of points displaced by two sine terms, drawn
 * with a tiny custom shader. Used as the dashboard hero backdrop.
 *
 * Two things are adapted from the reference implementation so it can live
 * inside the app rather than own the viewport:
 *   * it fills its parent element instead of a fixed `100vw x 100vh` canvas;
 *   * the palette is a prop, because PHANTOM ships a single light theme and a
 *     black-on-white wave would fight the warm cream surfaces. Colours are fed
 *     to the shader as raw 0..1 components (no colour management) so the hex you
 *     pass is the colour on screen.
 */
export interface ParticleWaveProps {
  className?: string
  /** Points per axis. The reference uses 200 (= 40k points); 120 is plenty for a backdrop. */
  density?: number
  /** Point colour when the document is in the light theme. */
  lightColor?: string
  /** Point colour when the document is in the dark theme. */
  darkColor?: string
  /**
   * `theme` fills the canvas with the theme background colour, `transparent`
   * leaves it clear so whatever sits behind the canvas shows through.
   */
  background?: 'theme' | 'transparent'
  /** Cap on device pixel ratio — the backdrops are decorative, not photo-grade. */
  maxDpr?: number
}

const DEFAULTS = {
  light: { particle: '#262019', bg: '#ffffff' },
  dark: { particle: '#ffffff', bg: '#000000' },
}

/** Hex -> 0..1 components, unmanaged (the shader writes them straight out). */
function hexToComponents(hex: string): THREE.Vector3 {
  const h = hex.trim().replace('#', '')
  const full = h.length === 3 ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2] : h.slice(0, 6)
  const n = Number.parseInt(full, 16)
  if (Number.isNaN(n)) return new THREE.Vector3(0, 0, 0)
  return new THREE.Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}

const PARTICLE_VERTEX = `
  attribute float scale;
  uniform float uTime;
  void main() {
    vec3 p = position;
    float s = scale;
    p.y += (sin(p.x + uTime) * 0.5) + (cos(p.y + uTime) * 0.1) * 2.0;
    p.x += (sin(p.y + uTime) * 0.5);
    s += (sin(p.x + uTime) * 0.5) + (cos(p.y + uTime) * 0.1) * 2.0;
    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = s * 15.0 * (1.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`

const PARTICLE_FRAGMENT = `
  uniform vec3 uColor;
  uniform float uOpacity;
  void main() {
    gl_FragColor = vec4(uColor, uOpacity);
  }
`

export function ParticleWave({
  className = '',
  density = 160,
  lightColor,
  darkColor,
  background = 'theme',
  maxDpr = 1.5,
}: ParticleWaveProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  // Read through a ref so a re-render never tears down the WebGL context.
  const props = useRef({ density, lightColor, darkColor, background, maxDpr })
  props.current = { density, lightColor, darkColor, background, maxDpr }

  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    // Bind to a non-null alias so the closures below keep the narrowed type.
    const canvas: HTMLCanvasElement = el

    const isDark = () =>
      typeof document !== 'undefined' && document.documentElement.classList.contains('dark')

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
    } catch {
      // No WebGL — leave the canvas empty so the theme background shows through.
      canvas.style.display = 'none'
      return
    }

    const P = props.current
    const dpr = Math.min(window.devicePixelRatio || 1, Math.max(1, P.maxDpr))

    renderer.setPixelRatio(dpr)
    renderer.setClearAlpha(0)

    const camera = new THREE.PerspectiveCamera(75, 1, 0.01, 1000)
    camera.position.set(0, 6, 5)

    const scene = new THREE.Scene()

    const gap = 0.3
    const perAxis = Math.max(20, Math.round(P.density))
    const total = perAxis * perAxis
    const positions = new Float32Array(total * 3)
    const scales = new Float32Array(total)

    let i = 0
    let j = 0
    for (let ix = 0; ix < perAxis; ix++) {
      for (let iy = 0; iy < perAxis; iy++) {
        positions[i] = ix * gap - (perAxis * gap) / 2
        positions[i + 1] = 0
        positions[i + 2] = iy * gap - (perAxis * gap) / 2
        scales[j] = 1
        i += 3
        j++
      }
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('scale', new THREE.BufferAttribute(scales, 1))

    const material = new THREE.ShaderMaterial({
      transparent: true,
      vertexShader: PARTICLE_VERTEX,
      fragmentShader: PARTICLE_FRAGMENT,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Vector3(0, 0, 0) },
        uOpacity: { value: 0.5 },
      },
    })

    const particles = new THREE.Points(geometry, material)
    scene.add(particles)

    /** Keeps the shader in step with the theme and the current props. */
    function syncTheme() {
      const dark = isDark()
      const fallback = dark ? DEFAULTS.dark : DEFAULTS.light
      material.uniforms.uColor.value = hexToComponents(
        (dark ? props.current.darkColor : props.current.lightColor) ?? fallback.particle,
      )
      if (props.current.background === 'transparent') {
        renderer.setClearAlpha(0)
      } else {
        renderer.setClearColor(fallback.bg, 1)
      }
    }

    function resize() {
      const parent = canvas.parentElement
      const w = Math.max(1, Math.round(parent?.clientWidth ?? canvas.clientWidth ?? 1))
      const h = Math.max(1, Math.round(parent?.clientHeight ?? canvas.clientHeight ?? 1))
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h, false)
    }

    resize()
    syncTheme()

    let animationId: number | null = null
    let running = true

    function animate() {
      if (!running) return
      animationId = requestAnimationFrame(animate)
      if (document.hidden) return
      material.uniforms.uTime.value += 0.05
      syncTheme()
      camera.lookAt(scene.position)
      renderer.render(scene, camera)
    }

    const onResize = () => resize()
    window.addEventListener('resize', onResize)

    /** Only burn frames while the backdrop is actually on screen. */
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries[0]?.isIntersecting ?? true
        if (visible && animationId === null && running) {
          animationId = requestAnimationFrame(animate)
        } else if (!visible && animationId !== null) {
          cancelAnimationFrame(animationId)
          animationId = null
        }
      },
      { threshold: 0 },
    )
    observer.observe(canvas)

    animationId = requestAnimationFrame(animate)

    return () => {
      running = false
      if (animationId !== null) cancelAnimationFrame(animationId)
      observer.disconnect()
      window.removeEventListener('resize', onResize)
      scene.remove(particles)
      geometry.dispose()
      material.dispose()
      renderer.dispose()
    }
  }, [])

  return <canvas ref={canvasRef} className={`block ${className}`} aria-hidden="true" />
}
