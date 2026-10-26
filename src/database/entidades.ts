import { Catalogo } from '../catalogos/entities/catalogo.entity.js';
import { Libro } from '../catalogos/entities/libro.entity.js';
import { Escuela } from '../escuelas/entities/escuela.entity.js';
import { Etapa } from '../etapas/entities/etapa.entity.js';
import { Oferta } from '../etapas/entities/oferta.entity.js';
import { Grado } from '../grados/entities/grado.entity.js';
import { Pedido } from '../pedidos/entities/pedido.entity.js';
import { Reclamo } from '../reclamos/entities/reclamo.entity.js';
import { TipoReclamo } from '../reclamos/entities/tipo-reclamo.entity.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';

/**
 * Todas las entidades, para la app y para el CLI de migraciones. Las relaciones
 * entre entidades necesitan que estén todas registradas, no solo las de un módulo.
 * Al crear una entidad nueva hay que sumarla acá.
 */
export const ENTIDADES = [
  Catalogo,
  Escuela,
  Etapa,
  Grado,
  Libro,
  Oferta,
  Pedido,
  Reclamo,
  TipoReclamo,
  Usuario,
];
