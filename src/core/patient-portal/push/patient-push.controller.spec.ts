import type { PatientAuthContext } from '@common/interfaces/patient-auth-context.interface.js';
import { PatientPushController } from './patient-push.controller.js';
import type { PatientPushService } from './patient-push.service.js';

const ctx: PatientAuthContext = {
  accountId: 'acc-1',
  accessiblePatientIds: ['patient-1'],
};

function makeService() {
  return {
    subscribe: jest.fn().mockResolvedValue(undefined),
    unsubscribe: jest.fn().mockResolvedValue(undefined),
  } as unknown as PatientPushService;
}

describe('PatientPushController', () => {
  it('subscribe passes the accountId, dto, and user-agent to the service', async () => {
    const service = makeService();
    const controller = new PatientPushController(service);
    const dto = { endpoint: 'e-1', keys: { p256dh: 'a', auth: 'b' } };

    const result = await controller.subscribe(ctx, dto, 'UA/1.0');

    expect(service.subscribe).toHaveBeenCalledWith('acc-1', dto, 'UA/1.0');
    expect(result).toEqual({ success: true });
  });

  it('unsubscribe passes the accountId and endpoint to the service', async () => {
    const service = makeService();
    const controller = new PatientPushController(service);

    const result = await controller.unsubscribe(ctx, { endpoint: 'e-1' });

    expect(service.unsubscribe).toHaveBeenCalledWith('acc-1', 'e-1');
    expect(result).toEqual({ success: true });
  });
});
