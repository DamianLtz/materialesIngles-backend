import { MigrationInterface, QueryRunner } from "typeorm";

export class ReclamosUnicidad1792707191747 implements MigrationInterface {
    name = 'ReclamosUnicidad1792707191747'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE UNIQUE INDEX "uq_reclamos_pedido_tipo" ON "reclamos"  ("pedido_id", "tipo_reclamo_id") WHERE "deleted_at" IS NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."uq_reclamos_pedido_tipo"`);
    }

}
