import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { v2 as cloudinary, type UploadApiResponse } from 'cloudinary';
import { loadEnv } from '../../config/env';

export type ImageSlot = 'cover' | 'logo';

const SIZES: Record<ImageSlot, { width: number; height: number }> = {
  cover: { width: 1600, height: 600 },
  logo: { width: 512, height: 512 },
};

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly env = loadEnv();

  constructor() {
    // O SDK lê CLOUDINARY_URL do ambiente; aqui só forçamos HTTPS.
    cloudinary.config({ secure: true });
  }

  /**
   * Envia a imagem já validada. public_id determinístico por estabelecimento:
   * uma nova capa sobrescreve a anterior (Princípio XI — sem órfãos).
   */
  async uploadBusinessImage(businessId: string, slot: ImageSlot, buffer: Buffer): Promise<string> {
    if (this.env.NODE_ENV === 'test' || !this.env.CLOUDINARY_URL) {
      return `https://images.local/${this.env.NODE_ENV}/businesses/${businessId}/${slot}.webp`;
    }
    const { width, height } = SIZES[slot];
    try {
      const result = await new Promise<UploadApiResponse>((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            public_id: `${this.env.NODE_ENV}/businesses/${businessId}/${slot}`,
            overwrite: true,
            invalidate: true,
            resource_type: 'image',
            allowed_formats: ['jpg', 'png', 'webp'],
            transformation: [{ width, height, crop: 'fill', gravity: 'auto', quality: 'auto' }],
          },
          (error, res) =>
            error || !res ? reject(new Error(error?.message ?? 'upload vazio')) : resolve(res),
        );
        stream.end(buffer);
      });
      // f_auto entrega WebP/AVIF conforme o navegador.
      return result.secure_url.replace('/upload/', '/upload/f_auto,q_auto/');
    } catch (e) {
      this.logger.error(
        `Falha no upload (${slot}) do estabelecimento ${businessId}: ${e instanceof Error ? e.message : 'erro'}`,
      );
      throw new ServiceUnavailableException(
        'Não foi possível enviar a imagem agora. Tente novamente.',
      );
    }
  }
}
