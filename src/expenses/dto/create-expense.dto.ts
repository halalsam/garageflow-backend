import { IsIn, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class CreateExpenseDto {
  @IsString()
  @MinLength(1)
  title: string;

  @IsIn(['Parts', 'Salaries', 'Rent', 'Utilities', 'Misc'])
  category: string;

  // Rupees.
  @IsNumber()
  @Min(0)
  amount: number;

  // ISO date "2026-06-20"; defaults to today.
  @IsOptional()
  @IsString()
  spentAt?: string;
}
