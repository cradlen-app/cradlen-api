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
    @MessageBody() data: { doctorId?: string; branchId?: string },
  ) {
    if (data.doctorId) void client.join(`doctor:${data.doctorId}`);
    if (data.branchId) void client.join(`branch:${data.branchId}`);
  }

  emitVisitBooked(
    args: { assignedDoctorId: string; branchId: string },
    payload: unknown,
  ) {
    this.server
      .to([`doctor:${args.assignedDoctorId}`, `branch:${args.branchId}`])
      .emit('visit.booked', payload);
  }

  emitVisitStatusUpdated(
    args: { assignedDoctorId: string; branchId: string },
    payload: unknown,
  ) {
    this.server
      .to([`doctor:${args.assignedDoctorId}`, `branch:${args.branchId}`])
      .emit('visit.status_updated', payload);
  }

  emitVisitUpdated(
    args: { assignedDoctorId?: string; branchId: string },
    payload: unknown,
  ) {
    const rooms = [`branch:${args.branchId}`];
    if (args.assignedDoctorId) rooms.push(`doctor:${args.assignedDoctorId}`);
    this.server.to(rooms).emit('visit.updated', payload);
  }
}
