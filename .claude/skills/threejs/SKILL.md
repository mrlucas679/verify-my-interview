---
name: threejs
description: Three.js conventions for this repo — 3D visuals for the scam-intelligence graph, demo-video hero shots, and any WebGL flourish in the Sentinel UI. Use when adding/modifying 3D scenes (react-force-graph-2d→3d upgrades, landing hero, demo assets) or when prototyping scenes via the Learn Three.js MCP view. Grounded on Three.js r181.
---

# Three.js (Verify My Interview house rules)

3D is an **enhancement layer** here, never the load-bearing UI: the 2D
evidence graph and report stay the accessible default; 3D is additive
(demo wow-factor, optional graph mode, hero visual).

## Where 3D earns its place in THIS app

1. **Intelligence Network 3D mode** — `react-force-graph-2d` has a `-3d`
   sibling using three.js; same data contract (`/network/*` endpoints, see
   `evidence-graph` skill). Node colors MUST keep entity-type/trust-level
   semantics from the 2D mode.
2. **Demo-video hero** — a slow-rotating network/globe shot for the intro
   beat (see `demo-script`). Prototype in the Learn Three.js MCP view first;
   only port into the app if it survives the impeccable-design review.
3. **NOT for:** charts, score gauges, anything conveying evidence — those
   stay 2D/DOM for accessibility and POPIA-auditable clarity.

## Prototyping loop (dev-time)

Use the **Learn Three.js MCP** (`learn_threejs` for docs, `show_threejs_scene`
to render). Its sandbox provides globals: `THREE` (r181), `canvas`, `width`,
`height`, `OrbitControls`, `EffectComposer`, `RenderPass`, `UnrealBloomPass`.
Iterate there (cheap, visual), then port the proven scene into React.

## Scene conventions (Sentinel-fused)

```javascript
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setSize(width, height);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // perf clamp
renderer.setClearColor(0x000000, 0); // transparent — Sentinel surface shows through
```

- **Palette:** scene colors come from Sentinel tokens — ink background shows
  through the transparent canvas; accents `0x2fbf71` (safe/green),
  `0xf0544f` (risk/red), cyan accent for neutral nodes. No purple-blue fog.
- **Materials/lights:** `MeshStandardMaterial`; one `DirectionalLight`
  (intensity ≤ 1) + low `AmbientLight` (~0x404040). Bloom
  (`UnrealBloomPass`) is allowed ONLY for the demo hero, strength ≤ 0.6.
- **Motion:** slow (≤ 0.2 rad/s), damped `OrbitControls`
  (`enableDamping = true`; call `controls.update()` in the loop). Honor
  `prefers-reduced-motion`: static frame instead of auto-rotation.

## Hard rules (Power-of-10 aligned)

1. **Lifecycle discipline:** every scene tears down — cancel the
   `requestAnimationFrame` loop, `geometry.dispose()`,
   `material.dispose()`, `renderer.dispose()` on unmount (React
   `useEffect` cleanup). Leaked WebGL contexts kill the demo laptop.
2. **Bounded allocation:** create geometries/materials ONCE outside the
   render loop; never allocate per-frame. Cap node count rendered in 3D
   (≤ 500) — beyond that, instanced meshes or stay 2D.
3. **Resize correctly:** observe container size; update
   `camera.aspect` + `camera.updateProjectionMatrix()` + `renderer.setSize`.
4. **Fallback:** feature-detect WebGL; on failure render the 2D graph,
   never a blank panel.
5. **No new heavy deps** (loaders, physics, drei-style kitchen sinks)
   without orchestrator approval — `three` + `react-force-graph-3d` is
   the approved ceiling.
