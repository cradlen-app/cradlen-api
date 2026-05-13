import { Injectable } from '@nestjs/common';
import type { HydratableTemplate } from '../renderer/template-renderer.service.js';

export interface ComposedFrom {
  shell_id: string;
  extension_id: string;
  extension_key: string | null;
}

export type ComposedTemplate = HydratableTemplate & {
  composed_from?: ComposedFrom;
};

/**
 * Pure composer. Merge semantics: any extension section whose `code` matches
 * a shell section REPLACES the shell section at the shell's position (the
 * shell's order is preserved; the extension contributes content only).
 * Extension sections whose codes do not appear in the shell are APPENDED in
 * extension order after all shell sections.
 *
 * Field-level merging is out of scope — section is the merge unit.
 */
@Injectable()
export class TemplateCompositionService {
  compose(
    shell: HydratableTemplate,
    extension: HydratableTemplate | null,
  ): ComposedTemplate {
    if (!extension) return shell;

    const extBySectionCode = new Map(
      extension.sections.map((s) => [s.code, s]),
    );
    const usedExtCodes = new Set<string>();

    const mergedShellSections = shell.sections.map((shellSec) => {
      const override = extBySectionCode.get(shellSec.code);
      if (!override) return shellSec;
      usedExtCodes.add(shellSec.code);
      return { ...override, order: shellSec.order };
    });

    const appended = extension.sections
      .filter((s) => !usedExtCodes.has(s.code))
      .map((s, i) => ({ ...s, order: shell.sections.length + i }));

    return {
      ...shell,
      sections: [...mergedShellSections, ...appended],
      composed_from: {
        shell_id: shell.id,
        extension_id: extension.id,
        extension_key: extension.extension_key,
      },
    };
  }
}
