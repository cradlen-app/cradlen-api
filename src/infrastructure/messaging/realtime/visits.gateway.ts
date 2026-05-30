import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  ConnectedSocket,
  OnGatewayConnection,
} from '@nestjs/websockets';
import { Inject } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { ConfigType } from '@nestjs/config';
import { Server, Socket } from 'socket.io';
import authConfig from '@config/auth.config.js';
import { parseList } from '@config/env.utils.js';

export interface VisitRealtimeEvent {
  assignedDoctorId?: string;
  branchId: string;
  payload: unknown;
}

/**
 * Minimal shape we trust from a verified access token. Redeclared locally
 * (not imported from core) so the gateway honours the
 * `infrastructure → common only` layer boundary.
 */
interface SocketTokenClaims {
  profileId: string;
  organizationId: string;
  activeBranchId?: string;
  type: string;
}

interface SocketData {
  profileId: string;
  organizationId: string;
  activeBranchId?: string;
}

function parseCorsOrigins(): string[] {
  return parseList(process.env.CORS_ORIGINS, []);
}

@WebSocketGateway({
  cors: { origin: parseCorsOrigins(), credentials: true },
  namespace: '/visits',
})
export class VisitsGateway implements OnGatewayConnection {
  @WebSocketServer() server!: Server;

  private readonly accessSecret: string;

  constructor(
    private readonly jwtService: JwtService,
    @Inject(authConfig.KEY)
    config: ConfigType<typeof authConfig>,
  ) {
    this.accessSecret = config.jwt.accessSecret;
  }

  /**
   * Authenticate the handshake. A connection with no/invalid access token is
   * dropped immediately — clinical payloads must never reach an anonymous
   * socket. Verified identity is stashed on `client.data` and used to decide
   * room membership; the client never gets to pick its own rooms.
   */
  handleConnection(client: Socket): void {
    try {
      const token = this.extractToken(client);
      if (!token) throw new Error('missing token');

      const claims = this.jwtService.verify<SocketTokenClaims>(token, {
        secret: this.accessSecret,
      });
      if (claims.type !== 'access') throw new Error('invalid token type');

      const data = client.data as SocketData;
      data.profileId = claims.profileId;
      data.organizationId = claims.organizationId;
      data.activeBranchId = claims.activeBranchId;

      this.joinAuthorizedRooms(client);
    } catch {
      client.disconnect(true);
    }
  }

  /**
   * Kept for protocol compatibility, but rooms are derived from the verified
   * token — any IDs in the message body are ignored.
   */
  @SubscribeMessage('join')
  handleJoin(@ConnectedSocket() client: Socket): void {
    this.joinAuthorizedRooms(client);
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

  private joinAuthorizedRooms(client: Socket): void {
    const data = client.data as SocketData;
    void client.join(`doctor:${data.profileId}`);
    if (data.activeBranchId) {
      void client.join(`branch:${data.activeBranchId}`);
    }
  }

  private extractToken(client: Socket): string | undefined {
    const fromAuth = (client.handshake.auth as { token?: unknown } | undefined)
      ?.token;
    if (typeof fromAuth === 'string' && fromAuth.length > 0) return fromAuth;

    const header = client.handshake.headers.authorization;
    if (typeof header === 'string' && header.startsWith('Bearer ')) {
      return header.slice('Bearer '.length);
    }
    return undefined;
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
