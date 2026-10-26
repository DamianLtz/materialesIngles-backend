import { MigrationInterface, QueryRunner } from 'typeorm';

export class TiposReclamo1792690872987 implements MigrationInterface {
  name = 'TiposReclamo1792690872987';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tipos_reclamo" ALTER COLUMN "leyenda" DROP NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_tipos_reclamo_nombre" ON "tipos_reclamo"  ("nombre") WHERE "deleted_at" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."uq_tipos_reclamo_nombre"`);
    await queryRunner.query(
      `ALTER TABLE "tipos_reclamo" ALTER COLUMN "leyenda" SET NOT NULL`,
    );
  }
}
