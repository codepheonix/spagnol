"use client";
/**
 * Overview centrepiece, drawn with WebGL: the iGerald core with every platform around it.
 * It shows the real connection state it is given — a platform is lit and linked to the core only
 * when at least one account of that platform is connected. Glyphs are flat, unaltered textures on a
 * metal disc. Loaded lazily; never required for any task (the same links exist as text below it).
 */
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Lightformer, Line } from "@react-three/drei";
import * as THREE from "three";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { platformById } from "@/lib/platforms";

export interface SceneNode { id: string; connected: boolean; count: number; href: string }

function glyphTexture(id: string): THREE.Texture | null {
  const p = platformById(id);
  if (!p || typeof document === "undefined") return null;
  const [w, h, , , d] = p.icon.icon;
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const s = (size * 0.86) / Math.max(w, h);
  ctx.translate((size - w * s) / 2, (size - h * s) / 2);
  ctx.scale(s, s);
  ctx.fillStyle = "#ffffff";
  ctx.fill(new Path2D(Array.isArray(d) ? d.join(" ") : d));
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function Disc({ node, position, reduced }: { node: SceneNode; position: [number, number, number]; reduced: boolean }) {
  const ref = useRef<THREE.Group>(null);
  const [hover, setHover] = useState(false);
  const router = useRouter();
  const tex = useMemo(() => glyphTexture(node.id), [node.id]);
  const tint = useMemo(() => {
    const c = new THREE.Color(platformById(node.id)?.tint ?? "#5b6574");
    if (!node.connected) {
      const hsl = { h: 0, s: 0, l: 0 };
      c.getHSL(hsl);
      c.setHSL(hsl.h, hsl.s * 0.12, 0.2);
    }
    return c;
  }, [node.id, node.connected]);
  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;
    if (!reduced && node.connected) g.position.y = position[1] + Math.sin(clock.elapsedTime * 0.9 + position[0] * 1.7) * 0.1;
    const target = hover ? 1.18 : 1;
    g.scale.setScalar(reduced ? target : THREE.MathUtils.lerp(g.scale.x, target, 0.16));
  });
  return (
    <group
      ref={ref}
      position={position}
      onPointerOver={(e) => { e.stopPropagation(); setHover(true); document.body.style.cursor = "pointer"; }}
      onPointerOut={() => { setHover(false); document.body.style.cursor = ""; }}
      onClick={(e) => { e.stopPropagation(); document.body.style.cursor = ""; router.push(node.href); }}
    >
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.5, 0.5, 0.12, 56]} />
        <meshStandardMaterial color="#dfe4ec" metalness={1} roughness={0.16} />
      </mesh>
      <mesh position={[0, 0, 0.062]}>
        <circleGeometry args={[0.42, 56]} />
        <meshStandardMaterial color={tint} metalness={0.3} roughness={0.38} emissive={tint} emissiveIntensity={node.connected ? 0.45 : 0} />
      </mesh>
      {tex && (
        <mesh position={[0, 0, 0.07]}>
          <planeGeometry args={[0.44, 0.44]} />
          <meshBasicMaterial map={tex} transparent opacity={node.connected ? 1 : 0.5} toneMapped={false} />
        </mesh>
      )}
    </group>
  );
}

function Core({ reduced, lit }: { reduced: boolean; lit: boolean }) {
  const g = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (!g.current || reduced) return;
    g.current.rotation.y += dt * 0.22;
    g.current.rotation.x += dt * 0.07;
  });
  return (
    <group ref={g}>
      <mesh>
        <icosahedronGeometry args={[1.3, 1]} />
        <meshStandardMaterial color="#d5dbe5" emissive="#8793a8" emissiveIntensity={0.55} metalness={1} roughness={0.2} wireframe />
      </mesh>
      <mesh>
        <icosahedronGeometry args={[0.84, 2]} />
        <meshStandardMaterial color="#241f47" emissive="#9d8cff" emissiveIntensity={lit ? 1.15 : 0.3} metalness={0.7} roughness={0.22} flatShading />
      </mesh>
    </group>
  );
}

function Rig({ nodes, reduced }: { nodes: SceneNode[]; reduced: boolean }) {
  const group = useRef<THREE.Group>(null);
  const viewport = useThree((s) => s.viewport);
  const scale = Math.min(1, viewport.width / 10.4, viewport.height / 6.7);
  const placed = useMemo(
    () => nodes.map((n, i) => {
      const a = (i / nodes.length) * Math.PI * 2 - Math.PI / 2;
      return { n, pos: [Math.cos(a) * 4.2, Math.sin(a) * 2.55, Math.sin(i * 2.1) * 0.55] as [number, number, number] };
    }),
    [nodes],
  );
  useFrame(({ pointer }) => {
    if (!group.current || reduced) return;
    group.current.rotation.y = THREE.MathUtils.lerp(group.current.rotation.y, pointer.x * 0.22, 0.05);
    group.current.rotation.x = THREE.MathUtils.lerp(group.current.rotation.x, -pointer.y * 0.14, 0.05);
  });
  return (
    <group ref={group} scale={scale}>
      <Core reduced={reduced} lit={nodes.some((n) => n.connected)} />
      {placed.filter(({ n }) => n.connected).map(({ n, pos }) => (
        <Line key={`l-${n.id}`} points={[[0, 0, 0], pos]} color={platformById(n.id)?.tint === "#14161b" ? "#cfd6e0" : platformById(n.id)?.tint ?? "#cfd6e0"} lineWidth={1.6} transparent opacity={0.7} />
      ))}
      {placed.map(({ n, pos }) => <Disc key={n.id} node={n} position={pos} reduced={reduced} />)}
    </group>
  );
}

export default function ConstellationScene({ nodes, reduced }: { nodes: SceneNode[]; reduced: boolean }) {
  return (
    <Canvas dpr={[1, 1.75]} camera={{ position: [0, 0, 9.5], fov: 38 }} frameloop={reduced ? "demand" : "always"} gl={{ antialias: true, alpha: true, powerPreference: "low-power" }} aria-hidden>
      <ambientLight intensity={0.35} />
      <directionalLight position={[4, 6, 6]} intensity={1.4} />
      <Environment resolution={128}>
        <Lightformer form="rect" intensity={3.2} position={[0, 5, 3]} scale={[10, 3, 1]} />
        <Lightformer form="rect" intensity={1.6} position={[-6, 0, 2]} scale={[2, 8, 1]} color="#c7d2ff" />
        <Lightformer form="rect" intensity={1.8} position={[6, -1, 2]} scale={[2, 8, 1]} color="#9d8cff" />
        <Lightformer form="rect" intensity={0.8} position={[0, -5, 1]} scale={[10, 2, 1]} />
      </Environment>
      <Rig nodes={nodes} reduced={reduced} />
    </Canvas>
  );
}
