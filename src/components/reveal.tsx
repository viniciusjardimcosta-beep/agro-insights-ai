import { useEffect, useRef, useState, type ReactNode } from "react";

/** Faz o bloco aparecer suavemente ao rolar. O conteúdo nunca depende disso para existir: começa visível. */
export function Reveal({ children, delay = 0, className = "" }: { children: ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(true); // sem JavaScript (ou antes dele) o conteúdo já aparece

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;
    // Só o que ainda está abaixo da tela começa escondido; o que já está visível não pisca.
    if (window.innerWidth < 768 || el.getBoundingClientRect().top < window.innerHeight) return; // celular: sempre visível
    setShown(false);
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setShown(true); io.disconnect(); }
    }, { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ease-out ${shown ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"} ${className}`}
      style={{ transitionDelay: shown ? `${delay}ms` : "0ms" }}
    >
      {children}
    </div>
  );
}
