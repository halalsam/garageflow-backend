import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class InvoiceLineDto {
  @IsString()
  @MinLength(1)
  label: string;

  @IsString()
  note: string;

  // Rupees.
  @IsNumber()
  @Min(0)
  amount: number;
}

// Replace an invoice's line items (manager/admin) — used to adjust prices before
// the invoice is shared with the customer.
export class UpdateInvoiceLinesDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'An invoice needs at least one line item' })
  @ValidateNested({ each: true })
  @Type(() => InvoiceLineDto)
  lines: InvoiceLineDto[];
}
