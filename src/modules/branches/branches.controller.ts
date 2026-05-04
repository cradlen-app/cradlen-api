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
@Controller('organizations/:organizationId/branches')
export class BranchesController {
  constructor(private readonly branchesService: BranchesService) {}

  @Get()
  @ApiOperation({ summary: 'List organization branches' })
  @ApiStandardResponse(Object)
  listBranches(
    @CurrentUser() user: AuthContext,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
  ) {
    return this.branchesService.listBranches(user.profileId, organizationId);
  }

  @Post()
  @ApiOperation({ summary: 'Create branch' })
  @ApiStandardResponse(Object)
  createBranch(
    @CurrentUser() user: AuthContext,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() dto: CreateBranchDto,
  ) {
    return this.branchesService.createBranch(
      user.profileId,
      organizationId,
      dto,
    );
  }

  @Get(':branchId')
  @ApiOperation({ summary: 'Get branch by ID' })
  @ApiStandardResponse(Object)
  getBranch(
    @CurrentUser() user: AuthContext,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
  ) {
    return this.branchesService.getBranch(
      user.profileId,
      organizationId,
      branchId,
    );
  }

  @Patch(':branchId')
  @ApiOperation({ summary: 'Update branch' })
  @ApiStandardResponse(Object)
  updateBranch(
    @CurrentUser() user: AuthContext,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Body() dto: UpdateBranchDto,
  ) {
    return this.branchesService.updateBranch(
      user.profileId,
      organizationId,
      branchId,
      dto,
    );
  }

  @Delete(':branchId')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Delete branch (cascades to organization if last branch)',
  })
  @ApiVoidResponse()
  deleteBranch(
    @CurrentUser() user: AuthContext,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
  ) {
    return this.branchesService.deleteBranch(
      user.profileId,
      organizationId,
      branchId,
    );
  }
}
