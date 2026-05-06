import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({ cors: { origin: '*' }, namespace: '/visits' })
export class VisitsGateway {
  @WebSocketServer() server!: Server;

  @SubscribeMessage('join')
  handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { doctorId: string },
  ) {
    void client.join(`doctor:${data.doctorId}`);
  }

  emitVisitBooked(assignedDoctorId: string, payload: unknown) {
    this.server.to(`doctor:${assignedDoctorId}`).emit('visit.booked', payload);
  }

  emitVisitStatusUpdated(assignedDoctorId: string, payload: unknown) {
    this.server
      .to(`doctor:${assignedDoctorId}`)
      .emit('visit.status_updated', payload);
  }
}
