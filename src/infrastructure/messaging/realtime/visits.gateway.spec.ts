import { JwtService } from '@nestjs/jwt';
import type { Socket, Server } from 'socket.io';
import { VisitsGateway, type VisitRealtimeEvent } from './visits.gateway.js';

const ACCESS_SECRET = 'test-access-secret';

function makeClient(overrides: {
  token?: string;
  authHeader?: string;
}): Socket & { join: jest.Mock; disconnect: jest.Mock } {
  return {
    handshake: {
      auth: overrides.token ? { token: overrides.token } : {},
      headers: overrides.authHeader
        ? { authorization: overrides.authHeader }
        : {},
    },
    data: {},
    join: jest.fn(),
    disconnect: jest.fn(),
  } as unknown as Socket & { join: jest.Mock; disconnect: jest.Mock };
}

function makeGateway(verifyImpl: jest.Mock): VisitsGateway {
  const jwtService = { verify: verifyImpl } as unknown as JwtService;
  return new VisitsGateway(jwtService, {
    jwt: { accessSecret: ACCESS_SECRET },
  } as never);
}

describe('VisitsGateway handshake auth', () => {
  it('disconnects a socket with no token', () => {
    const verify = jest.fn();
    const gateway = makeGateway(verify);
    const client = makeClient({});

    gateway.handleConnection(client);

    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(verify).not.toHaveBeenCalled();
    expect(client.join).not.toHaveBeenCalled();
  });

  it('disconnects a socket with an invalid token', () => {
    const verify = jest.fn().mockImplementation(() => {
      throw new Error('bad signature');
    });
    const gateway = makeGateway(verify);
    const client = makeClient({ token: 'garbage' });

    gateway.handleConnection(client);

    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(client.join).not.toHaveBeenCalled();
  });

  it('disconnects a token whose type is not access', () => {
    const verify = jest.fn().mockReturnValue({
      type: 'refresh',
      profileId: 'p1',
      organizationId: 'o1',
    });
    const gateway = makeGateway(verify);
    const client = makeClient({ token: 'refresh-token' });

    gateway.handleConnection(client);

    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it('joins only token-derived rooms, ignoring any spoofed ids', () => {
    const verify = jest.fn().mockReturnValue({
      type: 'access',
      profileId: 'doctor-me',
      organizationId: 'o1',
      activeBranchId: 'branch-mine',
    });
    const gateway = makeGateway(verify);
    const client = makeClient({ token: 'good' });

    gateway.handleConnection(client);

    expect(client.disconnect).not.toHaveBeenCalled();
    expect(client.join).toHaveBeenCalledWith('doctor:doctor-me');
    expect(client.join).toHaveBeenCalledWith('branch:branch-mine');
    // Never joined a room from attacker-controlled input.
    expect(client.join).not.toHaveBeenCalledWith('doctor:victim');
    expect(client.join).toHaveBeenCalledTimes(2);
  });

  it('reads the token from the Authorization header as a fallback', () => {
    const verify = jest.fn().mockReturnValue({
      type: 'access',
      profileId: 'p1',
      organizationId: 'o1',
    });
    const gateway = makeGateway(verify);
    const client = makeClient({ authHeader: 'Bearer header-token' });

    gateway.handleConnection(client);

    expect(verify).toHaveBeenCalledWith('header-token', {
      secret: ACCESS_SECRET,
    });
    expect(client.join).toHaveBeenCalledWith('doctor:p1');
  });
});

describe('VisitsGateway broadcast', () => {
  function withServer(gateway: VisitsGateway) {
    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });
    (gateway as unknown as { server: Server }).server = {
      to,
    } as unknown as Server;
    return { to, emit };
  }

  it('emits to both branch and doctor rooms when a doctor is present', () => {
    const gateway = makeGateway(jest.fn());
    const { to, emit } = withServer(gateway);
    const event: VisitRealtimeEvent = {
      assignedDoctorId: 'd1',
      branchId: 'b1',
      payload: { id: 'v1' },
    };

    gateway.onVisitBooked(event);

    expect(to).toHaveBeenCalledWith(['branch:b1', 'doctor:d1']);
    expect(emit).toHaveBeenCalledWith('visit.booked', { id: 'v1' });
  });

  it('does not emit a doctor-required event when no doctor is assigned', () => {
    const gateway = makeGateway(jest.fn());
    const { to, emit } = withServer(gateway);

    gateway.onVisitBooked({ branchId: 'b1', payload: {} });

    expect(to).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it('emits a branch-only event when no doctor is required', () => {
    const gateway = makeGateway(jest.fn());
    const { to, emit } = withServer(gateway);

    gateway.onVisitUpdated({ branchId: 'b1', payload: { x: 1 } });

    expect(to).toHaveBeenCalledWith(['branch:b1']);
    expect(emit).toHaveBeenCalledWith('visit.updated', { x: 1 });
  });
});
