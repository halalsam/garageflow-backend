import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
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

  // A raw workshop row by id — used internally by callers (estimates' GST
  // rate/invoice prefix) that need one workshop's settings, not a list.
  async getById(id: string) {
    const workshop = await this.prisma.workshop.findUnique({ where: { id } });
    if (!workshop) throw new NotFoundException('Workshop not found');
    return workshop;
  }

  // The workshop the caller's current session is scoped to (from their JWT).
  async getActive(workshopId: string) {
    return serializeWorkshop(await this.getById(workshopId), true);
  }

  // Workshops this admin can switch into: their home + any WorkshopAccess
  // grants. `currentWorkshopId` (their session's) is flagged as the active row.
  async list(userId: string, currentWorkshopId: string) {
    const rows = await this.prisma.workshop.findMany({
      where: { OR: [{ users: { some: { id: userId } } }, { access: { some: { userId } } }] },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((w) => serializeWorkshop(w, w.id === currentWorkshopId));
  }

  // Creates a workshop and immediately grants the creating admin access to it
  // (they can't switch into it otherwise).
  async create(dto: CreateWorkshopDto, creatorUserId: string) {
    const workshop = await this.prisma.$transaction(async (tx) => {
      const created = await tx.workshop.create({
        data: {
          name: dto.name,
          gstin: dto.gstin,
          address: dto.address,
          phone: dto.phone,
          ...(dto.gstRate !== undefined ? { gstRate: dto.gstRate } : {}),
          ...(dto.invoicePrefix ? { invoicePrefix: dto.invoicePrefix } : {}),
          ...(dto.invoiceFooter !== undefined ? { invoiceFooter: dto.invoiceFooter } : {}),
        },
      });
      await tx.workshopAccess.create({
        data: { userId: creatorUserId, workshopId: created.id },
      });
      return created;
    });
    return serializeWorkshop(workshop);
  }

  async update(id: string, dto: UpdateWorkshopDto, requestingUserId: string) {
    await this.ensureAccess(id, requestingUserId);
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

  // Save (or replace) the workshop's logo (multipart `image`). Shown in app
  // headers and printed on the invoice PDF.
  async saveLogo(
    id: string,
    requestingUserId: string,
    file?: { originalname: string; buffer: Buffer },
  ) {
    await this.ensureAccess(id, requestingUserId);
    if (!file) throw new BadRequestException('Logo image required');
    const url = await this.storage.save(file, `workshops/${id}`);
    const workshop = await this.prisma.workshop.update({ where: { id }, data: { logoUrl: url } });
    return serializeWorkshop(workshop);
  }

  // An admin may only manage workshops they belong to or hold an access grant
  // for — being ADMIN elsewhere doesn't give blanket rights over every tenant.
  private async ensureAccess(workshopId: string, userId: string) {
    const workshop = await this.prisma.workshop.findUnique({ where: { id: workshopId } });
    if (!workshop) throw new NotFoundException('Workshop not found');
    const hasAccess =
      workshop.id === (await this.prisma.user.findUnique({ where: { id: userId } }))?.workshopId ||
      (await this.prisma.workshopAccess.findUnique({
        where: { userId_workshopId: { userId, workshopId } },
      })) !== null;
    if (!hasAccess) throw new ForbiddenException('You do not have access to this workshop');
  }
}
