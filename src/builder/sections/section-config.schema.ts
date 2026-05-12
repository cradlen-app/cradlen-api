import { assertValidConfig, ConfigShape, InvalidConfigError } from '../fields/field-config.schema.js';

export type { ConfigShape };
export { InvalidConfigError };

/**
 * Section-level `config` follows the same namespaced shape as field config.
 * Sections may carry a `logic.predicates` array but `logic.is_discriminator`
 * is not meaningful at section level — that flag lives on fields.
 */
export function assertValidSectionConfig(
  config: unknown,
  contextLabel: string,
): asserts config is ConfigShape {
  assertValidConfig(config, contextLabel);
  if (config.logic?.is_discriminator !== undefined) {
    throw new InvalidConfigError(
      `${contextLabel}: is_discriminator is meaningful only on fields, not sections`,
    );
  }
}
