import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

/** Cuerpo de POST y PUT de grados. */
export class GuardarGradoDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  // class-validator evalúa de abajo hacia arriba: el tipo se chequea primero
  @MaxLength(255, { message: 'El nombre no puede superar los 255 caracteres.' })
  @MinLength(2, { message: 'El nombre debe tener al menos 2 caracteres.' })
  @IsString({ message: 'El nombre es obligatorio.' })
  nombre: string;
}
