import { Transform } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

const recortar = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// class-validator evalúa de abajo hacia arriba: el tipo se chequea primero.

/** Cuerpo de POST y PUT de escuelas. */
export class GuardarEscuelaDto {
  /** Solo dígitos: es el que va en la URL pública /{cueanexo}. */
  @Transform(recortar)
  @Matches(/^\d{1,20}$/, {
    message: 'El CUE/Anexo debe tener solo números (hasta 20).',
  })
  @IsString({ message: 'El CUE/Anexo es obligatorio.' })
  cueanexo: string;

  @Transform(recortar)
  @MaxLength(255, { message: 'El nombre no puede superar los 255 caracteres.' })
  @MinLength(2, { message: 'El nombre debe tener al menos 2 caracteres.' })
  @IsString({ message: 'El nombre es obligatorio.' })
  nombre: string;

  /** Comuna de CABA. Obligatoria al guardar, aunque las migradas la tengan nula. */
  @Max(15, { message: 'La comuna debe estar entre 1 y 15.' })
  @Min(1, { message: 'La comuna debe estar entre 1 y 15.' })
  @IsInt({ message: 'La comuna debe ser un número.' })
  comuna: number;

  /** Texto vacío o null equivalen a "sin descripción". */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => recortar({ value }) || null)
  @ValidateIf((_, valor) => valor !== null)
  @MaxLength(500, {
    message: 'La descripción no puede superar los 500 caracteres.',
  })
  @IsString({ message: 'La descripción debe ser un texto.' })
  descripcion?: string | null;

  @Transform(recortar)
  @MaxLength(255, { message: 'La calle no puede superar los 255 caracteres.' })
  @MinLength(2, { message: 'La calle debe tener al menos 2 caracteres.' })
  @IsString({ message: 'La calle es obligatoria.' })
  calle: string;

  /** Número de puerta (0 si no tiene). */
  @Max(999999, { message: 'El número no puede superar 999999.' })
  @Min(0, { message: 'El número no puede ser negativo.' })
  @IsInt({ message: 'El número debe ser un número entero.' })
  altura: number;

  @Transform(recortar)
  @MaxLength(10, {
    message: 'El código postal no puede superar los 10 caracteres.',
  })
  @MinLength(1, { message: 'El código postal es obligatorio.' })
  @IsString({ message: 'El código postal es obligatorio.' })
  codigoPostal: string;
}

/** Query string de la exportación: el mismo texto de búsqueda que usa el listado. */
export class ExportarEscuelasQueryDto {
  @IsOptional()
  @Transform(recortar)
  @MaxLength(100, { message: 'La búsqueda no puede superar 100 caracteres.' })
  @IsString({ message: 'La búsqueda debe ser un texto.' })
  search?: string;
}
