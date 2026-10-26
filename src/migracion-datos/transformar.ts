/**
 * Traduce los datos del sistema original (Laravel, MySQL) al esquema nuevo (Postgres).
 * Funciones puras: no tocan ninguna base, así se pueden probar con datos armados a mano.
 *
 * Reglas acordadas con el usuario el 23/10/2026 (ver MIGRACION.md):
 * - roles: "Super Admin" → super_admin, "Admin" → admin, "Usuario" → operador;
 * - claims_backup y las tablas propias de Laravel/permisos no se migran;
 * - pedidos vigentes repetidos (misma escuela y oferta): queda el de id menor, el resto se
 *   borra lógicamente con la fecha de la migración;
 * - cantidad_maxima de cada oferta = la mayor entre 100 y lo más alto pedido en ella
 *   (el original la dejaba en 1 y no la controlaba);
 * - ofertas y pedidos vigentes de una etapa borrada se borran con la fecha de la etapa
 *   (y los reclamos de esos pedidos, con la misma fecha).
 * Se conservan los ids, los timestamps y los borrados lógicos del original.
 */

// ---------- Origen (columnas tal cual están en MySQL; fechas como texto) ----------

/** 'aaaa-mm-dd hh:mm:ss' en UTC (Laravel guardaba en UTC) o null. */
type Momento = string | null;

interface Tiempos {
  created_at: Momento;
  updated_at: Momento;
  deleted_at: Momento;
}

export interface OrigenNombre extends Tiempos {
  id: number;
  name: string;
}

export interface OrigenLibro extends Tiempos {
  id: number;
  isbn_number: string;
  option_type_id: number;
  book_type_id: number;
  publisher: string;
  title: string;
}

export interface OrigenEscuela extends Tiempos {
  id: number;
  cueanexo: string;
  name: string;
  disctrict_number: number;
  description: string | null;
  street: string;
  street_number: number;
  postal_code: string;
}

export interface OrigenEtapa extends Tiempos {
  id: number;
  name: string;
  /** Fechas como 'aaaa-mm-dd'. */
  start: string | null;
  end: string | null;
  legend: string | null;
  claim_start: string | null;
  claim_end: string | null;
  claim_legend: string | null;
  view: number;
}

export interface OrigenOferta extends Tiempos {
  id: number;
  order_id: number;
  option_type_id: number;
  book_type_id: number;
  max_quantity: number;
}

export interface OrigenAsignacion {
  order_id: number;
  school_id: number;
}

export interface OrigenPedido extends Tiempos {
  id: number;
  school_id: number;
  option_id: number;
  book_id: number;
  quantity: number;
}

export interface OrigenTipoReclamo extends Tiempos {
  id: number;
  name: string;
  legend: string | null;
}

export interface OrigenReclamo extends Tiempos {
  id: number;
  order_request_id: number;
  claim_type_id: number;
  quantity: number | null;
  file_path: string | null;
  status: string | null;
}

export interface OrigenUsuario extends Tiempos {
  id: number;
  name: string;
  email: string;
  google_id: string | null;
  active: number;
}

/** Fila de model_has_roles con el nombre del rol ya resuelto. */
export interface OrigenRolUsuario {
  model_id: number;
  rol: string;
}

export interface Origen {
  grados: OrigenNombre[]; // option_types
  catalogos: OrigenNombre[]; // book_types
  libros: OrigenLibro[];
  escuelas: OrigenEscuela[];
  etapas: OrigenEtapa[]; // orders
  ofertas: OrigenOferta[]; // options
  asignaciones: OrigenAsignacion[]; // order_school
  pedidos: OrigenPedido[]; // order_requests
  tiposReclamo: OrigenTipoReclamo[];
  reclamos: OrigenReclamo[];
  usuarios: OrigenUsuario[];
  rolesUsuario: OrigenRolUsuario[];
}

// ---------- Destino (columnas de Postgres) ----------

/** Fila lista para insertar: columna → valor. */
export type Fila = Record<string, string | number | boolean | null>;

/** Orden de inserción: respeta las claves foráneas. */
export const TABLAS_DESTINO = [
  'grados',
  'catalogos',
  'libros',
  'escuelas',
  'etapas',
  'ofertas',
  'etapa_escuela',
  'pedidos',
  'tipos_reclamo',
  'reclamos',
  'usuarios',
] as const;

export type TablaDestino = (typeof TABLAS_DESTINO)[number];

export interface Resumen {
  pedidosDuplicadosBorrados: number;
  ofertasBorradasPorEtapa: number;
  pedidosBorradosPorEtapa: number;
  reclamosBorradosPorPedido: number;
  ofertasConCantidadAjustada: number;
}

export interface Resultado {
  filas: Record<TablaDestino, Fila[]>;
  resumen: Resumen;
}

export const ROLES: Record<string, 'super_admin' | 'admin' | 'operador'> = {
  'Super Admin': 'super_admin',
  Admin: 'admin',
  Usuario: 'operador',
};

const ESTADOS = new Set([
  'pendiente',
  'en_proceso',
  'resuelto',
  'rechazado',
  'historico',
]);

export const CANTIDAD_MAXIMA_MINIMA = 100;

/** 'aaaa-mm-dd hh:mm:ss' (UTC) → ISO con zona, para una columna timestamptz. */
export function aUtc(momento: Momento): string | null {
  if (!momento) return null;
  return `${momento.replace(' ', 'T')}Z`;
}

/** created_at/updated_at son NOT NULL en el destino: si faltan, se usa el otro o la fecha de la migración. */
function tiempos(fila: Tiempos, ahora: string) {
  const creado = aUtc(fila.created_at) ?? aUtc(fila.updated_at) ?? ahora;
  return {
    created_at: creado,
    updated_at: aUtc(fila.updated_at) ?? creado,
    deleted_at: aUtc(fila.deleted_at),
  };
}

/** Errores que impiden migrar (datos que el esquema nuevo no acepta y no tienen regla acordada). */
export class ErrorDeDatos extends Error {}

/**
 * Arma todas las filas del destino. `ahora` (ISO) es la fecha con la que se marcan los
 * borrados que hace la migración (pedidos repetidos).
 */
export function transformar(origen: Origen, ahora: string): Resultado {
  const errores: string[] = [];
  const resumen: Resumen = {
    pedidosDuplicadosBorrados: 0,
    ofertasBorradasPorEtapa: 0,
    pedidosBorradosPorEtapa: 0,
    reclamosBorradosPorPedido: 0,
    ofertasConCantidadAjustada: 0,
  };

  const nombre = (f: OrigenNombre): Fila => ({
    id: f.id,
    nombre: f.name,
    ...tiempos(f, ahora),
  });

  // --- Etapas y ofertas (con el borrado en cascada desde la etapa)
  const borradoEtapa = new Map(
    origen.etapas.map((e) => [e.id, aUtc(e.deleted_at)]),
  );
  const borradoOferta = new Map<number, string | null>();
  for (const o of origen.ofertas) {
    const propio = aUtc(o.deleted_at);
    const deEtapa = borradoEtapa.get(o.order_id) ?? null;
    if (!propio && deEtapa) resumen.ofertasBorradasPorEtapa++;
    borradoOferta.set(o.id, propio ?? deEtapa);
  }

  // --- Pedidos: cascada desde la oferta y luego un solo vigente por escuela y oferta
  const borradoPedido = new Map<number, string | null>();
  /** Pedidos que borró la migración (para llevar sus reclamos con ellos). */
  const borradoPorMigracion = new Map<number, string>();
  for (const p of origen.pedidos) {
    const propio = aUtc(p.deleted_at);
    const deOferta = borradoOferta.get(p.option_id) ?? null;
    if (!propio && deOferta) {
      resumen.pedidosBorradosPorEtapa++;
      borradoPorMigracion.set(p.id, deOferta);
    }
    borradoPedido.set(p.id, propio ?? deOferta);
  }
  const vigentePorClave = new Map<string, number>();
  for (const p of [...origen.pedidos].sort((a, b) => a.id - b.id)) {
    if (borradoPedido.get(p.id)) continue;
    const clave = `${p.school_id}-${p.option_id}`;
    if (vigentePorClave.has(clave)) {
      borradoPedido.set(p.id, ahora);
      borradoPorMigracion.set(p.id, ahora);
      resumen.pedidosDuplicadosBorrados++;
    } else {
      vigentePorClave.set(clave, p.id);
    }
  }

  // --- Cantidad máxima: lo más alto pedido (entre los pedidos que quedan vigentes)
  const maximoPedido = new Map<number, number>();
  for (const p of origen.pedidos) {
    if (borradoPedido.get(p.id)) continue;
    maximoPedido.set(
      p.option_id,
      Math.max(maximoPedido.get(p.option_id) ?? 0, p.quantity),
    );
  }

  const ofertas = origen.ofertas.map((o): Fila => {
    const cantidadMaxima = Math.max(
      CANTIDAD_MAXIMA_MINIMA,
      maximoPedido.get(o.id) ?? 0,
    );
    if (cantidadMaxima !== o.max_quantity) resumen.ofertasConCantidadAjustada++;
    return {
      id: o.id,
      etapa_id: o.order_id,
      grado_id: o.option_type_id,
      catalogo_id: o.book_type_id,
      cantidad_maxima: cantidadMaxima,
      ...tiempos(o, ahora),
      deleted_at: borradoOferta.get(o.id) ?? null,
    };
  });

  const pedidos = origen.pedidos.map((p): Fila => ({
    id: p.id,
    escuela_id: p.school_id,
    oferta_id: p.option_id,
    libro_id: p.book_id,
    cantidad: p.quantity,
    ...tiempos(p, ahora),
    deleted_at: borradoPedido.get(p.id) ?? null,
  }));

  // --- Reclamos
  const reclamos = origen.reclamos.map((r): Fila => {
    const estado = r.status ?? '';
    if (!ESTADOS.has(estado)) {
      errores.push(`Reclamo ${r.id}: estado desconocido "${r.status}".`);
    }
    const propio = aUtc(r.deleted_at);
    const dePedido = borradoPorMigracion.get(r.order_request_id) ?? null;
    if (!propio && dePedido) resumen.reclamosBorradosPorPedido++;
    return {
      id: r.id,
      pedido_id: r.order_request_id,
      tipo_reclamo_id: r.claim_type_id,
      cantidad: r.quantity,
      archivo: r.file_path,
      estado,
      ...tiempos(r, ahora),
      deleted_at: propio ?? dePedido,
    };
  });

  // --- Usuarios: rol por nombre; un vigente sin rol (o con uno desconocido) no se puede migrar
  const rolesDe = new Map<number, string[]>();
  for (const { model_id, rol } of origen.rolesUsuario) {
    rolesDe.set(model_id, [...(rolesDe.get(model_id) ?? []), rol]);
  }
  const usuarios = origen.usuarios.map((u): Fila => {
    const roles = rolesDe.get(u.id) ?? [];
    const vigente = !u.deleted_at;
    let rol = roles.length === 1 ? ROLES[roles[0]] : undefined;
    if (!rol) {
      if (vigente) {
        errores.push(
          `Usuario ${u.id}: ${roles.length === 0 ? 'no tiene rol' : `roles sin equivalencia: ${roles.join(', ')}`}.`,
        );
      }
      // Uno borrado sin rol no entra nunca: se migra con el rol mínimo
      rol = 'operador';
    }
    return {
      id: u.id,
      nombre: u.name,
      email: u.email.trim().toLowerCase(),
      google_id: u.google_id,
      avatar_url: null,
      rol,
      activo: u.active === 1,
      version_sesion: 0,
      ...tiempos(u, ahora),
    };
  });

  if (errores.length > 0) throw new ErrorDeDatos(errores.join('\n'));

  // La tabla pivot no tiene borrado lógico ni timestamps; se descartan pares repetidos
  const pares = new Set<string>();
  const asignaciones: Fila[] = [];
  for (const a of origen.asignaciones) {
    const clave = `${a.order_id}-${a.school_id}`;
    if (pares.has(clave)) continue;
    pares.add(clave);
    asignaciones.push({ etapa_id: a.order_id, escuela_id: a.school_id });
  }

  return {
    filas: {
      grados: origen.grados.map(nombre),
      catalogos: origen.catalogos.map(nombre),
      libros: origen.libros.map((l) => ({
        id: l.id,
        isbn: l.isbn_number,
        titulo: l.title,
        editorial: l.publisher,
        grado_id: l.option_type_id,
        catalogo_id: l.book_type_id,
        ...tiempos(l, ahora),
      })),
      escuelas: origen.escuelas.map((e) => ({
        id: e.id,
        cueanexo: e.cueanexo,
        nombre: e.name,
        distrito: e.disctrict_number,
        descripcion: e.description,
        calle: e.street,
        altura: e.street_number,
        codigo_postal: e.postal_code,
        ...tiempos(e, ahora),
      })),
      etapas: origen.etapas.map((e) => ({
        id: e.id,
        nombre: e.name,
        fecha_inicio: e.start,
        fecha_fin: e.end,
        leyenda: e.legend,
        reclamo_inicio: e.claim_start,
        reclamo_fin: e.claim_end,
        reclamo_leyenda: e.claim_legend,
        visible: e.view === 1,
        ...tiempos(e, ahora),
      })),
      ofertas,
      etapa_escuela: asignaciones,
      pedidos,
      tipos_reclamo: origen.tiposReclamo.map((t) => ({
        id: t.id,
        nombre: t.name,
        leyenda: t.legend,
        ...tiempos(t, ahora),
      })),
      reclamos,
      usuarios,
    },
    resumen,
  };
}
