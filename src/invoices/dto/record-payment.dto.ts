import { IsIn, IsNumber, Min } from 'class-validator';

export class RecordPaymentDto {
  // Rupees.
  @IsNumber()
  @Min(1)
  amount: number;

  @IsIn(['Cash', 'UPI', 'Card', 'cash', 'upi', 'card'])
  method: string;
}
