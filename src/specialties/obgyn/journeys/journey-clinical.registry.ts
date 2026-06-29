import { Injectable, NotFoundException } from '@nestjs/common';
import { JourneyClinicalHandler } from './journey-clinical.handler';

/**
 * Care-path-code → surface-handler registry. Surface services self-register on
 * module init (`register('OBGYN_PREGNANCY', this)` etc.); the dispatcher
 * controller resolves the active journey's care path and looks up the handler.
 * Adding a new journey surface is one `register(...)` call — no controller and
 * no FE change (the path stays generic).
 */
@Injectable()
export class JourneyClinicalRegistry {
  private readonly handlers = new Map<string, JourneyClinicalHandler>();

  register(carePathCode: string, handler: JourneyClinicalHandler): void {
    this.handlers.set(carePathCode, handler);
  }

  resolve(carePathCode: string | null | undefined): JourneyClinicalHandler {
    const handler = carePathCode ? this.handlers.get(carePathCode) : undefined;
    if (!handler) {
      throw new NotFoundException(
        `No journey clinical surface for care path "${carePathCode ?? ''}"`,
      );
    }
    return handler;
  }
}
