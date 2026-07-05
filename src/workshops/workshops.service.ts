import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../common/storage/storage.service';
import { serializeWorkshop } from '../common/serializers';
import { CreateWorkshopDto } from './dto/create-workshop.dto';
import { UpdateWorkshopDto } from './dto/update-workshop.dto';

@Injectable()
export class WorkshopsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  // The workshop the app operates as. Falls back to the first row for
  // databases seeded before the `active` flag existed.
  async activeRow() {
    const active = await this.prisma.workshop.findFirst({ where: { active: true } });
    if (active) return active;
    const first = await this.prisma.workshop.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!first) throw new NotFoundException('No workshop configured');
    return first;
  }

  async getActive() {
    return serializeWorkshop(await this.activeRow());
  }

  async list() {
    const rows = await this.prisma.workshop.findMany({ orderBy: { createdAt: 'asc' } });
    // Mark the effective active row even when none is flagged yet.
    const activeId = rows.find((w) => w.active)?.id ?? rows[0]?.id;
    return rows.map((w) => serializeWorkshop(w, w.id === activeId));
  }

  async create(dto: CreateWorkshopDto) {
    const count = await this.prisma.workshop.count();
    const makeActive = dto.active || count === 0;
    const workshop = await this.prisma.$transaction(async (tx) => {
      if (makeActive) {
        await tx.workshop.updateMany({ data: { active: false } });
      }
      return tx.workshop.create({
        data: {
          name: dto.name,
          gstin: dto.gstin,
          address: dto.address,
          phone: dto.phone,
          active: makeActive,
          ...(dto.gstRate !== undefined ? { gstRate: dto.gstRate } : {}),
          ...(dto.invoicePrefix ? { invoicePrefix: dto.invoicePrefix } : {}),
          ...(dto.invoiceFooter !== undefined ? { invoiceFooter: dto.invoiceFooter } : {}),
        },
      });
    });
    return serializeWorkshop(workshop);
  }

  async update(id: string, dto: UpdateWorkshopDto) {
    await this.ensureExists(id);
    const data: Prisma.WorkshopUpdateInput = {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.gstin !== undefined ? { gstin: dto.gstin || null } : {}),
      ...(dto.address !== undefined ? { address: dto.address || null } : {}),
      ...(dto.phone !== undefined ? { phone: dto.phone || null } : {}),
      ...(dto.gstRate !== undefined ? { gstRate: dto.gstRate } : {}),
      ...(dto.invoicePrefix !== undefined ? { invoicePrefix: dto.invoicePrefix } : {}),
      ...(dto.invoiceFooter !== undefined ? { invoiceFooter: dto.invoiceFooter || null } : {}),
    };
    const workshop = await this.prisma.workshop.update({ where: { id }, data });
    return serializeWorkshop(workshop);
  }

  // Switch the app to another workshop: exactly one active row.
  async activate(id: string) {
    await this.ensureExists(id);
    const workshop = await this.prisma.$transaction(async (tx) => {
      await tx.workshop.updateMany({ data: { active: false } });
      return tx.workshop.update({ where: { id }, data: { active: true } });
    });
    return serializeWorkshop(workshop);
  }

  // Save (or replace) the workshop's logo (multipart `image`). Shown in app
  // headers and printed on the invoice PDF.
  async saveLogo(id: string, file?: { originalname: string; buffer: Buffer }) {
    await this.ensureExists(id);
    if (!file) throw new BadRequestException('Logo image required');
    const url = await this.storage.save(file, `workshops/${id}`);
    const workshop = await this.prisma.workshop.update({ where: { id }, data: { logoUrl: url } });
    return serializeWorkshop(workshop);
  }

  private async ensureExists(id: string) {
    const workshop = await this.prisma.workshop.findUnique({ where: { id } });
    if (!workshop) throw new NotFoundException('Workshop not found');
    return workshop;
  }
}
