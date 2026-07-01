import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../common/storage/storage.service';
import { serializePerson, serializeVehicle } from '../common/serializers';
import { apiToVehicleType } from '../common/enum-maps';
import { CreateVehicleDto } from './dto/create-vehicle.dto';

@Injectable()
export class VehiclesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  // Plate search powers job/new + tech search. Bare array; includes the owner.
  async search(plate?: string) {
    const vehicles = await this.prisma.vehicle.findMany({
      where: plate ? { plate: { contains: plate, mode: 'insensitive' } } : {},
      include: { customer: true },
      orderBy: { plate: 'asc' },
      take: 50,
    });
    return vehicles.map((v) => ({
      ...serializeVehicle(v),
      customer: serializePerson(v.customer),
    }));
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
