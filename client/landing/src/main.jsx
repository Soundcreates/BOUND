import React, { Suspense, lazy, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Lenis from 'lenis';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Logo, Arrow } from './lib/shared.jsx';
import Hero from './hero/Hero.jsx';
import Problem from './problem/Problem.jsx';
import Incidents from './proof/Incidents.jsx';
import Idea from './idea/Idea.jsx';
import Architecture from './arch/Architecture.jsx';
import ToyOS from './toyos/ToyOS.jsx';
import Stack from './stack/Stack.jsx';
import Demo from './demo/Demo.jsx';
import Closing from './closing/Closing.jsx';
import Footer from './footer/Footer.jsx';
import './style.css';

const Testing = lazy(() => import('./testing/Testing.jsx'));

function App() {
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let scrolling;
    // One clock for both: GSAP's ticker drives Lenis, Lenis notifies ScrollTrigger.
    const tick = time => scrolling?.raf(time * 1000);
    const update = () => {
      scrolling?.destroy();
      scrolling = preference.matches ? undefined : new Lenis({ anchors: true });
      scrolling?.on('scroll', ScrollTrigger.update);
    };
    update();
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);
    preference.addEventListener('change', update);
    return () => { preference.removeEventListener('change', update); gsap.ticker.remove(tick); scrolling?.destroy(); };
  }, []);

  return <>
    <a href="#main" className="skip-link">Skip to content</a>
    <main id="main">
      <Hero Logo={Logo} Arrow={Arrow} menu={menu} setMenu={setMenu} />
      <Problem />
      <Incidents />
      <Idea />
      <Architecture />
      <ToyOS />
      <Stack />
      <Demo />
      <Closing />
    </main>
    <Footer />
  </>;
}

const testingRoute = /^\/testing\/?$/.test(window.location.pathname);
createRoot(document.getElementById('root')).render(testingRoute ? <Suspense fallback={<p>Loading testing workbench…</p>}><Testing /></Suspense> : <App />);
