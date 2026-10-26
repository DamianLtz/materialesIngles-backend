import {
  aUtc,
  ErrorDeDatos,
  transformar,
  type Origen,
  type OrigenPedido,
} from './transformar.js';

const AHORA = '2026-10-23T12:00:00.000Z';
const T = {
  created_at: '2025-01-01 10:00:00',
  updated_at: '2025-01-02 10:00:00',
  deleted_at: null,
};
const BORRADO = '2026-03-01 08:00:00';

/** Origen mínimo y válido; cada test cambia lo que necesita. */
function origen(cambios: Partial<Origen> = {}): Origen {
  return {
    grados: [{ id: 1, name: '1er Grado', ...T }],
    catalogos: [{ id: 1, name: 'Ingles', ...T }],
    libros: [
      {
        id: 1,
        isbn_number: '978',
        option_type_id: 1,
        book_type_id: 1,
        publisher: 'Ed',
        title: 'Libro',
        ...T,
      },
    ],
    escuelas: [
      {
        id: 1,
        cueanexo: '20000100',
        name: 'Escuela 1',
        disctrict_number: 3,
        description: null,
        street: 'Calle',
        street_number: 10,
        postal_code: '1000',
        ...T,
      },
    ],
    etapas: [
      {
        id: 1,
        name: 'Etapa',
        start: '2026-03-01',
        end: '2026-03-10',
        legend: null,
        claim_start: null,
        claim_end: null,
        claim_legend: null,
        view: 1,
        ...T,
      },
    ],
    ofertas: [
      {
        id: 1,
        order_id: 1,
        option_type_id: 1,
        book_type_id: 1,
        max_quantity: 1,
        ...T,
      },
    ],
    asignaciones: [{ order_id: 1, school_id: 1 }],
    pedidos: [],
    tiposReclamo: [{ id: 1, name: 'Faltante', legend: 'x', ...T }],
    reclamos: [],
    usuarios: [
      {
        id: 1,
        name: 'Ana',
        email: ' Ana@BUE.edu.ar ',
        google_id: null,
        active: 1,
        ...T,
      },
    ],
    rolesUsuario: [{ model_id: 1, rol: 'Super Admin' }],
    ...cambios,
  };
}

const pedido = (
  id: number,
  cambios: Partial<OrigenPedido> = {},
): OrigenPedido => ({
  id,
  school_id: 1,
  option_id: 1,
  book_id: 1,
  quantity: 5,
  ...T,
  ...cambios,
});

describe('transformar', () => {
  it('renombra columnas y conserva ids y timestamps en UTC', () => {
    const { filas } = transformar(origen(), AHORA);
    expect(filas.escuelas[0]).toEqual({
      id: 1,
      cueanexo: '20000100',
      nombre: 'Escuela 1',
      distrito: 3,
      descripcion: null,
      calle: 'Calle',
      altura: 10,
      codigo_postal: '1000',
      created_at: '2025-01-01T10:00:00Z',
      updated_at: '2025-01-02T10:00:00Z',
      deleted_at: null,
    });
    expect(filas.etapas[0]).toMatchObject({
      nombre: 'Etapa',
      fecha_inicio: '2026-03-01',
      fecha_fin: '2026-03-10',
      visible: true,
    });
    expect(filas.libros[0]).toMatchObject({
      isbn: '978',
      titulo: 'Libro',
      editorial: 'Ed',
      grado_id: 1,
      catalogo_id: 1,
    });
    expect(filas.etapa_escuela).toEqual([{ etapa_id: 1, escuela_id: 1 }]);
  });

  it('usuarios: email en minúsculas, rol por nombre, sesión en 0, sin avatar', () => {
    const { filas } = transformar(
      origen({
        usuarios: [
          ...origen().usuarios,
          { ...origen().usuarios[0], id: 2, email: 'b@x', active: 0 },
          { ...origen().usuarios[0], id: 3, email: 'c@x' },
        ],
        rolesUsuario: [
          { model_id: 1, rol: 'Super Admin' },
          { model_id: 2, rol: 'Admin' },
          { model_id: 3, rol: 'Usuario' },
        ],
      }),
      AHORA,
    );
    expect(filas.usuarios.map((u) => [u.email, u.rol, u.activo])).toEqual([
      ['ana@bue.edu.ar', 'super_admin', true],
      ['b@x', 'admin', false],
      ['c@x', 'operador', true],
    ]);
    expect(filas.usuarios[0]).toMatchObject({
      version_sesion: 0,
      avatar_url: null,
    });
  });

  it('un usuario vigente sin rol frena la migración; uno borrado pasa como operador', () => {
    expect(() => transformar(origen({ rolesUsuario: [] }), AHORA)).toThrow(
      ErrorDeDatos,
    );
    const { filas } = transformar(
      origen({
        usuarios: [{ ...origen().usuarios[0], deleted_at: BORRADO }],
        rolesUsuario: [],
      }),
      AHORA,
    );
    expect(filas.usuarios[0].rol).toBe('operador');
  });

  it('un rol desconocido frena la migración', () => {
    expect(() =>
      transformar(
        origen({ rolesUsuario: [{ model_id: 1, rol: 'Otro' }] }),
        AHORA,
      ),
    ).toThrow(/roles sin equivalencia: Otro/);
  });

  it('un estado de reclamo desconocido frena la migración', () => {
    const reclamo = {
      id: 1,
      order_request_id: 1,
      claim_type_id: 1,
      quantity: null,
      file_path: null,
      status: 'raro',
      ...T,
    };
    expect(() =>
      transformar(origen({ pedidos: [pedido(1)], reclamos: [reclamo] }), AHORA),
    ).toThrow(/estado desconocido "raro"/);
  });

  it('pedidos repetidos: queda el de id menor; los demás se borran con la fecha de la migración', () => {
    const { filas, resumen } = transformar(
      origen({ pedidos: [pedido(7), pedido(3), pedido(9)] }),
      AHORA,
    );
    const borrado = Object.fromEntries(
      filas.pedidos.map((p) => [p.id, p.deleted_at]),
    );
    expect(borrado).toEqual({ 3: null, 7: AHORA, 9: AHORA });
    expect(resumen.pedidosDuplicadosBorrados).toBe(2);
  });

  it('un pedido ya borrado no cuenta como repetido', () => {
    const { resumen, filas } = transformar(
      origen({ pedidos: [pedido(1, { deleted_at: BORRADO }), pedido(2)] }),
      AHORA,
    );
    expect(resumen.pedidosDuplicadosBorrados).toBe(0);
    expect(filas.pedidos.find((p) => p.id === 2)?.deleted_at).toBeNull();
  });

  it('cantidad máxima: la mayor entre 100 y lo más alto pedido vigente', () => {
    const conPedidos = transformar(
      origen({
        pedidos: [
          pedido(1, { quantity: 148 }),
          pedido(2, { school_id: 2, quantity: 30 }),
          pedido(3, { school_id: 3, quantity: 500, deleted_at: BORRADO }),
        ],
      }),
      AHORA,
    );
    expect(conPedidos.filas.ofertas[0].cantidad_maxima).toBe(148);
    expect(conPedidos.resumen.ofertasConCantidadAjustada).toBe(1);

    const sinPedidos = transformar(origen(), AHORA);
    expect(sinPedidos.filas.ofertas[0].cantidad_maxima).toBe(100);
  });

  it('etapa borrada: borra sus ofertas, sus pedidos y los reclamos de esos pedidos con la fecha de la etapa', () => {
    const { filas, resumen } = transformar(
      origen({
        etapas: [{ ...origen().etapas[0], deleted_at: BORRADO }],
        pedidos: [pedido(1)],
        reclamos: [
          {
            id: 1,
            order_request_id: 1,
            claim_type_id: 1,
            quantity: 2,
            file_path: null,
            status: 'pendiente',
            ...T,
          },
        ],
      }),
      AHORA,
    );
    const fecha = aUtc(BORRADO);
    expect(filas.ofertas[0].deleted_at).toBe(fecha);
    expect(filas.pedidos[0].deleted_at).toBe(fecha);
    expect(filas.reclamos[0].deleted_at).toBe(fecha);
    expect(resumen).toMatchObject({
      ofertasBorradasPorEtapa: 1,
      pedidosBorradosPorEtapa: 1,
      reclamosBorradosPorPedido: 1,
      pedidosDuplicadosBorrados: 0,
    });
  });

  it('un reclamo vigente de un pedido que ya venía borrado se deja como está', () => {
    const { filas, resumen } = transformar(
      origen({
        pedidos: [pedido(1, { deleted_at: BORRADO })],
        reclamos: [
          {
            id: 1,
            order_request_id: 1,
            claim_type_id: 1,
            quantity: null,
            file_path: null,
            status: 'historico',
            ...T,
          },
        ],
      }),
      AHORA,
    );
    expect(filas.reclamos[0].deleted_at).toBeNull();
    expect(resumen.reclamosBorradosPorPedido).toBe(0);
  });

  it('pares etapa-escuela repetidos se cargan una sola vez', () => {
    const { filas } = transformar(
      origen({
        asignaciones: [
          { order_id: 1, school_id: 1 },
          { order_id: 1, school_id: 1 },
        ],
      }),
      AHORA,
    );
    expect(filas.etapa_escuela).toHaveLength(1);
  });

  it('timestamps faltantes: created_at toma updated_at o la fecha de la migración', () => {
    const { filas } = transformar(
      origen({
        grados: [
          {
            id: 1,
            name: 'G',
            created_at: null,
            updated_at: null,
            deleted_at: null,
          },
        ],
      }),
      AHORA,
    );
    expect(filas.grados[0]).toMatchObject({
      created_at: AHORA,
      updated_at: AHORA,
    });
  });
});
