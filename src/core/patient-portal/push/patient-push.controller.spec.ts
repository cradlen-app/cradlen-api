import type { PatientAuthContext } from '@common/interfaces/patient-auth-context.interface.js';
import { PatientPushController } from './patient-push.controller.js';
import type { PatientPushService } from './patient-push.service.js';

const ctx: PatientAuthContext = {
  accountId: 'acc-1',
  accessiblePatientIds: ['patient-1'],
};

function makeService() {
  const subscribe = jest.fn().mockResolvedValue(undefined);
  const unsubscribe = jest.fn().mockResolvedValue(undefined);
  const service = { subscribe, unsubscribe } as unknown as PatientPushService;
  return { service, subscribe, unsubscribe };
}

describe('PatientPushController', () => {
  it('subscribe passes the accountId, dto, and user-agent to the service', async () => {
    const { service, subscribe } = makeService();
    const controller = new PatientPushController(service);
    const dto = { endpoint: 'e-1', keys: { p256dh: 'a', auth: 'b' } };

    const result = await controller.subscribe(ctx, dto, 'UA/1.0');

    expect(subscribe).toHaveBeenCalledWith('acc-1', dto, 'UA/1.0');
    expect(result).toEqual({ success: true });
  });

  it('unsubscribe passes the accountId and endpoint to the service', async () => {
    const { service, unsubscribe } = makeService();
    const controller = new PatientPushController(service);

    const result = await controller.unsubscribe(ctx, { endpoint: 'e-1' });

    expect(unsubscribe).toHaveBeenCalledWith('acc-1', 'e-1');
    expect(result).toEqual({ success: true });
  });
});
