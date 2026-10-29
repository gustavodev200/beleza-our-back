import { Injectable } from '@nestjs/common';
import type { Business } from '@prisma/client';
import { Errors } from '../common/errors';
import { detectImageKind, MAX_IMAGE_BYTES } from '../common/utils/image';
import { StorageService, type ImageSlot } from '../integrations/storage/storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessesService } from './businesses.service';

@Injectable()
export class BusinessImagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly businesses: BusinessesService,
  ) {}

  /** Valida pelo conteúdo antes de qualquer armazenamento (file-uploads.md). */
  async upload(business: Business, slot: ImageSlot, file: Express.Multer.File | undefined) {
    this.businesses.assertEditable(business);
    if (!file?.buffer || file.size > MAX_IMAGE_BYTES || !detectImageKind(file.buffer)) {
      throw Errors.invalidImage();
    }
    const url = await this.storage.uploadBusinessImage(business.id, slot, file.buffer);
    await this.prisma.business.update({
      where: { id: business.id },
      data: slot === 'cover' ? { coverUrl: url } : { logoUrl: url },
    });
    return this.businesses.getOwnView(business.id);
  }
}
