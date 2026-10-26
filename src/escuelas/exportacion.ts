import type { ConfigService } from '@nestjs/config';

/**
 * Quiénes pueden exportar el listado de escuelas: los emails de
 * EXPORTAR_ESCUELAS_EMAILS (separados por coma). Es la regla del original, que los
 * tenía fijos en el código; queda así hasta decidir qué puede hacer cada rol.
 */
export function puedeExportarEscuelas(
  config: ConfigService,
  email: string,
): boolean {
  const permitidos = (config.get<string>('EXPORTAR_ESCUELAS_EMAILS') ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return permitidos.includes(email.toLowerCase());
}
