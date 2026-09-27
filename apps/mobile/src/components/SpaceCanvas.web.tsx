/* eslint-disable react/no-unknown-property -- React Three Fiber defines these JSX props. */
import { Canvas, useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Color, Group, Mesh, ShaderMaterial } from 'three';

type Scene = 'eclipse' | 'pair' | 'astronaut' | 'glasses';

const vertex = `
varying vec2 vUv;
varying vec3 vNormal;
void main() {
  vUv = uv;
  vNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const fragment = `
uniform float uTime;
uniform vec3 uDark;
uniform vec3 uLight;
varying vec2 vUv;
varying vec3 vNormal;
void main() {
  float bands = sin(vUv.y * 31.0 + sin(vUv.x * 17.0 + uTime * .11) * 2.2) * .08;
  float clouds = sin(vUv.x * 19.0 - uTime * .08) * sin(vUv.y * 24.0 + uTime * .07) * .11;
  float illumination = smoothstep(-.18, .78, dot(normalize(vNormal), normalize(vec3(-.7, .45, 1.0))));
  float shade = clamp(illumination * .76 + bands + clouds, 0.0, 1.0);
  vec3 color = mix(uDark, uLight, shade);
  float rim = pow(1.0 - max(dot(normalize(vNormal), vec3(0.0, 0.0, 1.0)), 0.0), 2.0);
  color += uLight * rim * .35;
  gl_FragColor = vec4(color, 1.0);
}`;

function Planet({ x = 0, y = 0, scale = 1, second = false, motion = true }: { x?: number; y?: number; scale?: number; second?: boolean; motion?: boolean }) {
  const mesh = useRef<Mesh>(null);
  const material = useRef<ShaderMaterial>(null);
  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uDark: { value: new Color(second ? '#241A25' : '#231517') }, uLight: { value: new Color(second ? '#C46B44' : '#FF6D29') } }), [second]);
  useFrame((state, delta) => {
    if (!motion) return;
    if (mesh.current) mesh.current.rotation.y += delta * .09;
    if (material.current) material.current.uniforms.uTime.value = state.clock.elapsedTime;
  });
  return <group position={[x, y, 0]} scale={scale}>
    <mesh scale={1.12}><sphereGeometry args={[1, 48, 48]} /><meshBasicMaterial color={second ? '#B65D3C' : '#FF6D29'} transparent opacity={.075} depthWrite={false} /></mesh>
    <mesh ref={mesh}><sphereGeometry args={[1, 64, 64]} /><shaderMaterial ref={material} uniforms={uniforms} vertexShader={vertex} fragmentShader={fragment} /></mesh>
  </group>;
}

function Astronaut({ motion }: { motion: boolean }) {
  const body = useRef<Group>(null);
  const arm = useRef<Group>(null);
  useFrame(state => {
    if (!motion) return;
    if (body.current) body.current.rotation.y = Math.sin(state.clock.elapsedTime * .45) * .12;
    if (arm.current) arm.current.rotation.z = -.5 + Math.sin(state.clock.elapsedTime * 2.5) * .34;
  });
  return <group ref={body} position={[0, -.22, 0]}>
    <mesh position={[0, -.82, 0]}><capsuleGeometry args={[.46, .6, 8, 20]} /><meshStandardMaterial color="#E7DFD8" metalness={.14} roughness={.34} /></mesh>
    <mesh position={[0, .46, 0]}><sphereGeometry args={[.74, 40, 40]} /><meshStandardMaterial color="#F7ECE5" metalness={.12} roughness={.25} /></mesh>
    <mesh position={[0, .47, .47]} scale={[.94, .79, .44]}><sphereGeometry args={[.63, 40, 40]} /><meshPhysicalMaterial color="#081825" metalness={.42} roughness={.12} clearcoat={1} /></mesh>
    <mesh position={[0, .46, .66]}><torusGeometry args={[.49, .035, 10, 60]} /><meshStandardMaterial color="#FF6D29" emissive="#9E3108" emissiveIntensity={.4} /></mesh>
    <mesh position={[0, -.6, .5]}><boxGeometry args={[.5, .31, .12]} /><meshStandardMaterial color="#453027" metalness={.5} roughness={.28} /></mesh>
    <group ref={arm} position={[.57, -.42, 0]}>
      <mesh position={[.32, .03, 0]} rotation={[0, 0, 1.1]}><capsuleGeometry args={[.15, .36, 8, 18]} /><meshStandardMaterial color="#EEE6DE" /></mesh>
      <mesh position={[.61, .29, 0]}><sphereGeometry args={[.2, 20, 20]} /><meshStandardMaterial color="#F6EFE7" /></mesh>
    </group>
    <mesh position={[-.79, -.58, 0]} rotation={[0, 0, -.55]}><capsuleGeometry args={[.15, .46, 8, 18]} /><meshStandardMaterial color="#EEE6DE" /></mesh>
    <mesh position={[-.27, -1.52, 0]} rotation={[0, 0, -.17]}><capsuleGeometry args={[.22, .56, 8, 18]} /><meshStandardMaterial color="#EEE6DE" /></mesh>
    <mesh position={[.27, -1.52, 0]} rotation={[0, 0, .17]}><capsuleGeometry args={[.22, .56, 8, 18]} /><meshStandardMaterial color="#EEE6DE" /></mesh>
  </group>;
}

function Glasses({ motion }: { motion: boolean }) {
  const group = useRef<Group>(null);
  useFrame((state, delta) => {
    if (!motion || !group.current) return;
    group.current.rotation.y += delta * .13;
    group.current.rotation.x = -.14 + Math.sin(state.clock.elapsedTime * .5) * .05;
  });
  return <group ref={group} rotation={[-.14, -.28, 0]}>
    {[-.89, .89].map(x => <group key={x} position={[x, 0, 0]}>
      <mesh><torusGeometry args={[.67, .095, 12, 48]} /><meshStandardMaterial color="#332B2C" metalness={.62} roughness={.25} /></mesh>
      <mesh position={[0, 0, -.025]}><circleGeometry args={[.61, 48]} /><meshPhysicalMaterial color="#251D20" transparent opacity={.42} metalness={.4} roughness={.18} side={2} /></mesh>
      <mesh position={[x > 0 ? .72 : -.72, .08, -.52]} rotation={[0, x > 0 ? -.3 : .3, 0]}><boxGeometry args={[.22, .14, 1.35]} /><meshStandardMaterial color="#443536" metalness={.58} roughness={.23} /></mesh>
    </group>)}
    <mesh position={[0, .22, .07]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[.07, .07, .62, 16]} /><meshStandardMaterial color="#493737" metalness={.55} /></mesh>
    <mesh position={[1.48, .12, .1]}><sphereGeometry args={[.075, 16, 16]} /><meshStandardMaterial color="#FF6D29" emissive="#FF6D29" emissiveIntensity={.6} /></mesh>
  </group>;
}

export function SpaceCanvas({ scene, height = 420, reducedMotion = false }: { scene: Scene; height?: number; reducedMotion?: boolean }) {
  const [webgl, setWebgl] = useState(false);
  const [visible, setVisible] = useState(false);
  const holder = useRef<HTMLDivElement>(null);
  useEffect(() => {
    try { const canvas = document.createElement('canvas'); setWebgl(!!(canvas.getContext('webgl2') || canvas.getContext('webgl'))); } catch { setWebgl(false); }
  }, []);
  useEffect(() => {
    const element = holder.current;
    if (!element) return;
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => setVisible(!!entries[0]?.isIntersecting), { rootMargin: '120px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return <div ref={holder} aria-hidden="true" style={{ width: '100%', height, pointerEvents: 'none' }}>{!webgl || !visible ? <div style={{ height, borderRadius: '50%', background: 'radial-gradient(circle at 42% 35%, #FF8D4F 0, #6C2818 31%, #211316 60%, transparent 72%)', filter: 'drop-shadow(0 0 46px #FF6D2950)' }} /> : <Canvas frameloop={reducedMotion ? 'demand' : 'always'} dpr={[1, 1.5]} camera={{ position: [0, 0, scene === 'pair' ? 5.2 : 4.3], fov: 44 }} gl={{ alpha: true, antialias: true, powerPreference: 'low-power' }}>
    <ambientLight intensity={1.7} /><directionalLight position={[-4, 4, 5]} intensity={3} color="#FFE6DC" /><pointLight position={[4, -2, 3]} intensity={15} color="#FF6D29" />
    {scene === 'eclipse' && <Planet scale={1.35} motion={!reducedMotion} />}
    {scene === 'pair' && <><Planet x={-1.28} scale={.91} motion={!reducedMotion} /><Planet x={1.28} y={-.1} scale={.78} second motion={!reducedMotion} /></>}
    {scene === 'astronaut' && <Astronaut motion={!reducedMotion} />}
    {scene === 'glasses' && <Glasses motion={!reducedMotion} />}
  </Canvas>}</div>;
}
