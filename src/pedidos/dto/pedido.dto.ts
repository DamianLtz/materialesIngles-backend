import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ListadoQueryDto } from '../../common/listado.js';

/** ?page=&perPage=&search=&etapaId= del listado de pedidos. */
export class ListadoPedidosQueryDto extends ListadoQueryDto {
  // class-validator evalúa de abajo hacia arriba: el tipo se chequea primero
  @IsOptional()
  @Type(() => Number)
  @Min(1, { message: 'etapaId debe ser 1 o mayor.' })
  @IsInt({ message: 'etapaId debe ser un número entero.' })
  etapaId?: number;
}

/** Un cambio sobre el pedido de una oferta: asignar o cambiar un libro, o quitarlo (libroId null). */
export class CambioPedidoDto {
  @Min(1, { message: 'La oferta no es válida.' })
  @IsInt({ message: 'La oferta es obligatoria.' })
  ofertaId: number;

  // null = quitar el pedido; si falta, es un error (no se interpreta como quitar)
  @ValidateIf((cambio: CambioPedidoDto) => cambio.libroId !== null)
  @Min(1, { message: 'El libro no es válido.' })
  @IsInt({ message: 'El libro es obligatorio (o null para quitar el pedido).' })
  libroId: number | null;

  // El tope real (cantidad máxima de la oferta) lo verifica el servicio
  @ValidateIf((cambio: CambioPedidoDto) => cambio.libroId !== null)
  @Max(100000, { message: 'La cantidad es demasiado grande.' })
  @Min(1, { message: 'La cantidad debe ser 1 o mayor.' })
  @IsInt({ message: 'La cantidad debe ser un número entero.' })
  cantidad?: number;
}

/** Cuerpo de POST escuelas/:id/pedidos/sync. */
export class SincronizarPedidosDto {
  @ValidateNested({ each: true })
  @Type(() => CambioPedidoDto)
  @ArrayMaxSize(200, { message: 'Son demasiados cambios en una sola vez.' })
  @ArrayMinSize(1, { message: 'No hay cambios para guardar.' })
  @IsArray({ message: 'Los cambios son obligatorios.' })
  cambios: CambioPedidoDto[];
}

/** ?search= de la búsqueda de libros de una oferta. */
export class BuscarLibrosQueryDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @MaxLength(100, { message: 'La búsqueda no puede superar 100 caracteres.' })
  @IsString({ message: 'La búsqueda debe ser un texto.' })
  search?: string;
}
