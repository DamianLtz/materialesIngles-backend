import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { MAX_FILAS } from '../lector-excel.js';

/** El texto se recorta; un número (ej. la cantidad editada en pantalla) pasa a texto. */
const aTexto = ({ value }: { value: unknown }) =>
  typeof value === 'number'
    ? String(value)
    : typeof value === 'string'
      ? value.trim()
      : value;

/** Una fila para guardar: lo mismo que se leyó del Excel. El servidor vuelve a validarla. */
export class FilaGuardarDto {
  // class-validator evalúa de abajo hacia arriba: el tipo se chequea primero
  @IsOptional()
  @Min(1, { message: 'La fila no es válida.' })
  @IsInt({ message: 'La fila no es válida.' })
  fila?: number;

  @Transform(aTexto)
  @MaxLength(50, { message: 'El CUE/Anexo es demasiado largo.' })
  @IsString({ message: 'El CUE/Anexo debe ser un texto.' })
  cueanexo: string;

  @Transform(aTexto)
  @MaxLength(50, { message: 'El ISBN es demasiado largo.' })
  @IsString({ message: 'El ISBN debe ser un texto.' })
  isbn: string;

  @Transform(aTexto)
  @MaxLength(20, { message: 'La cantidad es demasiado larga.' })
  @IsString({ message: 'La cantidad es obligatoria.' })
  cantidad: string;

  @IsOptional()
  @Transform(aTexto)
  @MaxLength(100, { message: 'El grado es demasiado largo.' })
  @IsString({ message: 'El grado debe ser un texto.' })
  grado?: string;
}

/** Cuerpo de POST mass-assignment/save. */
export class GuardarMasivoDto {
  @ValidateNested({ each: true })
  @Type(() => FilaGuardarDto)
  @ArrayMaxSize(MAX_FILAS, {
    message: `Son demasiadas filas: el máximo es ${MAX_FILAS}.`,
  })
  @ArrayMinSize(1, { message: 'No hay filas para guardar.' })
  @IsArray({ message: 'Las filas son obligatorias.' })
  filas: FilaGuardarDto[];
}

/** Cuerpo de POST mass-assignment/sync: un mismo libro y cantidad para varias escuelas. */
export class SyncMasivoDto {
  @Transform(aTexto)
  @MaxLength(50, { message: 'El ISBN es demasiado largo.' })
  @IsString({ message: 'El ISBN es obligatorio.' })
  isbn: string;

  @Transform(aTexto)
  @MaxLength(20, { message: 'La cantidad es demasiado larga.' })
  @IsString({ message: 'La cantidad es obligatoria.' })
  cantidad: string;

  @Transform(({ value }: { value: unknown }) =>
    Array.isArray(value) ? value.map((v) => aTexto({ value: v })) : value,
  )
  @IsString({ each: true, message: 'Los CUE/Anexo deben ser texto.' })
  @ArrayUnique({ message: 'Hay CUE/Anexo repetidos.' })
  @ArrayMaxSize(MAX_FILAS, {
    message: `Son demasiadas escuelas: el máximo es ${MAX_FILAS}.`,
  })
  @ArrayMinSize(1, { message: 'Indicá al menos una escuela.' })
  @IsArray({ message: 'Las escuelas son obligatorias.' })
  cueanexos: string[];
}
