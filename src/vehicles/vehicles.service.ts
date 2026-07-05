import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../common/storage/storage.service';
import { serializePerson, serializeVehicle } from '../common/serializers';
import { apiToVehicleType, jobStatusToApi } from '../common/enum-maps';
import { CreateVehicleDto } from './dto/create-vehicle.dto';

@Injectable()
export class VehiclesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  // Vehicle search. `plate` keeps the original narrow plate lookup (job/new);
  // `q` is the global search — it matches the plate, the customer's name, or
  // the make/model, across every vehicle regardless of job status. Each hit
  // carries its owner and its most recent job so results can deep-link.
  async search(plate?: string, q?: string) {
    const term = (q ?? '').trim();
    const where: Prisma.VehicleWhereInput = term
      ? {
          OR: [
            { plate: { contains: term, mode: 'insensitive' } },
            { make: { contains: term, mode: 'insensitive' } },
            { model: { contains: term, mode: 'insensitive' } },
            { customer: { name: { contains: term, mode: 'insensitive' } } },
          ],
        }
      : plate
        ? { plate: { contains: plate, mode: 'insensitive' } }
        : {};
    const vehicles = await this.prisma.vehicle.findMany({
      where,
      include: {
        customer: true,
        jobs: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { plate: 'asc' },
      take: 50,
    });
    return vehicles.map((v) => {
      const job = v.jobs[0];
      return {
        ...serializeVehicle(v),
        customer: serializePerson(v.customer),
        job: job ? { id: job.code, ...jobStatusToApi[job.status] } : undefined,
      };
    });
  }

  async findOne(id: string) {
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id },
      include: { customer: true },
    });
    if (!vehicle) throw new NotFoundException('Vehicle not found');
    return { ...serializeVehicle(vehicle), customer: serializePerson(vehicle.customer) };
  }

  async create(dto: CreateVehicleDto) {
    const customer = await this.prisma.customer.findUnique({ where: { id: dto.customerId } });
    if (!customer) throw new NotFoundException('Customer not found');
    const vehicle = await this.prisma.vehicle.create({
      data: {
        customerId: dto.customerId,
        plate: dto.plate,
        make: dto.make,
        model: dto.model,
        year: dto.year,
        type: apiToVehicleType(dto.type),
      },
      include: { customer: true },
    });
    return { ...serializeVehicle(vehicle), customer: serializePerson(vehicle.customer) };
  }

  // Save (or replace) the vehicle's photo. Used by the new-job flow after the
  // vehicle exists (presign needs a jobId, so it can't run before create).
  async savePhoto(id: string, file?: { originalname: string; buffer: Buffer }) {
    const vehicle = await this.prisma.vehicle.findUnique({ where: { id } });
    if (!vehicle) throw new NotFoundException('Vehicle not found');
    if (!file) throw new BadRequestException('Photo required');
    const url = await this.storage.save(file, `vehicles/${id}`);
    const updated = await this.prisma.vehicle.update({
      where: { id },
      data: { photoUrl: url },
      include: { customer: true },
    });
    return { ...serializeVehicle(updated), customer: serializePerson(updated.customer) };
  }
}
