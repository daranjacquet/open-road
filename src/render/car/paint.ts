import * as THREE from 'three';

/**
 * Adjust the Blender materials for real-time use:
 * - painted panels are double sided, with dark back faces (so a torn-off panel shows a hollow shell),
 *   and read a per-vertex `scuff` attribute that blends paint into scraped primer/bare metal;
 * - glass and lenses are transparent without depth writes; mesh grilles use alpha testing.
 */
export function tunePaint(m: THREE.Material): void {
  if (m.userData['tuned']) return;
  m.userData['tuned'] = true;
  const name = m.name;
  const std = m as THREE.MeshStandardMaterial;
  if (name === 'paint' || name === 'carbon') {
    m.side = THREE.DoubleSide;
    m.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float scuff;\nvarying float vScuff;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvScuff = scuff;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vScuff;')
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
          float sc = clamp(vScuff, 0.0, 1.0);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.26, 0.27, 0.29), sc);
          roughnessFactor = mix(roughnessFactor, 0.75, sc);
          if (!gl_FrontFacing) diffuseColor.rgb *= 0.12;`,
        )
        .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.55, clamp(vScuff, 0.0, 1.0));');
      if ((m as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial) {
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <lights_physical_fragment>',
          '#include <lights_physical_fragment>\nmaterial.clearcoat *= (1.0 - clamp(vScuff, 0.0, 1.0));',
        );
      }
    };
    m.customProgramCacheKey = () => 'paint-scuff-' + name;
  } else if (/glass|lens/.test(name)) {
    m.transparent = true;
    m.depthWrite = false;
    m.side = THREE.DoubleSide;
    if (name.startsWith('glass') && std.opacity >= 1) std.opacity = 0.45;
  } else if (name === 'honeycomb') {
    m.transparent = false;
    m.alphaTest = 0.5;
    m.side = THREE.DoubleSide;
  } else if (name === 'gap' || name === 'well' || name === 'underbody' || name === 'trim_gloss' || name === 'trim_matte') {
    m.side = THREE.DoubleSide;
  }
  if (std.emissive && std.emissiveIntensity > 0 && /led/.test(name)) std.toneMapped = true;
}

export interface CrackUniforms {
  uCrack: { value: number };
  uCrackCenter: { value: THREE.Vector3 };
  uCrackBasis: { value: THREE.Matrix3 };
}

/**
 * Give a glass material a spider-web crack overlay (radial cracks and rings around an impact point),
 * driven by uniforms the damage code sets. Returns the uniforms.
 */
export function makeCrackable(m: THREE.Material, normal: THREE.Vector3): CrackUniforms {
  const n = normal.clone().normalize();
  const t = Math.abs(n.y) < 0.9 ? new THREE.Vector3(0, 1, 0).cross(n).normalize() : new THREE.Vector3(1, 0, 0).cross(n).normalize();
  const b = n.clone().cross(t);
  const u: CrackUniforms = {
    uCrack: { value: 0 },
    uCrackCenter: { value: new THREE.Vector3() },
    uCrackBasis: { value: new THREE.Matrix3().set(t.x, t.y, t.z, b.x, b.y, b.z, n.x, n.y, n.z) },
  };
  m.onBeforeCompile = (shader) => {
    shader.uniforms['uCrack'] = u.uCrack;
    shader.uniforms['uCrackCenter'] = u.uCrackCenter;
    shader.uniforms['uCrackBasis'] = u.uCrackBasis;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLocalPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocalPos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uCrack;\nuniform vec3 uCrackCenter;\nuniform mat3 uCrackBasis;\nvarying vec3 vLocalPos;')
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
        if (uCrack > 0.0) {
          vec3 q = uCrackBasis * (vLocalPos - uCrackCenter);
          float r = length(q.xy);
          float a = atan(q.y, q.x);
          float wob = sin(r * 31.0 + a * 3.0) * 0.35;
          float rays = smoothstep(0.965, 1.0, abs(sin(a * 7.0 + wob))) + smoothstep(0.985, 1.0, abs(sin(a * 13.0 - wob * 1.7)));
          float rings = smoothstep(0.93, 1.0, abs(sin(r * 26.0 + sin(a * 5.0) * 0.8))) * step(0.03, r);
          float reach = 0.15 + uCrack * 0.9;
          float fall = 1.0 - smoothstep(reach * 0.6, reach, r);
          float crack = clamp(max(rays, rings * 0.8) * fall * min(uCrack * 2.0, 1.0) + (1.0 - smoothstep(0.0, 0.035, r)) * uCrack, 0.0, 1.0);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.86, 0.9, 0.93), crack * 0.85);
          gl_FragColor.a = max(gl_FragColor.a, crack * 0.9);
        }`,
      );
  };
  m.customProgramCacheKey = () => 'glass-crack';
  return u;
}
