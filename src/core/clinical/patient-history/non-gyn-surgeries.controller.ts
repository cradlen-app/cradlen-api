import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { NonGynSurgeriesService } from './non-gyn-surgeries.service';
import { NonGynSurgeryDto } from './dto/non-gyn-surgery.dto';
import { ApiStandardResponse } from '@common/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { AuthContext } from '@common/interfaces/auth-context.interface';

// Read-only. Writes go through `PATCH /patients/:id/obgyn-history`.
@ApiTags('Patient History')
@Controller()
export class NonGynSurgeriesController {
  constructor(
    private readonly nonGynSurgeriesService: NonGynSurgeriesService,
  ) {}

  @Get('patients/:id/non-gyn-surgeries')
  @ApiStandardResponse(NonGynSurgeryDto)
  findAll(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.nonGynSurgeriesService.findAll(id, user);
  }
}
