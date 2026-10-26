import { MigrationInterface, QueryRunner } from 'typeorm';

export class EtapasUnicidad1792701087020 implements MigrationInterface {
  name = 'EtapasUnicidad1792701087020';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_ofertas_etapa_grado_catalogo" ON "ofertas"  ("etapa_id", "grado_id", "catalogo_id") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_etapas_visible" ON "etapas"  ("visible") WHERE "visible" AND "deleted_at" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."uq_etapas_visible"`);
    await queryRunner.query(
      `DROP INDEX "public"."uq_ofertas_etapa_grado_catalogo"`,
    );
  }
}
