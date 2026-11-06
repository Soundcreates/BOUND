import { defineConfig } from 'vite';

export default defineConfig({
  // One copy of React, even for libraries that Vite discovers late (@gsap/react).
  resolve: { dedupe: ['react', 'react-dom'] },
  optimizeDeps: { include: ['react', 'react-dom', 'react-dom/client', 'gsap', 'gsap/ScrollTrigger', '@gsap/react', 'konva', 'lenis'] },
  // The simulation imports BOUND's real decoder and policy-core from ../packages.
  server: { fs: { allow: ['..'] } },
});
