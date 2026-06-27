import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { serializePerson, serializeVehicle } from '../common/serializers';
import { apiToVehicleType } from '../common/enum-maps';
import { CreateVehicleDto } from './dto/create-vehicle.dto';

@Injectable()
export class VehiclesService {
  constructor(private readonly prisma: PrismaService) {}

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
}
