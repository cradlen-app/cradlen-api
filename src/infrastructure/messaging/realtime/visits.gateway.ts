import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { OnEvent } from '@nestjs/event-emitter';
import { Server, Socket } from 'socket.io';

export interface VisitRealtimeEvent {
  assignedDoctorId?: string;
  branchId: string;
  payload: unknown;
}

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

  @OnEvent('visit.booked')
  onVisitBooked(event: VisitRealtimeEvent) {
    this.broadcast('visit.booked', event, true);
  }

  @OnEvent('visit.status_updated')
  onVisitStatusUpdated(event: VisitRealtimeEvent) {
    this.broadcast('visit.status_updated', event, true);
  }

  @OnEvent('visit.updated')
  onVisitUpdated(event: VisitRealtimeEvent) {
    this.broadcast('visit.updated', event, false);
  }

  @OnEvent('medical_rep_visit.booked')
  onMedRepVisitBooked(event: VisitRealtimeEvent) {
    this.broadcast('medical_rep_visit.booked', event, true);
  }

  @OnEvent('medical_rep_visit.status_updated')
  onMedRepVisitStatusUpdated(event: VisitRealtimeEvent) {
    this.broadcast('medical_rep_visit.status_updated', event, true);
  }

  @OnEvent('medical_rep_visit.updated')
  onMedRepVisitUpdated(event: VisitRealtimeEvent) {
    this.broadcast('medical_rep_visit.updated', event, false);
  }

  private broadcast(
    eventName: string,
    event: VisitRealtimeEvent,
    requireDoctor: boolean,
  ) {
    const rooms: string[] = [`branch:${event.branchId}`];
    if (event.assignedDoctorId) {
      rooms.push(`doctor:${event.assignedDoctorId}`);
    } else if (requireDoctor) {
      // Booked / status events should always carry a doctor; bail out otherwise.
      return;
    }
    this.server.to(rooms).emit(eventName, event.payload);
  }
}
