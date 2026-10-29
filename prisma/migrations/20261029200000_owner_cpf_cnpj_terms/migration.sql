-- AlterTable
ALTER TABLE "users" ADD COLUMN     "cpf_cnpj" TEXT,
ADD COLUMN     "terms_accepted_at" TIMESTAMPTZ(3),
ADD COLUMN     "terms_version" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_cpf_cnpj_key" ON "users"("cpf_cnpj");
