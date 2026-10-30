-- Estabelecimentos criados antes do novo padrão ficaram com false: liga para todos
UPDATE "businesses" SET "requires_confirmation" = true WHERE "requires_confirmation" = false;
