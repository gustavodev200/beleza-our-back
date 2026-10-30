-- Confirmação manual de agendamentos ligada por padrão
ALTER TABLE "businesses" ALTER COLUMN "requires_confirmation" SET DEFAULT true;
