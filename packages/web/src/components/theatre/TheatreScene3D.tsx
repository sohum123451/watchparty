'use client';

/**
 * TheatreScene3D Component
 * Performance-first 3D Cinema Auditorium built with React-Three-Fiber:
 * 1. Low-poly stylized theatre with instanced mesh seat rows (minimal draw calls)
 * 2. Member avatars that react to emoji (hop / clap animation) and glow when speaking
 * 3. Volumetric projector beam: additive cone material + animated drifting dust motes
 * 4. Subtle camera pointer parallax
 * 5. Camera "walk in and sit down" sequence driven by anime.js on mount (skippable)
 * 6. devicePixelRatio capped at 1.5, shadows disabled, frameloop paused when tab is hidden
 */

import React, { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { animate, cubicBezier } from 'animejs';

export interface TheatreMember3D {
  id: string;
  name: string;
  avatar: string;
  seatRow: number;
  seatCol: number;
  isSpeaking?: boolean;
  reaction?: 'hop' | 'clap' | null;
}

export interface TheatreScene3DProps {
  members?: TheatreMember3D[];
  walkInComplete?: boolean;
  onWalkInDone?: () => void;
  className?: string;
}


/**
 * Low-Poly Instanced Cinema Seats
 * Uses a single InstancedMesh to draw all 24 theatre seats in 1 draw call!
 */
function InstancedAuditoriumSeats() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const rows = 4;
  const cols = 6;
  const count = rows * cols;

  useEffect(() => {
    if (!meshRef.current) return;
    const dummy = new THREE.Object3D();
    let index = 0;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = (c - (cols - 1) / 2) * 1.15;
        const y = r * 0.35;
        const z = r * 1.25;

        dummy.position.set(x, y, z);
        dummy.scale.set(0.9, 0.85, 0.8);
        dummy.updateMatrix();
        meshRef.current.setMatrixAt(index++, dummy.matrix);
      }
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
  }, [rows, cols]);

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, count]}
      castShadow={false}
      receiveShadow={false}
    >
      <boxGeometry args={[0.75, 0.7, 0.65]} />
      <meshStandardMaterial
        color="#261E19"
        roughness={0.8}
        metalness={0.2}
      />
    </instancedMesh>
  );
}

/**
 * Member Avatar Silhouettes
 * Rendered in their assigned seats. Glows cathode teal when speaking,
 * hops or nods when receiving an emoji reaction!
 */
function MemberAvatarSilhouette({
  member,
}: {
  member: TheatreMember3D;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const [hopY, setHopY] = useState(0);
  const [nodRot, setNodRot] = useState(0);

  // Seat coordinate calculation matching instanced seats
  const posX = (member.seatCol - 2.5) * 1.15;
  const posY = (member.seatRow - 1) * 0.35 + 0.65;
  const posZ = (member.seatRow - 1) * 1.25;

  // Trigger physical 3D hop or clap reaction when member.reaction changes
  useEffect(() => {
    if (!member.reaction) return;

    if (member.reaction === 'hop') {
      const obj = { y: 0 };
      animate(obj, {
        y: [0, 0.45, 0],
        duration: 480,
        ease: cubicBezier(0.16, 1, 0.3, 1),
        onUpdate: () => setHopY(obj.y),
      });
    } else if (member.reaction === 'clap') {
      const obj = { r: 0 };
      animate(obj, {
        r: [0, 0.3, -0.2, 0],
        duration: 520,
        ease: cubicBezier(0.16, 1, 0.3, 1),
        onUpdate: () => setNodRot(obj.r),
      });
    }
  }, [member.reaction]);

  return (
    <group
      ref={groupRef}
      position={[posX, posY + hopY, posZ]}
      rotation={[nodRot, 0, 0]}
    >
      {/* Head Silhouette */}
      <mesh position={[0, 0.38, 0]}>
        <sphereGeometry args={[0.22, 16, 16]} />
        <meshStandardMaterial
          color={member.isSpeaking ? '#2EC4B6' : '#F3E9DC'}
          emissive={member.isSpeaking ? '#2EC4B6' : '#0E0B09'}
          emissiveIntensity={member.isSpeaking ? 1.6 : 0.1}
          roughness={0.4}
        />
      </mesh>

      {/* Torso Silhouette */}
      <mesh position={[0, 0, 0]}>
        <cylinderGeometry args={[0.18, 0.26, 0.45, 12]} />
        <meshStandardMaterial
          color="#1A1512"
          roughness={0.8}
        />
      </mesh>

      {/* Speaking Halo Ring */}
      {member.isSpeaking && (
        <mesh position={[0, 0.68, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.26, 0.34, 24]} />
          <meshBasicMaterial
            color="#2EC4B6"
            side={THREE.DoubleSide}
            transparent
            opacity={0.85}
          />
        </mesh>
      )}
    </group>
  );
}

/**
 * Volumetric Projector Beam (Cheap & High Performance)
 * Lightweight cone with additive blending + drifting dust motes
 */
function VolumetricProjectorBeam() {
  const dustRef = useRef<THREE.Points>(null);
  const dustCount = 75;

  const dustPositions = useMemo(() => {
    const pos = new Float32Array(dustCount * 3);
    for (let i = 0; i < dustCount; i++) {
      // Generate within the projection cone volume
      const t = Math.random();
      const radius = 0.2 + t * 2.2;
      const angle = Math.random() * Math.PI * 2;
      pos[i * 3] = Math.cos(angle) * radius * Math.random();
      pos[i * 3 + 1] = 2.4 - t * 2.8;
      pos[i * 3 + 2] = 5.2 - t * 8.5;
    }
    return pos;
  }, []);

  useFrame((_, delta) => {
    if (dustRef.current) {
      dustRef.current.rotation.z += delta * 0.08;
      dustRef.current.rotation.y += delta * 0.04;
    }
  });

  return (
    <group position={[0, 2.2, -1.2]}>
      {/* Additive Amber Light Cone */}
      <mesh position={[0, 0, 0]} rotation={[0.22, 0, 0]}>
        <cylinderGeometry args={[0.2, 3.8, 12, 16, 1, true]} />
        <meshBasicMaterial
          color="#FF9F1C"
          transparent
          opacity={0.12}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Animated Drifting Dust Motes */}
      <points ref={dustRef}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[dustPositions, 3]}
          />
        </bufferGeometry>
        <pointsMaterial
          size={0.065}
          color="#F3E9DC"
          transparent
          opacity={0.7}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </points>
    </group>
  );
}

/**
 * Camera Controller:
 * 1. "Walk in and sit down" anime.js move on join
 * 2. Pointer parallax
 */
function CameraRig({
  onWalkInDone,
}: {
  onWalkInDone?: () => void;
}) {
  const { camera } = useThree();
  const isWalkingInRef = useRef(true);

  // Cinematic Walk In & Sit Down Move
  useEffect(() => {
    // Initial entrance position (standing in rear aisle)
    camera.position.set(0, 2.6, 7.8);
    camera.lookAt(0, 1.2, -4);

    const animState = {
      x: 0,
      y: 2.6,
      z: 7.8,
      targetY: 1.2,
    };

    const anim = animate(animState, {
      x: [0, 0.25],
      y: [2.6, 1.15],
      z: [7.8, 3.6],
      targetY: [1.2, 1.4],
      duration: 1600,
      ease: cubicBezier(0.42, 0, 0.12, 1),
      onUpdate: () => {
        camera.position.set(animState.x, animState.y, animState.z);
        camera.lookAt(0, animState.targetY, -4);
      },
      onComplete: () => {
        isWalkingInRef.current = false;
        onWalkInDone?.();
      },
    });

    return () => {
      anim.pause();
    };
  }, [camera, onWalkInDone]);

  // Subtle Pointer Parallax
  useFrame((state, delta) => {
    if (isWalkingInRef.current) return;

    // Smooth dampening towards pointer position
    const targetX = 0.25 + state.pointer.x * 0.35;
    const targetY = 1.15 + state.pointer.y * 0.2;

    camera.position.x = THREE.MathUtils.damp(camera.position.x, targetX, 3.5, delta);
    camera.position.y = THREE.MathUtils.damp(camera.position.y, targetY, 3.5, delta);
    camera.lookAt(0, 1.4, -4);
  });

  return null;
}

export function TheatreScene3D({
  members = [],
  onWalkInDone,
  className = '',
}: TheatreScene3DProps) {
  // Pause rendering when tab is hidden to conserve GPU/battery
  const [isTabVisible, setIsTabVisible] = useState(true);

  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsTabVisible(document.visibilityState === 'visible');
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  return (
    <div className={`theatre-scene-3d-wrapper relative w-full h-full overflow-hidden ${className}`}>
      <Canvas
        camera={{ position: [0, 2.6, 7.8], fov: 50 }}
        dpr={[1, 1.5]}
        performance={{ min: 0.5 }}
        frameloop={isTabVisible ? 'always' : 'never'}
        gl={{
          antialias: false,
          alpha: true,
          powerPreference: 'high-performance',
          stencil: false,
          depth: true,
        }}
        shadows={false}
      >
        <ambientLight intensity={0.5} color="#F3E9DC" />
        <pointLight position={[0, 4, 2]} intensity={1.8} color="#FF9F1C" />

        {/* Camera Rig with Walk In & Pointer Parallax */}
        <CameraRig onWalkInDone={onWalkInDone} />

        {/* Instanced Low-Poly Auditorium Seats */}
        <InstancedAuditoriumSeats />

        {/* Member Avatars */}
        {members.map((member) => (
          <MemberAvatarSilhouette key={member.id} member={member} />
        ))}

        {/* Volumetric Projector Beam & Dust */}
        <VolumetricProjectorBeam />

        {/* Front Screen Stage Plane */}
        <mesh position={[0, 1.6, -4.2]}>
          <planeGeometry args={[7.2, 4.05]} />
          <meshBasicMaterial color="#060403" />
        </mesh>
      </Canvas>
    </div>
  );
}

export default TheatreScene3D;
