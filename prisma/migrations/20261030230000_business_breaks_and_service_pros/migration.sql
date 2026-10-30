-- Bloqueio sem profissional = pausa do estabelecimento todo
ALTER TYPE "BlockReason" ADD VALUE 'BREAK';
ALTER TABLE "time_blocks" ALTER COLUMN "professional_id" DROP NOT NULL;

-- Serviços criados sem profissional ficavam invisíveis para as clientes:
-- passam a ser feitos por todas as profissionais ativas do estabelecimento.
INSERT INTO "professional_services" ("professional_id", "service_id")
SELECT p."id", s."id"
FROM "services" s
JOIN "professionals" p ON p."business_id" = s."business_id" AND p."active"
WHERE NOT EXISTS (SELECT 1 FROM "professional_services" ps WHERE ps."service_id" = s."id");
