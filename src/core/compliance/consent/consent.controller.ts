import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiStandardArrayResponse, ApiStandardResponse } from '@common/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator.js';
import { AuthContext } from '@common/interfaces/auth-context.interface.js';
import { ConsentService } from './consent.service.js';
import {
  ConsentResponseDto,
  GrantConsentDto,
  WithdrawConsentDto,
} from './dto/consent.dto.js';

/**
 * Patient consent management (controller tooling). Staff record and withdraw a
 * patient's consent; org-scope is enforced in the service via
 * `assertPatientInOrg`.
 */
@ApiTags('Compliance — Patient Consent')
@Controller()
export class ConsentController {
  constructor(private readonly service: ConsentService) {}

  @Post('/patients/:patientId/consents')
  @ApiOperation({ summary: 'Record a patient consent' })
  @ApiStandardResponse(ConsentResponseDto)
  grant(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Body() dto: GrantConsentDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.grant(patientId, dto, user);
  }

  @Post('/patients/:patientId/consents/:id/withdraw')
  @ApiOperation({ summary: 'Withdraw a previously granted consent' })
  @ApiStandardResponse(ConsentResponseDto)
  withdraw(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: WithdrawConsentDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.withdraw(patientId, id, dto, user);
  }

  @Get('/patients/:patientId/consents')
  @ApiOperation({ summary: 'List a patient consents (current + history)' })
  @ApiStandardArrayResponse(ConsentResponseDto)
  list(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.list(patientId, user);
  }
}
