import { HttpException, HttpStatus } from '@nestjs/common';

/** Erro de regra de negócio com código estável para o frontend (contracts/api.md). */
export class DomainError extends HttpException {
  constructor(status: HttpStatus, code: string, message: string) {
    super({ code, message }, status);
  }
}

export const Errors = {
  notFound: (what = 'Recurso') =>
    new DomainError(HttpStatus.NOT_FOUND, 'NOT_FOUND', `${what} não encontrado`),
  slotTaken: () =>
    new DomainError(HttpStatus.CONFLICT, 'SLOT_TAKEN', 'Esse horário acabou de ser reservado'),
  slotUnavailable: () =>
    new DomainError(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'SLOT_UNAVAILABLE',
      'Horário indisponível para este serviço',
    ),
  cancellationWindowClosed: () =>
    new DomainError(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'CANCELLATION_WINDOW_CLOSED',
      'O prazo para cancelamento gratuito já passou',
    ),
  invalidTransition: () =>
    new DomainError(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'INVALID_TRANSITION',
      'Ação não permitida para o status atual',
    ),
  businessNotActive: () =>
    new DomainError(
      HttpStatus.FORBIDDEN,
      'BUSINESS_NOT_ACTIVE',
      'O estabelecimento precisa estar aprovado para esta ação',
    ),
  businessIncomplete: (missing: string[]) =>
    new DomainError(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'BUSINESS_INCOMPLETE',
      `Cadastro incompleto: ${missing.join('; ')}`,
    ),
  professionalLimit: (max: number) =>
    new DomainError(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'PROFESSIONAL_LIMIT_REACHED',
      `Limite de ${max} profissionais ativas atingido`,
    ),
  phoneNotVerified: () =>
    new DomainError(
      HttpStatus.FORBIDDEN,
      'PHONE_NOT_VERIFIED',
      'Confirme seu WhatsApp para agendar',
    ),
  alreadyReviewed: () =>
    new DomainError(HttpStatus.CONFLICT, 'ALREADY_REVIEWED', 'Este atendimento já foi avaliado'),
  invalidImage: () =>
    new DomainError(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'INVALID_IMAGE',
      'Envie uma imagem JPEG, PNG ou WebP de até 5 MB',
    ),
  unprocessable: (code: string, message: string) =>
    new DomainError(HttpStatus.UNPROCESSABLE_ENTITY, code, message),
  conflict: (code: string, message: string) => new DomainError(HttpStatus.CONFLICT, code, message),
  forbidden: (code: string, message: string) =>
    new DomainError(HttpStatus.FORBIDDEN, code, message),
};

/**
 * Violação da exclusion constraint de agenda (SQLSTATE 23P01). Com driver
 * adapter o código chega aninhado de formas diferentes conforme a versão,
 * então procuramos o SQLSTATE ou o nome da constraint em todo o erro.
 */
export function isOverlapViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const haystack = `${String((error as Error).message ?? '')} ${safeJson(error)}`;
  return haystack.includes('23P01') || haystack.includes('appointments_no_overlap');
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}
