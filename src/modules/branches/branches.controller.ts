import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { AuthContext } from '../../common/interfaces/auth-context.interface.js';
import {
  ApiStandardResponse,
  ApiVoidResponse,
} from '../../common/swagger/index.js';
import { BranchesService } from './branches.service.js';
import { CreateBranchDto, UpdateBranchDto } from './dto/branch.dto.js';

@ApiTags('Branches')
@ApiBearerAuth()
@Controller('accounts/:accountId/branches')
export class BranchesController {
  constructor(private readonly branchesService: BranchesService) {}

  @Get()
  @ApiOperation({ summary: 'List account branches' })
  @ApiStandardResponse(Object)
  listBranches(
    @CurrentUser() user: AuthContext,
    @Param('accountId', ParseUUIDPipe) accountId: string,
  ) {
    return this.branchesService.listBranches(user.profileId, accountId);
  }

  @Post()
  @ApiOperation({ summary: 'Create branch' })
  @ApiStandardResponse(Object)
  createBranch(
    @CurrentUser() user: AuthContext,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Body() dto: CreateBranchDto,
  ) {
    return this.branchesService.createBranch(user.profileId, accountId, dto);
  }

  @Get(':branchId')
  @ApiOperation({ summary: 'Get branch by ID' })
  @ApiStandardResponse(Object)
  getBranch(
    @CurrentUser() user: AuthContext,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
  ) {
    return this.branchesService.getBranch(user.profileId, accountId, branchId);
  }

  @Patch(':branchId')
  @ApiOperation({ summary: 'Update branch' })
  @ApiStandardResponse(Object)
  updateBranch(
    @CurrentUser() user: AuthContext,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Body() dto: UpdateBranchDto,
  ) {
    return this.branchesService.updateBranch(
      user.profileId,
      accountId,
      branchId,
      dto,
    );
  }

  @Delete(':branchId')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Delete branch (cascades to account if last branch)',
  })
  @ApiVoidResponse()
  deleteBranch(
    @CurrentUser() user: AuthContext,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
  ) {
    return this.branchesService.deleteBranch(
      user.profileId,
      accountId,
      branchId,
    );
  }
}
