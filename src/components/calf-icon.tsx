import type { SVGProps } from "react";

/** Cabeça de bezerro (o lucide não tem). Mesmo traço dos outros ícones: herda cor e tamanho. */
export function CalfIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M8 7.5c0-1.5 1.5-2.5 4-2.5s4 1 4 2.5v5.5c0 3.2-1.5 6-4 6s-4-2.8-4-6z" />
      <path d="M8 8.5 3.5 7.5 2.5 10.5 8 11.5" />
      <path d="M16 8.5l4.5-1 1 3-5.5 1" />
      <path d="M9 5 8 2.5" />
      <path d="M15 5l1-2.5" />
      <path d="M10 16h4" />
      <path d="M10 10.2h.01" />
      <path d="M14 10.2h.01" />
    </svg>
  );
}
