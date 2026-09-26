/* eslint-disable react/no-unknown-property -- These JSX elements are Three.js objects, not DOM elements. */
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from './fiber';
import { starColor, starPosition, type StarNode } from './geometry';

export type SceneMotion = { x: number; y: number; zoom: number; dragging: boolean; moved: boolean };

function glowTexture() {
  const data = new Uint8Array(32*32*4);
  for (let y=0; y<32; y++) for (let x=0; x<32; x++) {
    const radius = Math.hypot((x-15.5)/15.5, (y-15.5)/15.5);
    const index = (y*32+x)*4;
    data[index] = data[index+1] = data[index+2] = 255;
    data[index+3] = Math.round(Math.pow(Math.max(0, 1-radius), 3)*255);
  }
  const texture = new THREE.DataTexture(data, 32, 32);
  texture.needsUpdate = true;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  return texture;
}

export function StarScene({ nodes, motion, animate, revision, selected, onSelect }: {
  nodes: StarNode[]; motion: React.RefObject<SceneMotion>; animate: boolean; revision: number;
  selected: string | null; onSelect: (id: string) => void;
}) {
  const group = useRef<THREE.Group>(null);
  const { invalidate } = useThree();
  const texture = useMemo(glowTexture, []);
  const positions = useMemo(() => nodes.map(node => starPosition(node.request_id)), [nodes]);
  const edges = useMemo(() => new THREE.BufferGeometry().setFromPoints(positions.flatMap(p => [new THREE.Vector3(0,0,0), new THREE.Vector3(...p)])), [positions]);
  useEffect(() => () => texture.dispose(), [texture]);
  useEffect(() => () => edges.dispose(), [edges]);
  useEffect(() => invalidate(), [invalidate, revision, nodes, selected]);
  useFrame((_, delta) => {
    if (!group.current) return;
    if (animate && !motion.current.dragging) motion.current.y += Math.min(delta, .05)*.065;
    group.current.rotation.set(motion.current.x, motion.current.y, 0);
    group.current.scale.setScalar(motion.current.zoom);
  });
  return <group ref={group}>
    <mesh><icosahedronGeometry args={[1.5, 2]} /><meshBasicMaterial color="#A986E4" transparent opacity={.14} wireframe depthWrite={false} /></mesh>
    <mesh rotation={[Math.PI/2, .28, .15]}><torusGeometry args={[1.72, .004, 4, 120]} /><meshBasicMaterial color="#AE8BDC" transparent opacity={.32} /></mesh>
    <mesh rotation={[.23, .35, -.28]}><torusGeometry args={[1.72, .004, 4, 120]} /><meshBasicMaterial color="#AE8BDC" transparent opacity={.18} /></mesh>
    <lineSegments geometry={edges}><lineBasicMaterial color="#CDB5F9" transparent opacity={.18} /></lineSegments>
    <mesh><sphereGeometry args={[.025, 12, 12]} /><meshBasicMaterial color="#DDD1F4" /></mesh>
    {nodes.map((node, index) => <group key={node.request_id} position={positions[index]}>
      <sprite scale={selected === node.request_id ? .5 : .32}><spriteMaterial map={texture} color={starColor(node.preference)} transparent opacity={.95} depthWrite={false} blending={THREE.AdditiveBlending} /></sprite>
      <mesh onClick={event => { event.stopPropagation(); if (!motion.current.moved) onSelect(node.request_id); }}>
        <sphereGeometry args={[selected === node.request_id ? .046 : .03, 12, 12]} /><meshBasicMaterial color={starColor(node.preference)} />
      </mesh>
      <mesh onClick={event => { event.stopPropagation(); if (!motion.current.moved) onSelect(node.request_id); }}>
        <sphereGeometry args={[.09, 8, 8]} /><meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>)}
  </group>;
}
