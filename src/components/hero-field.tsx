import { useEffect, useRef } from "react";
import "./hero-field.css";

/**
 * Campo do topo da página inicial: lavoura que cresce, gado caminhando e colinas que se mexem de leve ao rolar.
 * Só SVG + CSS (poucos KB). Sem animação para quem desligou animações no aparelho.
 */
export function HeroField() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches || window.innerWidth < 900) return;
    const layers = Array.from(root.querySelectorAll<SVGGElement>("[data-p]"));
    let raf = 0;
    const update = () => {
      raf = 0;
      const y = Math.min(window.scrollY, 600);
      for (const l of layers) l.style.transform = `translateY(${(y * Number(l.dataset.p)) * 0.18}px)`;
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); if (raf) cancelAnimationFrame(raf); };
  }, []);

  return (
    <div ref={ref} className="hf">
      <svg viewBox="0 0 1200 360" preserveAspectRatio="xMidYMax slice" role="img" aria-label="Lavoura e gado numa fazenda ao amanhecer">
<defs><g id="hf-nelore">
<linearGradient id="hf-hide" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="oklch(0.97 0.008 90)"/><stop offset="0.65" stopColor="oklch(0.9 0.012 85)"/><stop offset="1" stopColor="oklch(0.78 0.02 80)"/></linearGradient>
<g className="hf-bob">
<ellipse cx="66" cy="88" rx="50" ry="4" className="hf-shadow"/>
<g className="hf-tail"><path d="M20 34 C8 38 6 54 10 66" className="hf-tailline"/><ellipse cx="10" cy="68" rx="3.2" ry="6" className="hf-tuft"/></g>
<g className="hf-leg b" style={{ transformOrigin: "34px 54px" }}><path d="M29 50 L39 50 L37 81 L31 81Z" className="hf-limb"/><rect x="30" y="80" width="8" height="6" rx="2" className="hf-hoof"/></g>
<g className="hf-leg" style={{ transformOrigin: "48px 54px" }}><path d="M43 50 L53 50 L51 81 L45 81Z" className="hf-limb"/><rect x="44" y="80" width="8" height="6" rx="2" className="hf-hoof"/></g>
<g className="hf-body">
<ellipse cx="58" cy="43" rx="44" ry="21" fill="url(#hf-hide)"/>
<ellipse cx="82" cy="28" rx="15" ry="12" fill="url(#hf-hide)"/>
<ellipse cx="90" cy="38" rx="17" ry="18" className="hf-neck"/>
<path d="M82 52 C86 62 94 62 100 54 C98 58 90 66 82 60Z" className="hf-dewlap"/>
<ellipse cx="56" cy="58" rx="28" ry="7" className="hf-belly"/>
</g>
<g className="hf-leg b" style={{ transformOrigin: "86px 54px" }}><path d="M81 50 L91 50 L89 81 L83 81Z" className="hf-limb"/><rect x="82" y="80" width="8" height="6" rx="2" className="hf-hoof"/></g>
<g className="hf-leg" style={{ transformOrigin: "100px 54px" }}><path d="M95 50 L105 50 L103 81 L97 81Z" className="hf-limb"/><rect x="96" y="80" width="8" height="6" rx="2" className="hf-hoof"/></g>
<g className="hf-head" style={{ transformOrigin: "98px 36px" }}>
<path d="M96 28 C110 25 124 34 134 52 C137 58 132 64 124 63 C112 62 100 52 94 40Z" className="hf-face"/>
<ellipse cx="131" cy="58" rx="6" ry="5" className="hf-muzzle"/>
<circle cx="116" cy="39" r="1.9" className="hf-eye"/>
<ellipse cx="100" cy="42" rx="12" ry="4.2" transform="rotate(72 100 42)" className="hf-ear"/>
<path d="M103 28 C102 22 104 20 107 19" className="hf-horn"/>
</g>
</g></g><linearGradient id="hf-sky-grad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="oklch(0.99 0.01 110)"/><stop offset="1" stopColor="oklch(0.95 0.06 120)"/></linearGradient></defs>
<rect className="hf-sky" width="1200" height="360"/>
<circle className="hf-sun" cx="960" cy="110" r="46"/>
<g className="hf-parallax" data-p="0.15"><g className="hf-clouds"><g className="hf-cloud"><ellipse cx="200" cy="70" rx="46" ry="14"/><ellipse cx="230" cy="62" rx="30" ry="12"/></g><g className="hf-cloud"><ellipse cx="620" cy="46" rx="56" ry="14"/><ellipse cx="650" cy="38" rx="32" ry="12"/></g></g></g>
<g className="hf-parallax" data-p="0.25"><path className="hf-hill-far" d="M0 200 C150 150 300 190 450 170 C620 148 760 196 920 168 C1040 150 1130 176 1200 164 V360 H0Z"/></g>
<g className="hf-parallax" data-p="0.4"><path className="hf-hill-mid" d="M0 232 C180 196 340 236 520 214 C700 192 860 238 1040 212 C1120 202 1170 214 1200 208 V360 H0Z"/>
<g className="hf-herd"><use href="#hf-nelore" transform="translate(0 150) scale(0.95)" style={{ "--d": "0s" } as React.CSSProperties} /><use href="#hf-nelore" transform="translate(150 166) scale(0.8)" style={{ "--d": "-0.7s" } as React.CSSProperties} /><use href="#hf-nelore" transform="translate(285 190) scale(0.48)" style={{ "--d": "-1.3s" } as React.CSSProperties} /></g></g>
<g className="hf-parallax" data-p="0.6"><path className="hf-hill-near" d="M0 262 C200 238 380 270 600 252 C820 234 1000 270 1200 246 V360 H0Z"/>
<g className="hf-herd slow"><use href="#hf-nelore" transform="translate(0 196) scale(0.7)" style={{ "--d": "-0.4s" } as React.CSSProperties} /><use href="#hf-nelore" transform="translate(125 206) scale(0.58)" style={{ "--d": "-1.1s" } as React.CSSProperties} /></g></g>
<path className="hf-ground" d="M0 290 C240 276 480 296 720 284 C960 272 1100 292 1200 282 V360 H0Z"/>
<path className="hf-row" d="M0 262 L-720 360"/><path className="hf-row" d="M100 262 L-500 360"/><path className="hf-row" d="M200 262 L-280 360"/><path className="hf-row" d="M300 262 L-60 360"/><path className="hf-row" d="M400 262 L160 360"/><path className="hf-row" d="M500 262 L380 360"/><path className="hf-row" d="M600 262 L600 360"/><path className="hf-row" d="M700 262 L820 360"/><path className="hf-row" d="M800 262 L1040 360"/><path className="hf-row" d="M900 262 L1260 360"/><path className="hf-row" d="M1000 262 L1480 360"/><path className="hf-row" d="M1100 262 L1700 360"/><path className="hf-row" d="M1200 262 L1920 360"/>
<g><g transform="translate(60 0)"><g className="hf-plant" style={{ "--i": 0 } as React.CSSProperties}><path className="hf-stem" d="M0 330 V292"/><path className="hf-leaf" d="M0 306 C-16 304 -22 292 -24 284 C-10 286 -2 294 0 306Z"/><path className="hf-leaf" d="M0 298 C16 296 22 284 24 276 C10 278 2 286 0 298Z"/><ellipse className="hf-grain" cx="0" cy="288" rx="4" ry="7"/></g></g><g transform="translate(132 0)"><g className="hf-plant" style={{ "--i": 1 } as React.CSSProperties}><path className="hf-stem" d="M0 330 V292"/><path className="hf-leaf" d="M0 306 C-16 304 -22 292 -24 284 C-10 286 -2 294 0 306Z"/><path className="hf-leaf" d="M0 298 C16 296 22 284 24 276 C10 278 2 286 0 298Z"/></g></g><g transform="translate(204 0)"><g className="hf-plant" style={{ "--i": 2 } as React.CSSProperties}><path className="hf-stem" d="M0 330 V292"/><path className="hf-leaf" d="M0 306 C-16 304 -22 292 -24 284 C-10 286 -2 294 0 306Z"/><path className="hf-leaf" d="M0 298 C16 296 22 284 24 276 C10 278 2 286 0 298Z"/></g></g><g transform="translate(276 0)"><g className="hf-plant" style={{ "--i": 3 } as React.CSSProperties}><path className="hf-stem" d="M0 330 V292"/><path className="hf-leaf" d="M0 306 C-16 304 -22 292 -24 284 C-10 286 -2 294 0 306Z"/><path className="hf-leaf" d="M0 298 C16 296 22 284 24 276 C10 278 2 286 0 298Z"/><ellipse className="hf-grain" cx="0" cy="288" rx="4" ry="7"/></g></g><g transform="translate(348 0)"><g className="hf-plant" style={{ "--i": 4 } as React.CSSProperties}><path className="hf-stem" d="M0 330 V292"/><path className="hf-leaf" d="M0 306 C-16 304 -22 292 -24 284 C-10 286 -2 294 0 306Z"/><path className="hf-leaf" d="M0 298 C16 296 22 284 24 276 C10 278 2 286 0 298Z"/></g></g><g transform="translate(420 0)"><g className="hf-plant" style={{ "--i": 5 } as React.CSSProperties}><path className="hf-stem" d="M0 330 V292"/><path className="hf-leaf" d="M0 306 C-16 304 -22 292 -24 284 C-10 286 -2 294 0 306Z"/><path className="hf-leaf" d="M0 298 C16 296 22 284 24 276 C10 278 2 286 0 298Z"/></g></g><g transform="translate(492 0)"><g className="hf-plant" style={{ "--i": 6 } as React.CSSProperties}><path className="hf-stem" d="M0 330 V292"/><path className="hf-leaf" d="M0 306 C-16 304 -22 292 -24 284 C-10 286 -2 294 0 306Z"/><path className="hf-leaf" d="M0 298 C16 296 22 284 24 276 C10 278 2 286 0 298Z"/><ellipse className="hf-grain" cx="0" cy="288" rx="4" ry="7"/></g></g><g transform="translate(564 0)"><g className="hf-plant" style={{ "--i": 7 } as React.CSSProperties}><path className="hf-stem" d="M0 330 V292"/><path className="hf-leaf" d="M0 306 C-16 304 -22 292 -24 284 C-10 286 -2 294 0 306Z"/><path className="hf-leaf" d="M0 298 C16 296 22 284 24 276 C10 278 2 286 0 298Z"/></g></g><g transform="translate(636 0)"><g className="hf-plant" style={{ "--i": 8 } as React.CSSProperties}><path className="hf-stem" d="M0 330 V292"/><path className="hf-leaf" d="M0 306 C-16 304 -22 292 -24 284 C-10 286 -2 294 0 306Z"/><path className="hf-leaf" d="M0 298 C16 296 22 284 24 276 C10 278 2 286 0 298Z"/></g></g><g transform="translate(708 0)"><g className="hf-plant" style={{ "--i": 9 } as React.CSSProperties}><path className="hf-stem" d="M0 330 V292"/><path className="hf-leaf" d="M0 306 C-16 304 -22 292 -24 284 C-10 286 -2 294 0 306Z"/><path className="hf-leaf" d="M0 298 C16 296 22 284 24 276 C10 278 2 286 0 298Z"/><ellipse className="hf-grain" cx="0" cy="288" rx="4" ry="7"/></g></g><g transform="translate(780 0)"><g className="hf-plant" style={{ "--i": 10 } as React.CSSProperties}><path className="hf-stem" d="M0 330 V292"/><path className="hf-leaf" d="M0 306 C-16 304 -22 292 -24 284 C-10 286 -2 294 0 306Z"/><path className="hf-leaf" d="M0 298 C16 296 22 284 24 276 C10 278 2 286 0 298Z"/></g></g><g transform="translate(852 0)"><g className="hf-plant" style={{ "--i": 11 } as React.CSSProperties}><path className="hf-stem" d="M0 330 V292"/><path className="hf-leaf" d="M0 306 C-16 304 -22 292 -24 284 C-10 286 -2 294 0 306Z"/><path className="hf-leaf" d="M0 298 C16 296 22 284 24 276 C10 278 2 286 0 298Z"/></g></g><g transform="translate(924 0)"><g className="hf-plant" style={{ "--i": 12 } as React.CSSProperties}><path className="hf-stem" d="M0 330 V292"/><path className="hf-leaf" d="M0 306 C-16 304 -22 292 -24 284 C-10 286 -2 294 0 306Z"/><path className="hf-leaf" d="M0 298 C16 296 22 284 24 276 C10 278 2 286 0 298Z"/><ellipse className="hf-grain" cx="0" cy="288" rx="4" ry="7"/></g></g><g transform="translate(996 0)"><g className="hf-plant" style={{ "--i": 13 } as React.CSSProperties}><path className="hf-stem" d="M0 330 V292"/><path className="hf-leaf" d="M0 306 C-16 304 -22 292 -24 284 C-10 286 -2 294 0 306Z"/><path className="hf-leaf" d="M0 298 C16 296 22 284 24 276 C10 278 2 286 0 298Z"/></g></g><g transform="translate(1068 0)"><g className="hf-plant" style={{ "--i": 14 } as React.CSSProperties}><path className="hf-stem" d="M0 330 V292"/><path className="hf-leaf" d="M0 306 C-16 304 -22 292 -24 284 C-10 286 -2 294 0 306Z"/><path className="hf-leaf" d="M0 298 C16 296 22 284 24 276 C10 278 2 286 0 298Z"/></g></g><g transform="translate(1140 0)"><g className="hf-plant" style={{ "--i": 15 } as React.CSSProperties}><path className="hf-stem" d="M0 330 V292"/><path className="hf-leaf" d="M0 306 C-16 304 -22 292 -24 284 C-10 286 -2 294 0 306Z"/><path className="hf-leaf" d="M0 298 C16 296 22 284 24 276 C10 278 2 286 0 298Z"/><ellipse className="hf-grain" cx="0" cy="288" rx="4" ry="7"/></g></g></g>
</svg>
    </div>
  );
}
