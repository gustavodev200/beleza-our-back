import {
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Business } from '@prisma/client';
import { CurrentUser, Roles, type AuthUser } from '../auth/decorators';
import { MAX_IMAGE_BYTES } from '../common/utils/image';
import { BusinessImagesService } from './business-images.service';
import { CreateBusinessDto, HoursDto, UpdateBusinessDto } from './business.schemas';
import { BusinessesService } from './businesses.service';
import { OwnerBusiness, OwnerBusinessGuard } from './owner-business.guard';

const imageUpload = FileInterceptor('file', { limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } });

@ApiTags('Dono · Estabelecimento')
@Roles('BUSINESS_OWNER')
@Controller('owner/business')
export class OwnerBusinessController {
  constructor(
    private readonly businesses: BusinessesService,
    private readonly images: BusinessImagesService,
  ) {}

  @Get()
  @UseGuards(OwnerBusinessGuard)
  get(@OwnerBusiness() business: Business) {
    return this.businesses.getOwnView(business.id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateBusinessDto) {
    return this.businesses.create(user.id, dto);
  }

  @Patch()
  @UseGuards(OwnerBusinessGuard)
  update(@OwnerBusiness() business: Business, @Body() dto: UpdateBusinessDto) {
    return this.businesses.update(business, dto);
  }

  @Put('hours')
  @UseGuards(OwnerBusinessGuard)
  hours(@OwnerBusiness() business: Business, @Body() dto: HoursDto) {
    return this.businesses.replaceHours(business, dto);
  }

  @Post('cover')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @UseGuards(OwnerBusinessGuard)
  @UseInterceptors(imageUpload)
  cover(
    @OwnerBusiness() business: Business,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.images.upload(business, 'cover', file);
  }

  @Post('logo')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @UseGuards(OwnerBusinessGuard)
  @UseInterceptors(imageUpload)
  logo(@OwnerBusiness() business: Business, @UploadedFile() file: Express.Multer.File | undefined) {
    return this.images.upload(business, 'logo', file);
  }

  @Post('submit')
  @HttpCode(200)
  @UseGuards(OwnerBusinessGuard)
  submit(@OwnerBusiness() business: Business, @CurrentUser() user: AuthUser) {
    return this.businesses.submit(business, user.emailVerified);
  }
}
