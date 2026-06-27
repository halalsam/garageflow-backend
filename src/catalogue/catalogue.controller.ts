import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CatalogueService } from './catalogue.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateCatalogueItemDto } from './dto/create-catalogue-item.dto';
import { UpdateCatalogueItemDto } from './dto/update-catalogue-item.dto';

@ApiTags('catalogue')
@ApiBearerAuth('access-token')
@Controller('catalogue')
export class CatalogueController {
  constructor(private readonly catalogue: CatalogueService) {}

  // Read: any authenticated role.
  @Get()
  list(@Query('kind') kind?: string) {
    return this.catalogue.list(kind);
  }

  // Manage: ADMIN only.
  @Post()
  @Roles(UserRole.ADMIN)
  create(@Body() dto: CreateCatalogueItemDto) {
    return this.catalogue.create(dto);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  update(@Param('id') id: string, @Body() dto: UpdateCatalogueItemDto) {
    return this.catalogue.update(id, dto);
  }
}
