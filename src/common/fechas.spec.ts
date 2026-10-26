import { hoyEnArgentina, periodoAbierto } from './fechas.js';

describe('hoyEnArgentina', () => {
  it('usa el día de Argentina, no el de UTC (borde de medianoche)', () => {
    // 22/10 23:30 en Argentina (UTC-3) = 23/10 02:30 UTC
    expect(hoyEnArgentina(new Date('2026-10-23T02:30:00Z'))).toBe('2026-10-22');
    // 23/10 00:00 en Argentina = 23/10 03:00 UTC
    expect(hoyEnArgentina(new Date('2026-10-23T03:00:00Z'))).toBe('2026-10-23');
    // 22/10 20:59 en Argentina todavía es 22/10
    expect(hoyEnArgentina(new Date('2026-10-22T23:59:00Z'))).toBe('2026-10-22');
  });

  it('devuelve aaaa-mm-dd con ceros', () => {
    expect(hoyEnArgentina(new Date('2026-03-05T15:00:00Z'))).toBe('2026-03-05');
  });
});

describe('periodoAbierto', () => {
  it('incluye el primer y el último día', () => {
    expect(periodoAbierto('2026-10-01', '2026-10-31', '2026-10-01')).toBe(true);
    expect(periodoAbierto('2026-10-01', '2026-10-31', '2026-10-31')).toBe(true);
    expect(periodoAbierto('2026-10-01', '2026-10-31', '2026-10-15')).toBe(true);
  });

  it('está cerrado antes del inicio y después del fin', () => {
    expect(periodoAbierto('2026-10-01', '2026-10-31', '2026-09-30')).toBe(
      false,
    );
    expect(periodoAbierto('2026-10-01', '2026-10-31', '2026-11-01')).toBe(
      false,
    );
  });

  it('con una fecha nula (o ambas) está cerrado', () => {
    expect(periodoAbierto(null, '2026-10-31', '2026-10-15')).toBe(false);
    expect(periodoAbierto('2026-10-01', null, '2026-10-15')).toBe(false);
    expect(periodoAbierto(null, null, '2026-10-15')).toBe(false);
    expect(periodoAbierto(undefined, undefined, '2026-10-15')).toBe(false);
  });
});
