import { Module } from '@nestjs/common';
import { BusinessImagesService } from './business-images.service';
import { BusinessesService } from './businesses.service';
import { OwnerBusinessController } from './owner-business.controller';
import { OwnerBusinessGuard } from './owner-business.guard';

@Module({
  controllers: [OwnerBusinessController],
  providers: [BusinessesService, BusinessImagesService, OwnerBusinessGuard],
  exports: [BusinessesService, OwnerBusinessGuard],
})
export class BusinessesModule {}
