import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { GuardiansService } from './guardians.service';
import { ListGuardiansQueryDto } from './dto/list-guardians-query.dto';
import { GuardianSearchResultDto } from './dto/guardian.dto';
import { ApiPaginatedResponse } from '@common/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { AuthContext } from '@common/interfaces/auth-context.interface';

@ApiTags('Guardians')
@Controller('guardians')
export class GuardiansController {
  constructor(private readonly guardiansService: GuardiansService) {}

  @Get()
  @ApiPaginatedResponse(GuardianSearchResultDto)
  search(
    @Query() query: ListGuardiansQueryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.guardiansService.search(query, user);
  }
}
