import { IsIn } from 'class-validator';

export class DecisionDto {
  @IsIn(['approve', 'decline'])
  decision: 'approve' | 'decline';
}
