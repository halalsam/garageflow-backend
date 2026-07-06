import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CustomersService } from './customers.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

@ApiTags('customers')
@ApiBearerAuth('access-token')
@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  search(
    @CurrentUser('workshopId') workshopId: string,
    @Query('query') query?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page?: number,
    @Query('pageSize', new DefaultValuePipe(20), ParseIntPipe) pageSize?: number,
  ) {
    return this.customers.search(workshopId, query, page, pageSize);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser('workshopId') workshopId: string) {
    return this.customers.findOne(id, workshopId);
  }

  @Post()
  create(@Body() dto: CreateCustomerDto, @CurrentUser('workshopId') workshopId: string) {
    return this.customers.create(dto, workshopId);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCustomerDto,
    @CurrentUser('workshopId') workshopId: string,
  ) {
    return this.customers.update(id, dto, workshopId);
  }
}
