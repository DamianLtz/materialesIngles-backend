import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

const recortar = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Texto vacío o null equivalen a "sin valor". */
const vacioANull = ({ value }: { value: unknown }) =>
  recortar({ value }) || null;

const MENSAJE_FECHA = 'La fecha no es válida (formato aaaa-mm-dd).';

export const CANTIDAD_MAXIMA_MIN = 1;
export const CANTIDAD_MAXIMA_MAX = 1000;

/** Lo que la etapa ofrece: un grado de un catálogo, con tope de cantidad por pedido. */
export class OfertaDto {
  @IsInt({ message: 'Seleccioná un grado.' })
  gradoId: number;

  @IsInt({ message: 'Seleccioná un catálogo.' })
  catalogoId: number;

  @Max(CANTIDAD_MAXIMA_MAX, {
    message: `La cantidad máxima no puede superar ${CANTIDAD_MAXIMA_MAX}.`,
  })
  @Min(CANTIDAD_MAXIMA_MIN, {
    message: `La cantidad máxima debe ser ${CANTIDAD_MAXIMA_MIN} o mayor.`,
  })
  @IsInt({ message: 'La cantidad máxima debe ser un número entero.' })
  cantidadMaxima: number;
}

/**
 * Cuerpo de POST y PUT de etapas. Las reglas que cruzan varios campos (fechas de a pares,
 * fin >= inicio, al menos un período, ofertas repetidas) las valida el servicio.
 */
export class GuardarEtapaDto {
  @Transform(recortar)
  // class-validator evalúa de abajo hacia arriba: el tipo se chequea primero
  @MaxLength(255, { message: 'El nombre no puede superar los 255 caracteres.' })
  @MinLength(2, { message: 'El nombre debe tener al menos 2 caracteres.' })
  @IsString({ message: 'El nombre es obligatorio.' })
  nombre: string;

  @IsOptional()
  @Transform(vacioANull)
  @ValidateIf((_, valor) => valor !== null)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: MENSAJE_FECHA })
  @IsDateString({ strict: true }, { message: MENSAJE_FECHA })
  fechaInicio?: string | null;

  @IsOptional()
  @Transform(vacioANull)
  @ValidateIf((_, valor) => valor !== null)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: MENSAJE_FECHA })
  @IsDateString({ strict: true }, { message: MENSAJE_FECHA })
  fechaFin?: string | null;

  @IsOptional()
  @Transform(vacioANull)
  @ValidateIf((_, valor) => valor !== null)
  @MaxLength(1000, {
    message: 'La leyenda no puede superar los 1000 caracteres.',
  })
  @IsString({ message: 'La leyenda debe ser un texto.' })
  leyenda?: string | null;

  @IsOptional()
  @Transform(vacioANull)
  @ValidateIf((_, valor) => valor !== null)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: MENSAJE_FECHA })
  @IsDateString({ strict: true }, { message: MENSAJE_FECHA })
  reclamoInicio?: string | null;

  @IsOptional()
  @Transform(vacioANull)
  @ValidateIf((_, valor) => valor !== null)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: MENSAJE_FECHA })
  @IsDateString({ strict: true }, { message: MENSAJE_FECHA })
  reclamoFin?: string | null;

  @IsOptional()
  @Transform(vacioANull)
  @ValidateIf((_, valor) => valor !== null)
  @MaxLength(1000, {
    message: 'La leyenda de reclamos no puede superar los 1000 caracteres.',
  })
  @IsString({ message: 'La leyenda de reclamos debe ser un texto.' })
  reclamoLeyenda?: string | null;

  /** Publicar la etapa oculta cualquier otra que estuviera publicada. */
  @IsBoolean({ message: 'Indicá si la etapa se publica.' })
  visible: boolean;

  @ArrayUnique({ message: 'Hay escuelas repetidas.' })
  @IsInt({ each: true, message: 'Las escuelas no son válidas.' })
  @IsArray({ message: 'Las escuelas deben ser una lista.' })
  escuelaIds: number[];

  @ValidateNested({ each: true })
  @Type(() => OfertaDto)
  @ArrayMinSize(1, {
    message: 'Debe agregar al menos una combinación de grado y catálogo.',
  })
  @IsArray({ message: 'Las ofertas deben ser una lista.' })
  ofertas: OfertaDto[];
}

type Periodos = Pick<
  GuardarEtapaDto,
  'fechaInicio' | 'fechaFin' | 'reclamoInicio' | 'reclamoFin' | 'ofertas'
>;

/** Reglas entre campos, con los mismos mensajes que el original. Vacío = todo bien. */
export function erroresCruzados(dto: Periodos): string[] {
  const errores: string[] = [];
  const seleccion = erroresDePeriodo(
    dto.fechaInicio,
    dto.fechaFin,
    'selección',
  );
  const reclamo = erroresDePeriodo(
    dto.reclamoInicio,
    dto.reclamoFin,
    'reclamo',
  );
  errores.push(...seleccion, ...reclamo);

  if (!dto.fechaInicio && !dto.reclamoInicio) {
    errores.push('Debe cargar al menos un período (selección o reclamo).');
  }

  const pares = new Set(dto.ofertas.map((o) => `${o.gradoId}-${o.catalogoId}`));
  if (pares.size !== dto.ofertas.length) {
    errores.push('No se puede repetir la combinación de grado y catálogo.');
  }
  return errores;
}

function erroresDePeriodo(
  inicio: string | null | undefined,
  fin: string | null | undefined,
  nombre: 'selección' | 'reclamo',
): string[] {
  if (inicio && !fin) {
    return [`Si carga inicio de ${nombre}, debe cargar también el fin.`];
  }
  if (!inicio && fin) {
    return [`Si carga fin de ${nombre}, debe cargar también el inicio.`];
  }
  // aaaa-mm-dd se compara como texto igual que como fecha
  if (inicio && fin && fin < inicio) {
    return [`El fin de ${nombre} debe ser igual o posterior al inicio.`];
  }
  return [];
}
