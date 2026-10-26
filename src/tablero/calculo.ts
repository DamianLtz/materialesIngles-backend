import { periodoAbierto } from '../common/fechas.js';

export type Momento =
  'seleccion' | 'entre_periodos' | 'reclamo' | 'finalizada' | 'proxima';

export interface FechasEtapa {
  fechaInicio: string | null;
  fechaFin: string | null;
  reclamoInicio: string | null;
  reclamoFin: string | null;
}

/**
 * En qué momento está una etapa hoy (`hoy` = aaaa-mm-dd de Argentina). Los extremos de cada
 * período cuentan como abiertos y una fecha nula deja el período cerrado.
 * - selección o reclamo abiertos → ese período;
 * - todo empieza después de hoy → "próxima", con la primera fecha de inicio;
 * - la selección ya terminó y el reclamo todavía no empezó → "entre períodos";
 * - cualquier otro caso → finalizada.
 */
export function momentoEtapa(
  etapa: FechasEtapa,
  hoy: string,
): { momento: Momento; proximaFecha: string | null } {
  if (periodoAbierto(etapa.fechaInicio, etapa.fechaFin, hoy)) {
    return { momento: 'seleccion', proximaFecha: null };
  }
  if (periodoAbierto(etapa.reclamoInicio, etapa.reclamoFin, hoy)) {
    return { momento: 'reclamo', proximaFecha: null };
  }

  const inicios = [etapa.fechaInicio, etapa.reclamoInicio].filter(
    (f): f is string => !!f,
  );
  if (inicios.length > 0 && inicios.every((f) => f > hoy)) {
    return { momento: 'proxima', proximaFecha: inicios.sort()[0] };
  }

  const seleccionTermino = !!etapa.fechaFin && etapa.fechaFin < hoy;
  if (seleccionTermino && !!etapa.reclamoInicio && etapa.reclamoInicio > hoy) {
    return { momento: 'entre_periodos', proximaFecha: etapa.reclamoInicio };
  }
  return { momento: 'finalizada', proximaFecha: null };
}

/** Etapa que muestra el tablero si no se elige otra: la publicada; si no, la de inicio más reciente. */
export function etapaInicial(
  etapas: { id: number; visible: boolean; fechaInicio: string | null }[],
): number | null {
  const publicada = etapas.find((e) => e.visible);
  if (publicada) return publicada.id;
  const reciente = [...etapas].sort(
    (a, b) =>
      (b.fechaInicio ?? '').localeCompare(a.fechaInicio ?? '') || b.id - a.id,
  )[0];
  return reciente?.id ?? null;
}

export type AvanceEscuela = 'completa' | 'parcial' | 'sin_pedidos';

/** Completa = pedido en todas las ofertas; parcial = en alguna pero no en todas; si no, sin pedidos. */
export function clasificarEscuela(
  ofertasConPedido: number,
  ofertasTotales: number,
): AvanceEscuela {
  if (ofertasConPedido <= 0) return 'sin_pedidos';
  return ofertasConPedido >= ofertasTotales ? 'completa' : 'parcial';
}

/** Porcentaje entero de 0 a 100 (nunca pasa de 100, aunque haya más pedidos que esperados). */
export function porcentaje(parte: number, total: number): number {
  if (total <= 0 || parte <= 0) return 0;
  return Math.min(100, Math.round((parte / total) * 100));
}

export interface PuntoGrafico {
  label: string;
  ejemplares: number;
  pedidos: number;
}

/**
 * Deja las `max` filas más grandes (por ejemplares, desempate por nombre para que el orden
 * sea estable) y suma el resto en "Otros".
 */
export function topConOtros(
  filas: PuntoGrafico[],
  max: number,
): PuntoGrafico[] {
  const ordenadas = [...filas].sort(
    (a, b) => b.ejemplares - a.ejemplares || a.label.localeCompare(b.label),
  );
  if (ordenadas.length <= max) return ordenadas;
  const resto = ordenadas.slice(max);
  return [
    ...ordenadas.slice(0, max),
    {
      label: 'Otros',
      ejemplares: resto.reduce((s, f) => s + f.ejemplares, 0),
      pedidos: resto.reduce((s, f) => s + f.pedidos, 0),
    },
  ];
}
