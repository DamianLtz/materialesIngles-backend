import { Transform } from 'class-transformer';
import { IsInt, IsString, MaxLength, MinLength } from 'class-validator';

const recortar = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Datos de un libro que se pueden editar. El catálogo no está: un libro no
 * cambia de catálogo una vez creado.
 */
export class ActualizarLibroDto {
  // class-validator evalúa de abajo hacia arriba: el tipo se chequea primero
  @Transform(recortar)
  @MaxLength(255, { message: 'El título no puede superar los 255 caracteres.' })
  @MinLength(2, { message: 'El título debe tener al menos 2 caracteres.' })
  @IsString({ message: 'El título es obligatorio.' })
  titulo: string;

  @Transform(recortar)
  @MaxLength(30, { message: 'El ISBN no puede superar los 30 caracteres.' })
  @MinLength(1, { message: 'El ISBN es obligatorio.' })
  @IsString({ message: 'El ISBN es obligatorio.' })
  isbn: string;

  @Transform(recortar)
  @MaxLength(255, {
    message: 'La editorial no puede superar los 255 caracteres.',
  })
  @MinLength(1, { message: 'La editorial es obligatoria.' })
  @IsString({ message: 'La editorial es obligatoria.' })
  editorial: string;

  @IsInt({ message: 'Seleccioná un grado.' })
  gradoId: number;
}

/** Alta de un libro: además de los datos editables, el catálogo al que pertenece. */
export class CrearLibroDto extends ActualizarLibroDto {
  @IsInt({ message: 'Falta el catálogo del libro.' })
  catalogoId: number;
}
