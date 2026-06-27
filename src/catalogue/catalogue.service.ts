import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { serializeCatalogueItem } from '../common/serializers';
import { apiToCatalogueKind } from '../common/enum-maps';
import { toPaise } from '../common/format';
import { CreateCatalogueItemDto } from './dto/create-catalogue-item.dto';
import { UpdateCatalogueItemDto } from './dto/update-catalogue-item.dto';

@Injectable()
export class CatalogueService {
  constructor(private readonly prisma: PrismaService) {}

  async list(kind?: string) {
    const items = await this.prisma.catalogueItem.findMany({
      where: kind ? { kind: apiToCatalogueKind[kind] } : {},
      orderBy: { name: 'asc' },
    });
    return items.map(serializeCatalogueItem);
  }

  async create(dto: CreateCatalogueItemDto) {
    const item = await this.prisma.catalogueItem.create({
      data: {
        name: dto.name,
        sku: dto.sku,
        kind: apiToCatalogueKind[dto.kind],
        stock: dto.kind === 'part' ? (dto.stock ?? 0) : null,
        pricePaise: toPaise(dto.price),
      },
    });
    return serializeCatalogueItem(item);
  }

  async update(id: string, dto: UpdateCatalogueItemDto) {
    const existing = await this.prisma.catalogueItem.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Catalogue item not found');
    const item = await this.prisma.catalogueItem.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.sku !== undefined ? { sku: dto.sku } : {}),
        ...(dto.stock !== undefined ? { stock: dto.stock } : {}),
        ...(dto.price !== undefined ? { pricePaise: toPaise(dto.price) } : {}),
      },
    });
    return serializeCatalogueItem(item);
  }
}
