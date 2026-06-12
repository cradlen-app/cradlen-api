import { ApiProperty } from '@nestjs/swagger';

export class WsTicketResponseDto {
  @ApiProperty({
    description:
      'Short-lived JWT to pass in the Socket.IO handshake (handshake.auth.token).',
  })
  ws_ticket!: string;

  @ApiProperty({ description: 'Ticket lifetime in seconds.', example: 60 })
  expires_in!: number;
}
