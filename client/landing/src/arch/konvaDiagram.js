// Framework-free Konva diagram controller. GSAP drives every animated value; Konva only draws.
// React owns the DOM around it (src/arch/Architecture.jsx) and talks to this through a handful of methods.
import Konva from 'konva';
import gsap from 'gsap';
import { NODES, STEPS, layoutFor } from './model.js';

const C = { paper: '#ffffff', ink: '#0b0b0c', muted: '#6b6b64', line: '#d4d4cc', zone: '#ecece6', accent: '#ffd500', soft: '#fff4b8', danger: '#d9381e' };
const SERIF = '"Instrument Serif", Georgia, serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const mix = (a, b, t) => { const [x, y] = [rgb(a), rgb(b)]; return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(',')})`; };
const flat = (pts) => pts.flat();
const segLen = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** Point at fraction t (0..1) along a polyline, plus the angle of that segment. */
function along(points, t) {
  const lens = points.slice(1).map((p, i) => segLen(points[i], p));
  let d = t * lens.reduce((s, v) => s + v, 0);
  for (let i = 0; i < lens.length; i++) {
    if (d <= lens[i] || i === lens.length - 1) {
      const k = lens[i] ? Math.min(d / lens[i], 1) : 0;
      return [points[i][0] + (points[i + 1][0] - points[i][0]) * k, points[i][1] + (points[i + 1][1] - points[i][1]) * k];
    }
    d -= lens[i];
  }
  return points[0];
}
const pathLength = (points) => points.slice(1).reduce((s, p, i) => s + segLen(points[i], p), 0);

export class Diagram {
  constructor(el, { onSelect, reduced = false } = {}) {
    this.el = el; this.onSelect = onSelect; this.reduced = reduced;
    this.stepIndex = 0; this.selected = null; this.mode = null; this.dirty = false; this.introduced = false;
    this.stage = new Konva.Stage({ container: el, width: Math.max(el.clientWidth, 280), height: 400 });
    this.layer = new Konva.Layer();
    this.stage.add(this.layer);
    this.tick = () => { if (this.dirty) { this.dirty = false; this.layer.batchDraw(); } };
    gsap.ticker.add(this.tick);
    this.resizer = new ResizeObserver(() => this.resize());
    this.resizer.observe(el);
    this.build(this.modeFor(el.clientWidth));
    // Konva measures text once. Redraw after the serif loads so nothing is laid out with the fallback.
    document.fonts?.load('18px "Instrument Serif"').then(() => this.build(this.mode, true));
  }

  modeFor(width) { return width < 600 ? 'narrow' : 'wide'; }

  resize() {
    const width = this.el.clientWidth;
    if (!width) return;
    const mode = this.modeFor(width);
    if (mode !== this.mode) this.build(mode, true);
    else this.fit();
  }

  fit() {
    const scale = Math.min(this.el.clientWidth / this.lay.width, 1.15);
    this.stage.width(this.lay.width * scale);
    this.stage.height(this.lay.height * scale);
    this.layer.scale({ x: scale, y: scale });
    this.el.style.height = `${this.lay.height * scale}px`;
    this.dirty = true;
  }

  clear() {
    this.tweens?.forEach((t) => t.kill());
    this.tweens = [];
    this.layer.destroyChildren();
    this.nodes = {}; this.edges = {};
  }

  build(mode, keepState = false) {
    this.clear();
    this.mode = mode;
    this.lay = layoutFor(mode);
    const { zones, boxes, edges, labelAt } = this.lay;

    for (const z of zones) {
      const g = new Konva.Group({ listening: false });
      g.add(new Konva.Rect({ x: z.x, y: z.y, width: z.w, height: z.h, cornerRadius: 18, fill: z.accent ? 'rgba(255,244,184,0.28)' : 'rgba(11,11,12,0.018)', stroke: z.accent ? C.ink : C.zone, strokeWidth: z.accent ? 1 : 1, dash: z.accent ? [] : [5, 5] }));
      g.add(new Konva.Text({ x: z.x + 16, y: z.y + 10, text: z.label.toUpperCase(), fontFamily: MONO, fontSize: 9.5, letterSpacing: 1.2, fill: z.accent ? C.ink : C.muted }));
      this.layer.add(g);
    }

    for (const [id, pts] of Object.entries(edges)) {
      const arrow = new Konva.Arrow({ points: flat(pts), stroke: C.line, fill: C.line, strokeWidth: 1.3, pointerLength: 7, pointerWidth: 7, lineJoin: 'round', lineCap: 'round', dash: id === 'direct' ? [5, 5] : [], listening: false });
      const label = new Konva.Text({ text: '', fontFamily: MONO, fontSize: 9.5, fill: C.ink, opacity: 0, listening: false, ...(labelAt[id] ? { x: labelAt[id][0], y: labelAt[id][1] } : { visible: false }) });
      const packet = new Konva.Rect({ width: 8, height: 8, offsetX: 4, offsetY: 4, rotation: 45, fill: C.accent, stroke: C.ink, strokeWidth: 1.2, opacity: 0, listening: false });
      this.layer.add(arrow, label, packet);
      const e = { id, pts, arrow, label, packet, s: { on: 0, danger: 0 }, t: { v: 0 } };
      e.run = gsap.to(e.t, { v: 1, duration: Math.max(0.9, pathLength(pts) / 190), ease: 'none', repeat: -1, paused: true, onUpdate: () => { const [x, y] = along(pts, e.t.v); packet.position({ x, y }); this.dirty = true; } });
      this.tweens.push(e.run);
      this.edges[id] = e;
    }

    for (const [id, box] of Object.entries(boxes)) {
      const def = NODES[id];
      const g = new Konva.Group({ x: box.x, y: box.y, name: id });
      const ink = def.kind === 'ink';
      const rect = new Konva.Rect({ width: box.w, height: box.h, cornerRadius: 13, fill: ink ? C.ink : C.paper, stroke: C.ink, strokeWidth: 1.2, dash: def.kind === 'untrusted' ? [5, 4] : [], shadowColor: C.accent, shadowBlur: 0, shadowOpacity: 0.9 });
      const title = new Konva.Text({ x: 14, y: 11, text: def.title, fontFamily: SERIF, fontSize: this.lay.mode === 'narrow' ? 21 : 19, fill: ink ? '#fff' : C.ink });
      const sub = new Konva.Text({ x: 14, y: box.h - 20, text: def.sub, fontFamily: MONO, fontSize: 9, fill: ink ? 'rgba(255,255,255,0.7)' : C.muted });
      g.add(rect, title, sub);
      if (def.kind === 'bound') g.add(new Konva.Rect({ x: box.w - 20, y: 11, width: 8, height: 8, rotation: 45, offsetX: 4, offsetY: 4, fill: C.accent, stroke: C.ink, strokeWidth: 1 }));
      g.on('mouseenter', () => { this.el.style.cursor = 'pointer'; });
      g.on('mouseleave', () => { this.el.style.cursor = ''; });
      g.on('click tap', () => this.select(id));
      this.layer.add(g);
      this.nodes[id] = { id, def, box, g, rect, title, sub, ink, s: { on: 0, sel: 0, appear: this.introduced || this.reduced ? 1 : 0 } };
    }

    this.fit();
    for (const n of Object.values(this.nodes)) this.paintNode(n);
    for (const e of Object.values(this.edges)) this.paintEdge(e);
    this.applyStep(this.stepIndex, true);
    if (keepState && this.selected) this.nodes[this.selected] && this.tweenSel(this.nodes[this.selected], 1, true);
  }

  paintNode(n) {
    const { on, sel, appear } = n.s;
    n.g.opacity(appear * (0.4 + 0.6 * on));
    n.g.y(n.box.y + (1 - appear) * 14);
    n.rect.fill(n.ink ? mix(C.ink, '#26262a', on) : mix(C.paper, C.soft, on));
    n.rect.strokeWidth(1.2 + on * 0.8 + sel * 1.4);
    n.rect.shadowBlur(on * 16 + sel * 10);
    this.dirty = true;
  }

  paintEdge(e) {
    const { on, danger } = e.s;
    const stroke = danger ? mix(mix(C.line, C.ink, on), C.danger, danger) : mix(C.line, C.ink, on);
    e.arrow.stroke(stroke); e.arrow.fill(stroke);
    e.arrow.strokeWidth(1.3 + on * 1.1);
    e.label.opacity(on); e.label.fill(danger ? C.danger : C.ink);
    e.packet.opacity(on);
    e.packet.fill(danger > 0.5 ? C.danger : C.accent);
    this.dirty = true;
  }

  to(obj, vars, paint) {
    if (this.reduced) { Object.assign(obj, Object.fromEntries(Object.entries(vars).filter(([k]) => k in obj))); paint(); return; }
    this.tweens.push(gsap.to(obj, { ...vars, onUpdate: paint, overwrite: 'auto' }));
  }

  applyStep(index, instant = false) {
    const step = STEPS[index];
    for (const n of Object.values(this.nodes)) {
      const target = step.nodes.includes(n.id) ? 1 : 0;
      if (instant || this.reduced) { n.s.on = target; this.paintNode(n); }
      else this.to(n.s, { on: target, duration: 0.55, ease: 'power2.out' }, () => this.paintNode(n));
    }
    for (const e of Object.values(this.edges)) {
      const active = step.edges.includes(e.id);
      const danger = step.danger?.includes(e.id) ? 1 : 0;
      if (this.lay.labelAt[e.id]) e.label.text(step.labels?.[e.id] ?? '');
      if (instant || this.reduced) { e.s.on = active ? 1 : 0; e.s.danger = danger; this.paintEdge(e); }
      else {
        this.to(e.s, { on: active ? 1 : 0, danger, duration: 0.5, ease: 'power2.out' }, () => this.paintEdge(e));
      }
      if (active && !this.reduced) e.run.play(); else { e.run.pause(); e.packet.opacity(0); }
      if (this.reduced && active) { const [x, y] = along(e.pts, 0.5); e.packet.position({ x, y }); e.packet.opacity(1); }
    }
    this.dirty = true;
  }

  setStep(index) {
    if (index === this.stepIndex && this.nodes) { /* still reapply: cheap, idempotent */ }
    this.stepIndex = index;
    this.applyStep(index);
  }

  tweenSel(n, v, instant) {
    if (instant || this.reduced) { n.s.sel = v; this.paintNode(n); return; }
    this.to(n.s, { sel: v, duration: 0.35, ease: 'power2.out' }, () => this.paintNode(n));
  }

  select(id) {
    if (this.selected && this.nodes[this.selected]) this.tweenSel(this.nodes[this.selected], 0);
    this.selected = id;
    if (id && this.nodes[id]) this.tweenSel(this.nodes[id], 1);
    this.onSelect?.(id);
  }

  /** Staggered entrance. Called once, when the diagram scrolls into view. */
  intro() {
    if (this.introduced) return;
    this.introduced = true;
    const list = Object.values(this.nodes);
    if (this.reduced) { list.forEach((n) => { n.s.appear = 1; this.paintNode(n); }); return; }
    this.tweens.push(gsap.to(list.map((n) => n.s), { appear: 1, duration: 0.9, ease: 'expo.out', stagger: 0.07, onUpdate: () => list.forEach((n) => this.paintNode(n)), onComplete: () => { Object.values(this.nodes).forEach((n) => { n.s.appear = 1; this.paintNode(n); }); } }));
  }

  destroy() {
    gsap.ticker.remove(this.tick);
    this.resizer.disconnect();
    this.tweens?.forEach((t) => t.kill());
    this.stage.destroy();
  }
}
