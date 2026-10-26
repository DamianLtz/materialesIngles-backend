import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { ListadoQueryDto } from '../../common/listado.js';
import { EstadoReclamo } from '../entities/reclamo.entity.js';

/** Estados que se pueden elegir a mano. "histórico" solo lo pone la acción de archivar. */
export const ESTADOS_EDITABLES = [
  EstadoReclamo.Pendiente,
  EstadoReclamo.EnProceso,
  EstadoReclamo.Resuelto,
  EstadoReclamo.Rechazado,
] as const;

/** ?page=&perPage=&search=&etapaId=&estado= del listado de reclamos. */
export class ListadoReclamosQueryDto extends ListadoQueryDto {
  // class-validator evalúa de abajo hacia arriba: el tipo se chequea primero
  @IsOptional()
  @Type(() => Number)
  @Min(1, { message: 'etapaId debe ser 1 o mayor.' })
  @IsInt({ message: 'etapaId debe ser un número entero.' })
  etapaId?: number;

  @IsOptional()
  @IsEnum(EstadoReclamo, { message: 'El estado no es válido.' })
  estado?: EstadoReclamo;
}

/** Cuerpo de PATCH reclamos/:id/estado. */
export class CambiarEstadoDto {
  @IsIn(ESTADOS_EDITABLES, { message: 'El estado no es válido.' })
  estado: (typeof ESTADOS_EDITABLES)[number];
}
