import {
  clasificarEscuela,
  etapaInicial,
  momentoEtapa,
  porcentaje,
  topConOtros,
} from './calculo.js';

const etapa = (
  fechaInicio: string | null,
  fechaFin: string | null,
  reclamoInicio: string | null,
  reclamoFin: string | null,
) => ({ fechaInicio, fechaFin, reclamoInicio, reclamoFin });

describe('momentoEtapa', () => {
  const e = etapa('2026-03-01', '2026-03-31', '2026-05-01', '2026-05-31');

  it('selección abierta, con los extremos incluidos', () => {
    expect(momentoEtapa(e, '2026-03-01').momento).toBe('seleccion');
    expect(momentoEtapa(e, '2026-03-15').momento).toBe('seleccion');
    expect(momentoEtapa(e, '2026-03-31').momento).toBe('seleccion');
  });

  it('reclamo abierto, con los extremos incluidos', () => {
    expect(momentoEtapa(e, '2026-05-01').momento).toBe('reclamo');
    expect(momentoEtapa(e, '2026-05-31').momento).toBe('reclamo');
  });

  it('entre períodos: terminó la selección y el reclamo no empezó', () => {
    expect(momentoEtapa(e, '2026-04-01')).toEqual({
      momento: 'entre_periodos',
      proximaFecha: '2026-05-01',
    });
  });

  it('próxima: todo empieza después de hoy, con la primera fecha', () => {
    expect(momentoEtapa(e, '2026-02-28')).toEqual({
      momento: 'proxima',
      proximaFecha: '2026-03-01',
    });
  });

  it('finalizada: pasaron ambos períodos', () => {
    expect(momentoEtapa(e, '2026-06-01').momento).toBe('finalizada');
  });

  it('fechas nulas: período cerrado', () => {
    expect(
      momentoEtapa(etapa(null, null, null, null), '2026-03-15').momento,
    ).toBe('finalizada');
    // sin reclamo cargado, terminada la selección, la etapa terminó
    expect(
      momentoEtapa(etapa('2026-03-01', '2026-03-31', null, null), '2026-04-01')
        .momento,
    ).toBe('finalizada');
    // solo reclamo, todavía futuro
    expect(
      momentoEtapa(etapa(null, null, '2026-05-01', '2026-05-31'), '2026-04-01'),
    ).toEqual({ momento: 'proxima', proximaFecha: '2026-05-01' });
  });

  it('usa la fecha argentina de hoy: a las 22:00 en Buenos Aires ya es otro día en UTC', async () => {
    const { hoyEnArgentina } = await import('../common/fechas.js');
    // 31/03 22:00 en Buenos Aires = 01/04 01:00 UTC: sigue siendo el último día de selección
    const hoy = hoyEnArgentina(new Date('2026-04-01T01:00:00Z'));
    expect(hoy).toBe('2026-03-31');
    expect(momentoEtapa(e, hoy).momento).toBe('seleccion');
  });
});

describe('etapaInicial', () => {
  it('la publicada, aunque sea más vieja', () => {
    expect(
      etapaInicial([
        { id: 1, visible: true, fechaInicio: '2025-01-01' },
        { id: 2, visible: false, fechaInicio: '2026-01-01' },
      ]),
    ).toBe(1);
  });

  it('sin publicada, la de inicio más reciente', () => {
    expect(
      etapaInicial([
        { id: 1, visible: false, fechaInicio: '2025-01-01' },
        { id: 2, visible: false, fechaInicio: '2026-01-01' },
        { id: 3, visible: false, fechaInicio: null },
      ]),
    ).toBe(2);
  });

  it('sin etapas, null', () => {
    expect(etapaInicial([])).toBeNull();
  });
});

describe('clasificarEscuela', () => {
  it('completa, parcial y sin pedidos', () => {
    expect(clasificarEscuela(3, 3)).toBe('completa');
    expect(clasificarEscuela(2, 3)).toBe('parcial');
    expect(clasificarEscuela(0, 3)).toBe('sin_pedidos');
  });

  it('sin ofertas nadie queda completa', () => {
    expect(clasificarEscuela(0, 0)).toBe('sin_pedidos');
  });
});

describe('porcentaje', () => {
  it('redondea y tiene tope de 100', () => {
    expect(porcentaje(1, 3)).toBe(33);
    expect(porcentaje(2, 3)).toBe(67);
    expect(porcentaje(5, 4)).toBe(100);
  });

  it('sin esperados da 0', () => {
    expect(porcentaje(0, 0)).toBe(0);
    expect(porcentaje(3, 0)).toBe(0);
  });
});

describe('topConOtros', () => {
  const punto = (label: string, ejemplares: number) => ({
    label,
    ejemplares,
    pedidos: 1,
  });

  it('deja el top y suma el resto en Otros', () => {
    const r = topConOtros(
      [punto('B', 5), punto('A', 10), punto('C', 3), punto('D', 1)],
      2,
    );
    expect(r.map((p) => p.label)).toEqual(['A', 'B', 'Otros']);
    expect(r[2]).toEqual({ label: 'Otros', ejemplares: 4, pedidos: 2 });
  });

  it('desempata por nombre y no agrega Otros si entra todo', () => {
    const r = topConOtros([punto('B', 5), punto('A', 5)], 5);
    expect(r.map((p) => p.label)).toEqual(['A', 'B']);
  });
});
