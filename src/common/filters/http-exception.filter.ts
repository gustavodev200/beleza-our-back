import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { ZodValidationException } from 'nestjs-zod';
import { isOverlapViolation } from '../errors';

interface ErrorBody {
  statusCode: number;
  code?: string;
  message: string | string[];
  errors?: unknown;
  path: string;
  timestamp: string;
}

/** Formato único de erro; nunca vaza stack, SQL ou detalhe do Prisma. */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpException');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    // Só o caminho: query string pode carregar tokens.
    const path = (request.originalUrl ?? request.url ?? '').split('?')[0];

    const body = this.toBody(exception);
    if (body.statusCode >= 500) {
      this.logger.error(
        `${request.method} ${path} → ${body.statusCode}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }
    response.status(body.statusCode).json({ ...body, path, timestamp: new Date().toISOString() });
  }

  private toBody(exception: unknown): Omit<ErrorBody, 'path' | 'timestamp'> {
    if (exception instanceof ZodValidationException) {
      const issues = exception.getZodError() as { issues?: { path: unknown[]; message: string }[] };
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        code: 'VALIDATION_ERROR',
        message: 'Dados inválidos',
        errors: (issues.issues ?? []).map((i) => ({ path: i.path.join('.'), message: i.message })),
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'string') return { statusCode: status, message: res };
      const r = res as { code?: string; message?: string | string[] };
      return { statusCode: status, code: r.code, message: r.message ?? exception.message };
    }

    if (isOverlapViolation(exception)) {
      return {
        statusCode: HttpStatus.CONFLICT,
        code: 'SLOT_TAKEN',
        message: 'Esse horário acabou de ser reservado',
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        return { statusCode: HttpStatus.CONFLICT, code: 'CONFLICT', message: 'Registro duplicado' };
      }
      if (exception.code === 'P2025') {
        return {
          statusCode: HttpStatus.NOT_FOUND,
          code: 'NOT_FOUND',
          message: 'Recurso não encontrado',
        };
      }
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'Erro interno. Tente novamente.',
    };
  }
}
