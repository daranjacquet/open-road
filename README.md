# Open Road

A browser driving sandbox focused on **realistic car physics and crash damage**. Flat open world, big test pad, obstacles to wreck cars on. Built with Three.js and Rapier (WASM).

> Status: milestone 1 (skeleton). Driving, damage and models are being built milestone by milestone, see the roadmap below.

**Play:** https://daranjacquet.github.io/open-road/ (after the first GitHub Pages deploy)

## Run locally

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # Vitest unit tests
npm run build      # typecheck + production build in dist/
```

## Roadmap

1. Skeleton: Vite + TypeScript + Three.js + Rapier, fixed 120 Hz step, Pages deploy
2. Driving: raycast suspension, tyre model, engine and gearbox, keyboard and gamepad
3. Car model with named panels
4. Damage v1: procedural dents and mechanical damage
5. Damage v2: detachable parts, glass, repair
6. Test world: obstacles and dynamic props
7. Three distinct cars
8. Polish: audio, HUD, measured performance

## License

MIT
