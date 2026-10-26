import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** Respuesta de todos los listados paginados; el front la espera con esta forma. */
export interface Paginado<T> {
  data: T[];
  meta: { page: number; perPage: number; total: number; lastPage: number };
}

/** Query string de los listados: ?page=&perPage=&search= */
export class ListadoQueryDto {
  // class-validator evalúa de abajo hacia arriba: el tipo se chequea primero
  @IsOptional()
  @Type(() => Number)
  @Min(1, { message: 'page debe ser 1 o mayor.' })
  @IsInt({ message: 'page debe ser un número entero.' })
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @Max(100, { message: 'perPage no puede superar 100.' })
  @Min(1, { message: 'perPage debe ser 1 o mayor.' })
  @IsInt({ message: 'perPage debe ser un número entero.' })
  // Igual que FILAS_POR_DEFECTO del front: las tablas arrancan en 5 filas
  perPage: number = 5;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @MaxLength(100, { message: 'La búsqueda no puede superar 100 caracteres.' })
  @IsString({ message: 'La búsqueda debe ser un texto.' })
  search?: string;
}

export function paginar<T>(
  data: T[],
  total: number,
  { page, perPage }: ListadoQueryDto,
): Paginado<T> {
  return {
    data,
    meta: {
      page,
      perPage,
      total,
      lastPage: Math.max(1, Math.ceil(total / perPage)),
    },
  };
}

/** Escapa % _ \ para que el texto buscado se compare literalmente dentro de un LIKE. */
export function escaparLike(texto: string): string {
  return texto.replace(/[\\%_]/g, '\\$&');
}
