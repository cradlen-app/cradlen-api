import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { NotesService } from './notes.service';
import {
  CreateNoteDto,
  ListNotesQueryDto,
  NoteDto,
  NotesListDto,
  UpdateNoteDto,
} from './dto/note.dto';
import { ApiStandardResponse, ApiVoidResponse } from '@common/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { AuthContext } from '@common/interfaces/auth-context.interface';

@ApiTags('Patient History')
@Controller()
export class NotesController {
  constructor(private readonly notesService: NotesService) {}

  @Get('patients/:id/history/notes')
  @ApiStandardResponse(NotesListDto)
  list(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListNotesQueryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.notesService.list(id, query.section, user);
  }

  @Post('patients/:id/history/notes')
  @ApiStandardResponse(NoteDto)
  create(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateNoteDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.notesService.create(id, dto, user);
  }

  @Patch('patient-history-notes/:id')
  @ApiStandardResponse(NoteDto)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateNoteDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.notesService.update(id, dto, user);
  }

  @Delete('patient-history-notes/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiVoidResponse()
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.notesService.remove(id, user);
  }
}
