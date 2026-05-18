/**
 * MurWall3D - Vraie 3D pour la charpente murale legere
 *
 * Rend les pieces calculees par computeWall() en 3D avec three.js
 * via @react-three/fiber + @react-three/drei (OrbitControls).
 *
 * Conventions repere monde (unites = pouces):
 *   X = longueur du mur (gauche -> droite)
 *   Y = hauteur (bas -> haut)
 *   Z = profondeur du mur (avant -> arriere)
 *
 * Le pivot des Box est le centre. On positionne donc chaque piece au
 * centre de son volume (piece.x + piece.w/2, piece.y + piece.h/2, depth/2).
 *
 * Le polygon des top plates inclinees (mode rake) est extrude le long de Z
 * pour donner une vraie geometrie tridimensionnelle.
 *
 * Pas d'emoji. TypeScript strict.
 */

import { useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import {
  computeWall,
  type MurWall,
  type MurOpening,
  type MurPiece,
} from './MursParametriquePanel';

// ============================================
// COULEURS (alignes sur MUR_COLORS du SVG)
// ============================================

const MUR3D_COLORS: Record<MurPiece['kind'], string> = {
  stud: '#E8C77F',
  plate: '#C9A357',
  king: '#E8C77F',
  jack: '#D9583E',
  header: '#F2D27B',
  cripple: '#E8C77F',
  sill: '#C9A357',
  blocking: '#D9A85F',
  extraplate: '#B8923F',
};

// Profondeur reelle (epaisseur perpendiculaire au mur) selon le format
// de montant. Tous les members standard d'une charpente murale ont la
// meme largeur b = 1.5" et profondeur d (3.5" pour 2x4, 5.5" pour 2x6,
// 7.25" pour 2x8). Pour une vue de face le b sort de l'ecran, mais en
// 3D on rend le d comme profondeur Z reelle du mur.
const STUD_DEPTHS: Record<string, number> = {
  '2x4': 3.5,
  '2x6': 5.5,
  '2x8': 7.25,
  '2-2x10': 9.25,
};

function depthFor(size?: string): number {
  if (!size) return 5.5;
  return STUD_DEPTHS[size] ?? 5.5;
}

// ============================================
// PROPS
// ============================================

export interface MurWall3DProps {
  wall: MurWall;
  openings: MurOpening[];
  /**
   * Pieces deja calculees. Si non fourni, MurWall3D appelle computeWall()
   * lui-meme. Pratique pour eviter double calcul cote parent.
   */
  pieces?: MurPiece[];
  /**
   * Hauteur en px du canvas. Defaut 400.
   */
  height?: number;
}

// ============================================
// PIECE 3D
// ============================================

interface PieceMeshProps {
  piece: MurPiece;
}

/**
 * Rend une piece soit en BoxGeometry simple (cas general), soit en
 * ExtrudeGeometry si la piece a un polygone (top plates rake).
 */
function PieceMesh({ piece }: PieceMeshProps) {
  const color = MUR3D_COLORS[piece.kind] ?? '#cccccc';
  const pieceDepth = depthFor(piece.size);
  // Centre Z du mur = 0; chaque piece est centree sur sa propre
  // epaisseur (Z varie selon piece.size: 3.5" pour 2x4, 5.5" pour 2x6,
  // 9.25" pour 2-2x10 d'un linteau).
  const zCenter = 0;

  // ---- Cas polygone (top plate rake) ----
  if (piece.polygon && piece.polygon.length >= 3) {
    return <PolygonExtrudeMesh polygon={piece.polygon} depth={pieceDepth} color={color} zCenter={zCenter} />;
  }

  // ---- Cas rectangulaire standard ----
  // Y inversion: dans le repere SVG, y croit vers le haut deja (le tx/ty
  // du SVG inverse au rendu). Ici on garde y croissant vers le haut.
  const cx = piece.x + piece.w / 2;
  const cy = piece.y + piece.h / 2;

  return (
    <mesh position={[cx, cy, zCenter]} castShadow receiveShadow>
      <boxGeometry args={[piece.w, piece.h, pieceDepth]} />
      <meshStandardMaterial color={color} roughness={0.75} metalness={0.05} />
    </mesh>
  );
}

// ============================================
// POLYGON EXTRUDE
// ============================================

interface PolygonExtrudeMeshProps {
  polygon: { x: number; y: number }[];
  depth: number;
  color: string;
  zCenter: number;
}

/**
 * Construit un Shape three.js a partir des points 2D et l'extrude le
 * long de Z pour creer une plaque inclinee 3D (rake top plate).
 *
 * La geometrie est memoisee via useMemo + dispose au demontage. Note:
 * react-three-fiber dispose automatiquement les BufferGeometry inline,
 * mais on memoise pour eviter de reconstruire a chaque render.
 */
function PolygonExtrudeMesh({ polygon, depth, color, zCenter }: PolygonExtrudeMeshProps) {
  const geometry = useMemo(() => {
    const shape = new THREE.Shape();
    polygon.forEach((pt, i) => {
      if (i === 0) shape.moveTo(pt.x, pt.y);
      else shape.lineTo(pt.x, pt.y);
    });
    shape.closePath();
    const extrudeSettings: THREE.ExtrudeGeometryOptions = {
      depth,
      bevelEnabled: false,
    };
    const geo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    // Centrer la piece sur Z = zCenter (l'extrude part de Z=0 et va
    // jusqu'a Z=depth, donc on translate de -depth/2).
    geo.translate(0, 0, -depth / 2 + zCenter);
    return geo;
  }, [polygon, depth, zCenter]);

  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial color={color} roughness={0.75} metalness={0.05} />
    </mesh>
  );
}

// ============================================
// SCENE (lumieres + sol + mur)
// ============================================

interface SceneProps {
  pieces: MurPiece[];
  wallLength: number;
  wallTotalH: number;
}

function Scene({ pieces, wallLength, wallTotalH }: SceneProps) {
  return (
    <>
      {/* Lumiere ambiante douce */}
      <ambientLight intensity={0.55} />
      {/* Lumiere directionnelle principale (soleil) */}
      <directionalLight
        position={[wallLength * 1.2, wallTotalH * 1.8, wallLength * 1.0]}
        intensity={0.9}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      {/* Lumiere d'appoint cote oppose pour adoucir les ombres */}
      <directionalLight
        position={[-wallLength * 0.6, wallTotalH * 0.6, -wallLength * 0.5]}
        intensity={0.3}
      />

      {/* Sol (plancher gris). Y=0 = base du mur. */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[wallLength / 2, -0.5, 0]}
        receiveShadow
      >
        <planeGeometry args={[wallLength * 3, wallLength * 3]} />
        <meshStandardMaterial color="#9ca3af" roughness={0.95} />
      </mesh>

      {/* Pieces de la charpente */}
      {pieces.map((p, i) => (
        <PieceMesh key={`p-${i}`} piece={p} />
      ))}

      {/* Helper: axe du sol pour orientation visuelle (subtil) */}
      <gridHelper
        args={[wallLength * 2, 12, '#cbd5e1', '#e5e7eb']}
        position={[wallLength / 2, -0.49, 0]}
      />
    </>
  );
}

// ============================================
// COMPOSANT PRINCIPAL
// ============================================

export default function MurWall3D({ wall, openings, pieces: piecesProp, height = 400 }: MurWall3DProps) {
  // Calcul si non fourni
  const computed = useMemo(() => {
    if (piecesProp) return null;
    return computeWall(wall, openings);
  }, [wall, openings, piecesProp]);

  const pieces = piecesProp ?? computed?.pieces ?? [];

  // Hauteur totale du mur (max entre Y top des pieces et studHeight + plates)
  const wallTotalH = useMemo(() => {
    let maxY = wall.studHeight + 4.5;
    for (const p of pieces) {
      const top = p.polygon
        ? Math.max(...p.polygon.map((pt) => pt.y))
        : p.y + p.h;
      if (top > maxY) maxY = top;
    }
    return maxY;
  }, [pieces, wall.studHeight]);

  // Camera: positionnee en avant + au dessus, regardant le centre du mur.
  // X=center du mur, Y=mi-hauteur, Z=devant le mur.
  const cameraPosition: [number, number, number] = useMemo(() => {
    const dist = Math.max(wall.length, wallTotalH) * 1.4;
    return [wall.length / 2 + dist * 0.3, wallTotalH * 0.7, dist];
  }, [wall.length, wallTotalH]);

  const cameraTarget: [number, number, number] = useMemo(
    () => [wall.length / 2, wallTotalH / 2, 0],
    [wall.length, wallTotalH],
  );

  return (
    <div
      className="w-full bg-gradient-to-b from-sky-100 to-gray-200 rounded-md overflow-hidden"
      style={{ height }}
    >
      <Canvas
        shadows
        camera={{
          position: cameraPosition,
          fov: 45,
          near: 0.1,
          far: Math.max(wall.length, wallTotalH) * 10,
        }}
        gl={{ antialias: true, alpha: false }}
      >
        <color attach="background" args={['#e0f2fe']} />
        <Scene
          pieces={pieces}
          wallLength={wall.length}
          wallTotalH={wallTotalH}
        />
        <OrbitControls
          target={cameraTarget}
          enableDamping
          dampingFactor={0.08}
          minDistance={Math.max(wall.length, wallTotalH) * 0.3}
          maxDistance={Math.max(wall.length, wallTotalH) * 5}
          maxPolarAngle={Math.PI / 2 + 0.1}
        />
      </Canvas>
    </div>
  );
}
