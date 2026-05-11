import { PartialType } from '@nestjs/swagger';
import { CreateMedicalRepDto } from './create-medical-rep.dto';

export class UpdateMedicalRepDto extends PartialType(CreateMedicalRepDto) {}
