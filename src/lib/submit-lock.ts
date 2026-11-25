/**
 * Trava de duplo toque: o estado do React só atualiza depois do clique, então dois toques rápidos
 * passavam pelo "if (busy) return" e salvavam duas vezes. A trava é síncrona.
 * Uso: if (!lock.take()) return; try { ... } finally { lock.release(); }
 */
export function createSubmitLock() {
  let on = false;
  return {
    take(): boolean {
      if (on) return false;
      on = true;
      return true;
    },
    release() {
      on = false;
    },
  };
}
