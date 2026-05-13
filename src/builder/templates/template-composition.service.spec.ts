import { FormScope, FormTemplateStatus } from '@prisma/client';
import { TemplateCompositionService } from './template-composition.service.js';
import type { HydratableTemplate } from '../renderer/template-renderer.service.js';

function mkSection(code: string, order: number, fieldCodes: string[] = []) {
  return {
    id: `sec-${code}`,
    form_template_id: 'tpl-shell',
    code,
    name: code,
    order,
    config: {},
    is_deleted: false,
    deleted_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    fields: fieldCodes.map((fc, i) => ({
      id: `fld-${code}-${fc}`,
      section_id: `sec-${code}`,
      code: fc,
      label: fc,
      type: 'TEXT' as const,
      order: i,
      required: false,
      binding_namespace: null,
      binding_path: null,
      config: {},
      is_deleted: false,
      deleted_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    })),
  };
}

function mkTemplate(
  id: string,
  code: string,
  sections: ReturnType<typeof mkSection>[],
): HydratableTemplate {
  return {
    id,
    code,
    name: code,
    description: null,
    scope: FormScope.BOOK_VISIT,
    version: 1,
    status: FormTemplateStatus.PUBLISHED,
    published_at: new Date(),
    is_active: true,
    activated_at: new Date(),
    specialty_id: null,
    parent_template_id: null,
    extension_key: null,
    created_by_id: null,
    updated_by_id: null,
    is_deleted: false,
    deleted_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    sections,
  } as HydratableTemplate;
}

describe('TemplateCompositionService', () => {
  const svc = new TemplateCompositionService();

  it('returns the shell unchanged when no extension is provided', () => {
    const shell = mkTemplate('s', 'book_visit', [
      mkSection('search', 0),
      mkSection('visit_metadata', 1),
    ]);
    const out = svc.compose(shell, null);
    expect(out.sections.map((s) => s.code)).toEqual([
      'search',
      'visit_metadata',
    ]);
    expect(out).toBe(shell);
  });

  it('overrides a shell section when extension has the same code, keeping shell position', () => {
    const shell = mkTemplate('s', 'book_visit', [
      mkSection('search', 0, ['shell_a']),
      mkSection('clinical_info', 1, ['shell_b']),
      mkSection('vitals', 2, ['shell_c']),
    ]);
    const ext = mkTemplate('e', 'obgyn_ext', [
      mkSection('clinical_info', 0, ['ext_b']),
    ]);
    const out = svc.compose(shell, ext);
    expect(out.sections.map((s) => s.code)).toEqual([
      'search',
      'clinical_info',
      'vitals',
    ]);
    const clinical = out.sections.find((s) => s.code === 'clinical_info')!;
    expect(clinical.fields.map((f) => f.code)).toEqual(['ext_b']);
    expect(clinical.order).toBe(1);
  });

  it('appends extension sections whose codes do not exist in the shell', () => {
    const shell = mkTemplate('s', 'book_visit', [
      mkSection('search', 0),
      mkSection('visit_metadata', 1),
    ]);
    const ext = mkTemplate('e', 'obgyn_ext', [
      mkSection('obgyn_intake', 0),
      mkSection('obgyn_history', 1),
    ]);
    const out = svc.compose(shell, ext);
    expect(out.sections.map((s) => s.code)).toEqual([
      'search',
      'visit_metadata',
      'obgyn_intake',
      'obgyn_history',
    ]);
  });

  it('mixes override and append in one pass', () => {
    const shell = mkTemplate('s', 'book_visit', [
      mkSection('a', 0),
      mkSection('b', 1),
      mkSection('c', 2),
    ]);
    const ext = mkTemplate('e', 'obgyn_ext', [
      mkSection('b', 0, ['x']),
      mkSection('d', 1),
    ]);
    const out = svc.compose(shell, ext);
    expect(out.sections.map((s) => s.code)).toEqual(['a', 'b', 'c', 'd']);
    const b = out.sections.find((s) => s.code === 'b')!;
    expect(b.fields.map((f) => f.code)).toEqual(['x']);
  });

  it('reports composition metadata so the renderer can echo it', () => {
    const shell = mkTemplate('s', 'book_visit', [mkSection('a', 0)]);
    const ext = mkTemplate('e', 'obgyn_ext', [mkSection('a', 0)]);
    ext.extension_key = 'OBGYN';
    const out = svc.compose(shell, ext);
    expect(out.composed_from).toEqual({
      shell_id: 's',
      extension_id: 'e',
      extension_key: 'OBGYN',
    });
  });
});
