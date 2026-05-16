// Re-export of the generic revision-helper now living in @common/utils so
// specialty modules don't pull from the deeper path. Kept here only to keep
// existing specialty imports stable.
export { buildRevision } from '@common/utils/revisions.helper.js';
export type { RevisionPayload } from '@common/utils/revisions.helper.js';
