import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  TemplateValidator,
  ValidatePayloadOptions,
} from '@builder/validator/template.validator.js';

/**
 * Server-side validation of a `book_visit` payload, shared by the patient and
 * medical-rep booking flows. On failure throws a `BadRequestException` whose
 * `message` is the list of `"<fieldCode> <message>"` strings.
 *
 * `extensionFallback` (patient booking): if the specialty extension template is
 * missing, fall back to shell-only validation instead of 404-ing the booking.
 */
export async function assertBookVisitPayloadValid(
  validator: TemplateValidator,
  payload: Record<string, unknown>,
  options: ValidatePayloadOptions,
  opts: { extensionFallback?: boolean } = {},
): Promise<void> {
  let result;
  try {
    result = await validator.validatePayload('book_visit', payload, options);
  } catch (err) {
    if (
      opts.extensionFallback &&
      err instanceof NotFoundException &&
      options.extensionKey
    ) {
      result = await validator.validatePayload('book_visit', payload, {
        ...options,
        extensionKey: null,
      });
    } else {
      throw err;
    }
  }
  if (!result.ok) {
    throw new BadRequestException({
      message: result.errors.map((e) => `${e.fieldCode} ${e.message}`),
    });
  }
}
