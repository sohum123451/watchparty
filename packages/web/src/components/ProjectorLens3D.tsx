'use client';

/**
 * 3D Projector Optical Lens & Floating Film Reel
 * Built with Three.js, @react-three/fiber, and @react-three/drei.
 * Encapsulates "The Private Cinema" aesthetic: warm amber projector light, brass rim, velvet depth.
 */

import React, { useRef, useState, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Float } from '@react-three/drei';
import * as THREE from 'three';

function ProjectorReelMesh() {
  const meshRef = useRef<THREE.Group>(null);
  const ringRef = useRef<THREE.Mesh>(null);

  useFrame((_, delta) => {
    if (meshRef.current) {
      meshRef.current.rotation.z += delta * 0.35;
      meshRef.current.rotation.y += delta * 0.15;
    }
    if (ringRef.current) {
      ringRef.current.rotation.z -= delta * 0.2;
    }
  });

  return (
    <group ref={meshRef}>
      {/* Central Brass Optical Cylinder */}
      <mesh>
        <cylinderGeometry args={[1.2, 1.2, 0.4, 32]} />
        <meshStandardMaterial
          color="#261E19"
          roughness={0.25}
          metalness={0.85}
        />
      </mesh>

      {/* Amber Projector Aperture Core */}
      <mesh position={[0, 0, 0.22]}>
        <circleGeometry args={[0.85, 32]} />
        <meshBasicMaterial color="#FF9F1C" />
      </mesh>

      {/* Outer 35mm Sprocket Rim */}
      <mesh ref={ringRef}>
        <ringGeometry args={[1.35, 1.6, 24]} />
        <meshStandardMaterial
          color="#FF9F1C"
          emissive="#FF9F1C"
          emissiveIntensity={0.2}
          roughness={0.3}
          metalness={0.7}
          wireframe
        />
      </mesh>
    </group>
  );
}

export function ProjectorLens3D({ className = '' }: { className?: string }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className={`flex items-center justify-center bg-surface border border-border-brass rounded-sm ${className}`}>
        <div className="w-8 h-8 rounded-full border border-accent animate-pulse" />
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden bg-surface border border-border-brass rounded-sm ${className}`}>
      <Canvas
        camera={{ position: [0, 0, 4.5], fov: 45 }}
        gl={{ antialias: true, alpha: true }}
      >
        <ambientLight intensity={0.6} />
        <pointLight position={[5, 5, 5]} intensity={1.5} color="#FF9F1C" />
        <pointLight position={[-5, -5, -3]} intensity={0.8} color="#2EC4B6" />
        
        <Float speed={2} rotationIntensity={0.4} floatIntensity={0.6}>
          <ProjectorReelMesh />
        </Float>
      </Canvas>
    </div>
  );
}
