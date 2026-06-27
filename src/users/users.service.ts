import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { serializeTeamMember } from '../common/serializers';
import { apiToRole } from '../common/enum-maps';
import { initialsOf } from '../common/format';
import { CreateTeamMemberDto } from './dto/create-team-member.dto';
import { UpdateTeamMemberDto } from './dto/update-team-member.dto';

const AVATAR_KEYS = ['a', 'b', 'c', 'd', 'e', 'f'];
const DEFAULT_INVITE_PASSWORD = 'garageflow123';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const users = await this.prisma.user.findMany({
      orderBy: [{ role: 'desc' }, { name: 'asc' }],
    });
    return users.map(serializeTeamMember);
  }

  async create(dto: CreateTeamMemberDto) {
    const email = dto.email.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException({
        message: 'A user with this email already exists',
        errors: { email: ['Already in use'] },
      });
    }
    const count = await this.prisma.user.count();
    const passwordHash = await bcrypt.hash(dto.password ?? DEFAULT_INVITE_PASSWORD, 10);
    const user = await this.prisma.user.create({
      data: {
        name: dto.name,
        email,
        phone: dto.phone,
        role: apiToRole[dto.role],
        passwordHash,
        initials: initialsOf(dto.name),
        color: AVATAR_KEYS[count % AVATAR_KEYS.length],
        active: true,
      },
    });
    return serializeTeamMember(user);
  }

  async update(id: string, dto: UpdateTeamMemberDto) {
    await this.ensureExists(id);
    const user = await this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.role ? { role: apiToRole[dto.role] as UserRole } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
      },
    });
    return serializeTeamMember(user);
  }

  private async ensureExists(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Team member not found');
    return user;
  }
}
