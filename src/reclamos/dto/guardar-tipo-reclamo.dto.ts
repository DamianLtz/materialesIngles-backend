import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

const recortar = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Cuerpo de POST y PUT de tipos de reclamo. */
export class GuardarTipoReclamoDto {
  @Transform(recortar)
  // class-validator evalúa de abajo hacia arriba: el tipo se chequea primero
  @MaxLength(255, { message: 'El nombre no puede superar los 255 caracteres.' })
  @MinLength(2, { message: 'El nombre debe tener al menos 2 caracteres.' })
  @IsString({ message: 'El nombre es obligatorio.' })
  nombre: string;

  /** Texto vacío o null equivalen a "sin leyenda". */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => recortar({ value }) || null)
  @ValidateIf((_, valor) => valor !== null)
  @MaxLength(1000, {
    message: 'La leyenda no puede superar los 1000 caracteres.',
  })
  @IsString({ message: 'La leyenda debe ser un texto.' })
  leyenda?: string | null;
}
