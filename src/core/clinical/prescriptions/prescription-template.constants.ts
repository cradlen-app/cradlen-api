/**
 * Layout descriptor for the printed prescription ("paper"). The printout is
 * data-driven: a `PrescriptionTemplate.layout` is an ordered list of blocks the
 * frontend renders through a block registry. Adding a block type here (and a
 * matching renderer on the web) needs no schema change — that is what makes the
 * future "doctor designs their own paper" feature a drop-in.
 */
export type PrescriptionBlockType =
  | 'header'
  | 'doctor'
  | 'patient'
  | 'diagnosis'
  | 'medications'
  | 'notes'
  | 'signature'
  | 'footer';

export interface PrescriptionBlock {
  type: PrescriptionBlockType;
  /** Defaults to true; an explicit `false` hides the block without removing it. */
  visible?: boolean;
  /** Free-form per-block options reserved for the future template editor. */
  options?: Record<string, unknown>;
}

export interface PrescriptionTemplateLayout {
  blocks: PrescriptionBlock[];
}

/** Name of the seeded global default template. */
export const DEFAULT_PRESCRIPTION_TEMPLATE_NAME = 'System Default';

/**
 * v1 default layout — medications-only printout (diagnosis/signature blocks
 * exist in the model but are omitted here by product decision).
 */
export const DEFAULT_PRESCRIPTION_LAYOUT: PrescriptionTemplateLayout = {
  blocks: [
    { type: 'header' },
    { type: 'doctor' },
    { type: 'patient' },
    { type: 'medications' },
    { type: 'notes' },
    { type: 'footer' },
  ],
};
