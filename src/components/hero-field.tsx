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
    if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
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
<defs><linearGradient id="hf-sky-grad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="oklch(0.99 0.01 110)"/><stop offset="1" stopColor="oklch(0.95 0.06 120)"/></linearGradient></defs>
<rect className="hf-sky" width="1200" height="360"/>
<circle className="hf-sun" cx="960" cy="110" r="46"/>
<g className="hf-parallax" data-p="0.15"><g className="hf-clouds"><g className="hf-cloud"><ellipse cx="200" cy="70" rx="46" ry="14"/><ellipse cx="230" cy="62" rx="30" ry="12"/></g><g className="hf-cloud"><ellipse cx="620" cy="46" rx="56" ry="14"/><ellipse cx="650" cy="38" rx="32" ry="12"/></g></g></g>
<g className="hf-parallax" data-p="0.25"><path className="hf-hill-far" d="M0 200 C150 150 300 190 450 170 C620 148 760 196 920 168 C1040 150 1130 176 1200 164 V360 H0Z"/></g>
<g className="hf-parallax" data-p="0.4"><path className="hf-hill-mid" d="M0 232 C180 196 340 236 520 214 C700 192 860 238 1040 212 C1120 202 1170 214 1200 208 V360 H0Z"/>
<g className="hf-herd"><g transform="translate(0 157) scale(1.4)"><g className="hf-bob" style={{ animationDelay: "0s" }}><g className="hf-tail"><path d="M10 18 C2 22 2 34 6 42" stroke="oklch(0.3 0.02 60)" strokeWidth="3" fill="none" strokeLinecap="round"/></g>
<g className="hf-leg b"><rect className="hf-cow-leg" x="16" y="36" width="7" height="20" rx="3"/><rect className="hf-cow-hoof" x="16" y="52" width="7" height="4" rx="2"/></g>
<g className="hf-leg"><rect className="hf-cow-leg" x="27" y="36" width="7" height="20" rx="3"/><rect className="hf-cow-hoof" x="27" y="52" width="7" height="4" rx="2"/></g>
<g className="hf-leg"><rect className="hf-cow-leg" x="50" y="36" width="7" height="20" rx="3"/><rect className="hf-cow-hoof" x="50" y="52" width="7" height="4" rx="2"/></g>
<g className="hf-leg b"><rect className="hf-cow-leg" x="60" y="36" width="7" height="20" rx="3"/><rect className="hf-cow-hoof" x="60" y="52" width="7" height="4" rx="2"/></g>
<rect className="hf-cow-body" x="8" y="12" width="62" height="28" rx="13"/>
<ellipse className="hf-cow-patch" cx="26" cy="22" rx="9" ry="6"/><ellipse className="hf-cow-patch" cx="52" cy="30" rx="8" ry="5"/>
<ellipse className="hf-cow-body" cx="80" cy="22" rx="11" ry="9"/><ellipse className="hf-cow-patch" cx="76" cy="17" rx="5" ry="4"/>
<ellipse className="hf-cow-muzzle" cx="89" cy="27" rx="6" ry="5"/><circle cx="85" cy="19" r="1.6" fill="oklch(0.25 0.02 60)"/>
<ellipse className="hf-cow-patch" cx="72" cy="13" rx="6" ry="3" transform="rotate(-25 72 13)"/>
<path d="M76 12 L74 6 M82 12 L85 6" stroke="oklch(0.9 0.04 90)" strokeWidth="2.5" strokeLinecap="round"/></g></g><g transform="translate(150 171) scale(1.15)"><g className="hf-bob" style={{ animationDelay: "0.4s" }}><g className="hf-tail"><path d="M10 18 C2 22 2 34 6 42" stroke="oklch(0.3 0.02 60)" strokeWidth="3" fill="none" strokeLinecap="round"/></g>
<g className="hf-leg b"><rect className="hf-cow-leg" x="16" y="36" width="7" height="20" rx="3"/><rect className="hf-cow-hoof" x="16" y="52" width="7" height="4" rx="2"/></g>
<g className="hf-leg"><rect className="hf-cow-leg" x="27" y="36" width="7" height="20" rx="3"/><rect className="hf-cow-hoof" x="27" y="52" width="7" height="4" rx="2"/></g>
<g className="hf-leg"><rect className="hf-cow-leg" x="50" y="36" width="7" height="20" rx="3"/><rect className="hf-cow-hoof" x="50" y="52" width="7" height="4" rx="2"/></g>
<g className="hf-leg b"><rect className="hf-cow-leg" x="60" y="36" width="7" height="20" rx="3"/><rect className="hf-cow-hoof" x="60" y="52" width="7" height="4" rx="2"/></g>
<rect className="hf-cow-body" x="8" y="12" width="62" height="28" rx="13"/>
<ellipse className="hf-cow-patch" cx="26" cy="22" rx="9" ry="6"/><ellipse className="hf-cow-patch" cx="52" cy="30" rx="8" ry="5"/>
<ellipse className="hf-cow-body" cx="80" cy="22" rx="11" ry="9"/><ellipse className="hf-cow-patch" cx="76" cy="17" rx="5" ry="4"/>
<ellipse className="hf-cow-muzzle" cx="89" cy="27" rx="6" ry="5"/><circle cx="85" cy="19" r="1.6" fill="oklch(0.25 0.02 60)"/>
<ellipse className="hf-cow-patch" cx="72" cy="13" rx="6" ry="3" transform="rotate(-25 72 13)"/>
<path d="M76 12 L74 6 M82 12 L85 6" stroke="oklch(0.9 0.04 90)" strokeWidth="2.5" strokeLinecap="round"/></g></g><g transform="translate(290 196) scale(0.7)"><g className="hf-bob" style={{ animationDelay: "0.8s" }}><g className="hf-tail"><path d="M10 18 C2 22 2 34 6 42" stroke="oklch(0.3 0.02 60)" strokeWidth="3" fill="none" strokeLinecap="round"/></g>
<g className="hf-leg b"><rect className="hf-cow-leg" x="16" y="36" width="7" height="20" rx="3"/><rect className="hf-cow-hoof" x="16" y="52" width="7" height="4" rx="2"/></g>
<g className="hf-leg"><rect className="hf-cow-leg" x="27" y="36" width="7" height="20" rx="3"/><rect className="hf-cow-hoof" x="27" y="52" width="7" height="4" rx="2"/></g>
<g className="hf-leg"><rect className="hf-cow-leg" x="50" y="36" width="7" height="20" rx="3"/><rect className="hf-cow-hoof" x="50" y="52" width="7" height="4" rx="2"/></g>
<g className="hf-leg b"><rect className="hf-cow-leg" x="60" y="36" width="7" height="20" rx="3"/><rect className="hf-cow-hoof" x="60" y="52" width="7" height="4" rx="2"/></g>
<rect className="hf-cow-body" x="8" y="12" width="62" height="28" rx="13"/>
<ellipse className="hf-cow-patch" cx="26" cy="22" rx="9" ry="6"/><ellipse className="hf-cow-patch" cx="52" cy="30" rx="8" ry="5"/>
<ellipse className="hf-cow-body" cx="80" cy="22" rx="11" ry="9"/><ellipse className="hf-cow-patch" cx="76" cy="17" rx="5" ry="4"/>
<ellipse className="hf-cow-muzzle" cx="89" cy="27" rx="6" ry="5"/><circle cx="85" cy="19" r="1.6" fill="oklch(0.25 0.02 60)"/>
<ellipse className="hf-cow-patch" cx="72" cy="13" rx="6" ry="3" transform="rotate(-25 72 13)"/>
<path d="M76 12 L74 6 M82 12 L85 6" stroke="oklch(0.9 0.04 90)" strokeWidth="2.5" strokeLinecap="round"/></g></g></g></g>
<g className="hf-parallax" data-p="0.6"><path className="hf-hill-near" d="M0 262 C200 238 380 270 600 252 C820 234 1000 270 1200 246 V360 H0Z"/>
<g className="hf-herd slow"><g transform="translate(0 206) scale(1)"><g className="hf-bob" style={{ animationDelay: "0.2s" }}><g className="hf-tail"><path d="M10 18 C2 22 2 34 6 42" stroke="oklch(0.3 0.02 60)" strokeWidth="3" fill="none" strokeLinecap="round"/></g>
<g className="hf-leg b"><rect className="hf-cow-leg" x="16" y="36" width="7" height="20" rx="3"/><rect className="hf-cow-hoof" x="16" y="52" width="7" height="4" rx="2"/></g>
<g className="hf-leg"><rect className="hf-cow-leg" x="27" y="36" width="7" height="20" rx="3"/><rect className="hf-cow-hoof" x="27" y="52" width="7" height="4" rx="2"/></g>
<g className="hf-leg"><rect className="hf-cow-leg" x="50" y="36" width="7" height="20" rx="3"/><rect className="hf-cow-hoof" x="50" y="52" width="7" height="4" rx="2"/></g>
<g className="hf-leg b"><rect className="hf-cow-leg" x="60" y="36" width="7" height="20" rx="3"/><rect className="hf-cow-hoof" x="60" y="52" width="7" height="4" rx="2"/></g>
<rect className="hf-cow-body" x="8" y="12" width="62" height="28" rx="13"/>
<ellipse className="hf-cow-patch" cx="26" cy="22" rx="9" ry="6"/><ellipse className="hf-cow-patch" cx="52" cy="30" rx="8" ry="5"/>
<ellipse className="hf-cow-body" cx="80" cy="22" rx="11" ry="9"/><ellipse className="hf-cow-patch" cx="76" cy="17" rx="5" ry="4"/>
<ellipse className="hf-cow-muzzle" cx="89" cy="27" rx="6" ry="5"/><circle cx="85" cy="19" r="1.6" fill="oklch(0.25 0.02 60)"/>
<ellipse className="hf-cow-patch" cx="72" cy="13" rx="6" ry="3" transform="rotate(-25 72 13)"/>
<path d="M76 12 L74 6 M82 12 L85 6" stroke="oklch(0.9 0.04 90)" strokeWidth="2.5" strokeLinecap="round"/></g></g><g transform="translate(120 214) scale(0.85)"><g className="hf-bob" style={{ animationDelay: "0.6s" }}><g className="hf-tail"><path d="M10 18 C2 22 2 34 6 42" stroke="oklch(0.3 0.02 60)" strokeWidth="3" fill="none" strokeLinecap="round"/></g>
<g className="hf-leg b"><rect className="hf-cow-leg" x="16" y="36" width="7" height="20" rx="3"/><rect className="hf-cow-hoof" x="16" y="52" width="7" height="4" rx="2"/></g>
<g className="hf-leg"><rect className="hf-cow-leg" x="27" y="36" width="7" height="20" rx="3"/><rect className="hf-cow-hoof" x="27" y="52" width="7" height="4" rx="2"/></g>
<g className="hf-leg"><rect className="hf-cow-leg" x="50" y="36" width="7" height="20" rx="3"/><rect className="hf-cow-hoof" x="50" y="52" width="7" height="4" rx="2"/></g>
<g className="hf-leg b"><rect className="hf-cow-leg" x="60" y="36" width="7" height="20" rx="3"/><rect className="hf-cow-hoof" x="60" y="52" width="7" height="4" rx="2"/></g>
<rect className="hf-cow-body" x="8" y="12" width="62" height="28" rx="13"/>
<ellipse className="hf-cow-patch" cx="26" cy="22" rx="9" ry="6"/><ellipse className="hf-cow-patch" cx="52" cy="30" rx="8" ry="5"/>
<ellipse className="hf-cow-body" cx="80" cy="22" rx="11" ry="9"/><ellipse className="hf-cow-patch" cx="76" cy="17" rx="5" ry="4"/>
<ellipse className="hf-cow-muzzle" cx="89" cy="27" rx="6" ry="5"/><circle cx="85" cy="19" r="1.6" fill="oklch(0.25 0.02 60)"/>
<ellipse className="hf-cow-patch" cx="72" cy="13" rx="6" ry="3" transform="rotate(-25 72 13)"/>
<path d="M76 12 L74 6 M82 12 L85 6" stroke="oklch(0.9 0.04 90)" strokeWidth="2.5" strokeLinecap="round"/></g></g></g></g>
<path className="hf-ground" d="M0 290 C240 276 480 296 720 284 C960 272 1100 292 1200 282 V360 H0Z"/>
<path className="hf-row" d="M0 262 L-720 360"/><path className="hf-row" d="M100 262 L-500 360"/><path className="hf-row" d="M200 262 L-280 360"/><path className="hf-row" d="M300 262 L-60 360"/><path className="hf-row" d="M400 262 L160 360"/><path className="hf-row" d="M500 262 L380 360"/><path className="hf-row" d="M600 262 L600 360"/><path className="hf-row" d="M700 262 L820 360"/><path className="hf-row" d="M800 262 L1040 360"/><path className="hf-row" d="M900 262 L1260 360"/><path className="hf-row" d="M1000 262 L1480 360"/><path className="hf-row" d="M1100 262 L1700 360"/><path className="hf-row" d="M1200 262 L1920 360"/>
<g><g transform="translate(60 0)"><g className="hf-plant" style={{ "--i": 0 } as React.CSSProperties}><path className="hf-stem" d="M0 330 V292"/><path className="hf-leaf" d="M0 306 C-16 304 -22 292 -24 284 C-10 286 -2 294 0 306Z"/><path className="hf-leaf" d="M0 298 C16 296 22 284 24 276 C10 278 2 286 0 298Z"/><ellipse className="hf-grain" cx="0" cy="288" rx="4" ry="7"/></g></g><g transform="translate(132 0)"><g className="hf-plant" style={{ "--i": 1 } as React.CSSProperties}><path className="hf-stem" d="M0 330 V292"/><path className="hf-leaf" d="M0 306 C-16 304 -22 292 -24 284 C-10 286 -2 294 0 306Z"/><path className="hf-leaf" d="M0 298 C16 296 22 284 24 276 C10 278 2 286 0 298Z"/></g></g><g transform="translate(204 0)"><g className="hf-plant" style={{ "--i": 2 } as React.CSSProperties}><path className="hf-stem" d="M0 330 V292"/><path className="hf-leaf" d="M0 306 C-16 304 -22 292 -24 284 C-10 286 -2 294 0 306Z"/><path className="hf-leaf" d="M0 298 C16 296 22 284 24 276 C10 278 2 286 0 298Z"/></g></g><g transform="translate(276 0)"><g className="hf-plant" style={{ "--i": 3 } as React.CSSProperties}><path className="hf-stem" d="M0 330 V292"/><path className="hf-leaf" d="M0 306 C-16 304 -22 292 -24 284 C-10 286 -2 294 0 306Z"/><path className="hf-leaf" d="M0 298 C16 296 22 284 24 276 C10 278 2 286 0 298Z"/><ellipse className="hf-grain" cx="0" cy="288" rx="4" ry="7"/></g></g><g transform="translate(348 0)"><g className="hf-plant" style={{ "--i": 4 } as React.CSSProperties}><path className="hf-stem" d="M0 330 V292"/><path className="hf-leaf" d="M0 306 C-16 304 -22 292 -24 284 C-10 286 -2 294 0 306Z"/><path className="hf-leaf" d="M0 298 C16 296 22 284 24 276 C10 278 2 286 0 298Z"/></g></g><g transform="translate(420 0)"><g className="hf-plant" style={{ "--i": 5 } as React.CSSProperties}><path className="hf-stem" d="M0 330 V292"/><path className="hf-leaf" d="M0 306 C-16 304 -22 292 -24 284 C-10 286 -2 294 0 306Z"/><path className="hf-leaf" d="M0 298 C16 296 22 284 24 276 C10 278 2 286 0 298Z"/></g></g><g transform="translate(492 0)"><g className="hf-plant" style={{ "--i": 6 } as React.CSSProperties}><path className="hf-stem" d="M0 330 V292"/><path className="hf-leaf" d="M0 306 C-16 304 -22 292 -24 284 C-10 286 -2 294 0 306Z"/><path className="hf-leaf" d="M0 298 C16 296 22 284 24 276 C10 278 2 286 0 298Z"/><ellipse className="hf-grain" cx="0" cy="288" rx="4" ry="7"/></g></g><g transform="translate(564 0)"><g className="hf-plant" style={{ "--i": 7 } as React.CSSProperties}><path className="hf-stem" d="M0 330 V292"/><path className="hf-leaf" d="M0 306 C-16 304 -22 292 -24 284 C-10 286 -2 294 0 306Z"/><path className="hf-leaf" d="M0 298 C16 296 22 284 24 276 C10 278 2 286 0 298Z"/></g></g><g transform="translate(636 0)"><g className="hf-plant" style={{ "--i": 8 } as React.CSSProperties}><path className="hf-stem" d="M0 330 V292"/><path className="hf-leaf" d="M0 306 C-16 304 -22 292 -24 284 C-10 286 -2 294 0 306Z"/><path className="hf-leaf" d="M0 298 C16 296 22 284 24 276 C10 278 2 286 0 298Z"/></g></g><g transform="translate(708 0)"><g className="hf-plant" style={{ "--i": 9 } as React.CSSProperties}><path className="hf-stem" d="M0 330 V292"/><path className="hf-leaf" d="M0 306 C-16 304 -22 292 -24 284 C-10 286 -2 294 0 306Z"/><path className="hf-leaf" d="M0 298 C16 296 22 284 24 276 C10 278 2 286 0 298Z"/><ellipse className="hf-grain" cx="0" cy="288" rx="4" ry="7"/></g></g><g transform="translate(780 0)"><g className="hf-plant" style={{ "--i": 10 } as React.CSSProperties}><path className="hf-stem" d="M0 330 V292"/><path className="hf-leaf" d="M0 306 C-16 304 -22 292 -24 284 C-10 286 -2 294 0 306Z"/><path className="hf-leaf" d="M0 298 C16 296 22 284 24 276 C10 278 2 286 0 298Z"/></g></g><g transform="translate(852 0)"><g className="hf-plant" style={{ "--i": 11 } as React.CSSProperties}><path className="hf-stem" d="M0 330 V292"/><path className="hf-leaf" d="M0 306 C-16 304 -22 292 -24 284 C-10 286 -2 294 0 306Z"/><path className="hf-leaf" d="M0 298 C16 296 22 284 24 276 C10 278 2 286 0 298Z"/></g></g><g transform="translate(924 0)"><g className="hf-plant" style={{ "--i": 12 } as React.CSSProperties}><path className="hf-stem" d="M0 330 V292"/><path className="hf-leaf" d="M0 306 C-16 304 -22 292 -24 284 C-10 286 -2 294 0 306Z"/><path className="hf-leaf" d="M0 298 C16 296 22 284 24 276 C10 278 2 286 0 298Z"/><ellipse className="hf-grain" cx="0" cy="288" rx="4" ry="7"/></g></g><g transform="translate(996 0)"><g className="hf-plant" style={{ "--i": 13 } as React.CSSProperties}><path className="hf-stem" d="M0 330 V292"/><path className="hf-leaf" d="M0 306 C-16 304 -22 292 -24 284 C-10 286 -2 294 0 306Z"/><path className="hf-leaf" d="M0 298 C16 296 22 284 24 276 C10 278 2 286 0 298Z"/></g></g><g transform="translate(1068 0)"><g className="hf-plant" style={{ "--i": 14 } as React.CSSProperties}><path className="hf-stem" d="M0 330 V292"/><path className="hf-leaf" d="M0 306 C-16 304 -22 292 -24 284 C-10 286 -2 294 0 306Z"/><path className="hf-leaf" d="M0 298 C16 296 22 284 24 276 C10 278 2 286 0 298Z"/></g></g><g transform="translate(1140 0)"><g className="hf-plant" style={{ "--i": 15 } as React.CSSProperties}><path className="hf-stem" d="M0 330 V292"/><path className="hf-leaf" d="M0 306 C-16 304 -22 292 -24 284 C-10 286 -2 294 0 306Z"/><path className="hf-leaf" d="M0 298 C16 296 22 284 24 276 C10 278 2 286 0 298Z"/><ellipse className="hf-grain" cx="0" cy="288" rx="4" ry="7"/></g></g></g>
</svg>
    </div>
  );
}
