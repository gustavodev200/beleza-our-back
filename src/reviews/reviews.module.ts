import { Body, Controller, Injectable, Module, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { CurrentUser, Roles, type AuthUser } from '../auth/decorators';
import { Errors } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';

export const REVIEW_TAGS = [
  'PUNCTUAL',
  'ATTENTIVE',
  'CLEAN_ENVIRONMENT',
  'GREAT_RESULT',
  'FAIR_PRICE',
] as const;

const reviewSchema = z
  .object({
    rating: z.number().int().min(1).max(5),
    tags: z.array(z.enum(REVIEW_TAGS)).max(REVIEW_TAGS.length).default([]),
    comment: z.string().trim().max(500).optional(),
  })
  .strict();
class ReviewDto extends createZodDto(reviewSchema) {}

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Uma avaliação por agendamento COMPLETED da própria cliente (FR-045). A
   * média é recalculada na mesma transação, com a linha do estabelecimento
   * travada para avaliações simultâneas não perderem atualização.
   */
  async create(clientId: string, appointmentId: string, dto: ReviewDto) {
    const appointment = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, clientId },
      select: { id: true, status: true, businessId: true, review: { select: { id: true } } },
    });
    if (!appointment) throw Errors.notFound('Agendamento');
    if (appointment.review) throw Errors.alreadyReviewed();
    if (appointment.status !== 'COMPLETED') {
      throw Errors.unprocessable('NOT_COMPLETED', 'Só é possível avaliar atendimentos concluídos');
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM businesses WHERE id = ${appointment.businessId} FOR UPDATE`;
        const review = await tx.review.create({
          data: {
            appointmentId,
            businessId: appointment.businessId,
            clientId,
            rating: dto.rating,
            tags: [...new Set(dto.tags)],
            comment: dto.comment || null,
          },
          select: { id: true, rating: true, tags: true, comment: true, createdAt: true },
        });
        const stats = await tx.review.aggregate({
          where: { businessId: appointment.businessId },
          _avg: { rating: true },
          _count: { _all: true },
        });
        await tx.business.update({
          where: { id: appointment.businessId },
          data: {
            ratingAvg: new Prisma.Decimal((stats._avg.rating ?? 0).toFixed(2)),
            ratingCount: stats._count._all,
          },
        });
        return review;
      });
    } catch (e) {
      // Dois envios simultâneos: a unique de appointment_id barra o segundo.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
        throw Errors.alreadyReviewed();
      throw e;
    }
  }
}

@ApiTags('Cliente · Avaliações')
@Roles('CLIENT')
@Controller('me/appointments')
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Post(':id/review')
  create(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewDto,
  ) {
    return this.reviews.create(user.id, id, dto);
  }
}

@Module({ controllers: [ReviewsController], providers: [ReviewsService] })
export class ReviewsModule {}
