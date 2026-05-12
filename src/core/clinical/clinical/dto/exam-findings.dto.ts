import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

const SHORT = 256;
const LONG = 2000;

class FindingsBase {
  @IsString() @IsOptional() @MaxLength(LONG) notes?: string;
}

export class GeneralFindingsDto extends FindingsBase {
  @IsString() @IsOptional() @MaxLength(SHORT) appearance?: string;
  @IsString() @IsOptional() @MaxLength(SHORT) consciousness?: string;
  @IsString() @IsOptional() @MaxLength(SHORT) hydration?: string;
  @IsString() @IsOptional() @MaxLength(SHORT) pallor?: string;
  @IsString() @IsOptional() @MaxLength(SHORT) jaundice?: string;
  @IsString() @IsOptional() @MaxLength(SHORT) cyanosis?: string;
  @IsString() @IsOptional() @MaxLength(SHORT) edema?: string;
}

export class CardiovascularFindingsDto extends FindingsBase {
  @IsString() @IsOptional() @MaxLength(SHORT) heart_sounds?: string;
  @IsString() @IsOptional() @MaxLength(SHORT) murmur?: string;
  @IsString() @IsOptional() @MaxLength(SHORT) jvp?: string;
  @IsString() @IsOptional() @MaxLength(SHORT) peripheral_pulses?: string;
}

export class RespiratoryFindingsDto extends FindingsBase {
  @IsString() @IsOptional() @MaxLength(SHORT) inspection?: string;
  @IsString() @IsOptional() @MaxLength(SHORT) auscultation?: string;
  @IsString() @IsOptional() @MaxLength(SHORT) percussion?: string;
}

export class MenstrualFindingsDto extends FindingsBase {
  @IsDateString() @IsOptional() lmp?: string;
  @IsString() @IsOptional() @MaxLength(SHORT) cycle_since_last_visit?: string;
  @IsString() @IsOptional() @MaxLength(SHORT) pelvic_pain?: string;
  @IsString() @IsOptional() @MaxLength(SHORT) type?: string;
  @IsString() @IsOptional() @MaxLength(SHORT) vaginal_discharge?: string;
  @IsString() @IsOptional() @MaxLength(SHORT) color?: string;
  @IsString() @IsOptional() @MaxLength(SHORT) odor?: string;
  @IsString() @IsOptional() @MaxLength(SHORT) amount?: string;
  @IsString() @IsOptional() @MaxLength(SHORT) intermenstrual_bleeding?: string;
  @IsString() @IsOptional() @MaxLength(SHORT) post_coital_bleeding?: string;
}

export class AbdominalFindingsDto extends FindingsBase {
  @IsString() @IsOptional() @MaxLength(SHORT) inspection?: string;
  @IsString() @IsOptional() @MaxLength(SHORT) guarding?: string;
  @IsString() @IsOptional() @MaxLength(SHORT) tenderness?: string;
  @IsString() @IsOptional() @MaxLength(SHORT) tenderness_site?: string;
  @IsString() @IsOptional() @MaxLength(SHORT) mass?: string;
  @IsString() @IsOptional() @MaxLength(SHORT) mass_site?: string;
  @IsString() @IsOptional() @MaxLength(SHORT) mass_size?: string;
  @IsString() @IsOptional() @MaxLength(SHORT) mass_tenderness?: string;
}

class SpeculumExamDto {
  @IsString() @IsOptional() @MaxLength(SHORT) cervix?: string;
  @IsString() @IsOptional() @MaxLength(SHORT) vagina?: string;
  @IsString() @IsOptional() @MaxLength(SHORT) os?: string;
  @IsString() @IsOptional() @MaxLength(LONG) notes?: string;
}

class BimanualExamDto {
  @IsString() @IsOptional() @MaxLength(SHORT) uterus_size?: string;
  @IsString() @IsOptional() @MaxLength(SHORT) uterus_position?: string;
  @IsString() @IsOptional() @MaxLength(SHORT) uterus_mobility?: string;
  @IsString() @IsOptional() @MaxLength(SHORT) uterus_tenderness?: string;
  @IsString() @IsOptional() @MaxLength(SHORT) uterus_surface?: string;
  @IsString() @IsOptional() @MaxLength(SHORT) adnexa_right?: string;
  @IsString() @IsOptional() @MaxLength(SHORT) adnexa_left?: string;
  @IsString()
  @IsOptional()
  @MaxLength(SHORT)
  cervical_motion_tenderness?: string;
  @IsString() @IsOptional() @MaxLength(LONG) notes?: string;
}

export class PelvicFindingsDto extends FindingsBase {
  @IsOptional()
  @ValidateNested()
  @Type(() => SpeculumExamDto)
  speculum?: SpeculumExamDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => BimanualExamDto)
  bimanual?: BimanualExamDto;
}

export class BreastFindingsDto extends FindingsBase {
  @IsString() @IsOptional() @MaxLength(SHORT) skin?: string;
  @IsString() @IsOptional() @MaxLength(SHORT) nipple?: string;
  @IsString() @IsOptional() @MaxLength(SHORT) color?: string;
  @IsString() @IsOptional() @MaxLength(SHORT) site?: string;
  @IsString() @IsOptional() @MaxLength(SHORT) palpation_right?: string;
  @IsString() @IsOptional() @MaxLength(SHORT) palpation_left?: string;
}

export class ExtremitiesFindingsDto extends FindingsBase {
  @IsString() @IsOptional() @MaxLength(SHORT) inspection?: string;
  @IsString() @IsOptional() @MaxLength(SHORT) range_of_motion?: string;
  @IsBoolean() @IsOptional() varicose_veins?: boolean;
  @IsBoolean() @IsOptional() calf_tenderness?: boolean;
}

export class NeurologicalFindingsDto extends FindingsBase {
  @IsString() @IsOptional() @MaxLength(SHORT) consciousness?: string;
  @IsString() @IsOptional() @MaxLength(SHORT) reflexes?: string;
  @IsString() @IsOptional() @MaxLength(SHORT) cranial_nerves?: string;
  @IsString() @IsOptional() @MaxLength(SHORT) motor?: string;
  @IsString() @IsOptional() @MaxLength(SHORT) sensory?: string;
}

export class SkinFindingsDto extends FindingsBase {
  @IsString() @IsOptional() @MaxLength(SHORT) color?: string;
  @IsString() @IsOptional() @MaxLength(SHORT) lesions?: string;
  @IsString() @IsOptional() @MaxLength(SHORT) striae?: string;
}
