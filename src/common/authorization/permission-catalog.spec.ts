import { AuthContext } from '@common/interfaces/auth-context.interface';
import { PermissionCatalog } from './permission-catalog';
import {
  PERMISSIONS,
  PERMISSION_MATRIX,
  PERSONAS,
  type CatalogPermissionId,
  type Persona,
} from './permission-matrix';

/**
 * Parity guardrail. `PermissionCatalog` must reproduce the canonical
 * `PERMISSION_MATRIX` for every persona × permission cell. The same matrix is
 * mirrored in cradlen-web, so both repos prove conformance to one table — if a
 * backend predicate drifts from the frontend (or the matrix), this fails.
 */

const base = {
  userId: 'u',
  profileId: 'p',
  organizationId: 'org',
  branchIds: ['br'],
};

const personaContexts: Record<Persona, AuthContext> = {
  ownerDoctor: { ...base, role: 'OWNER', jobFunction: 'DOCTOR', isClinical: true },
  ownerNonDoctor: { ...base, role: 'OWNER', jobFunction: null, isClinical: false },
  branchManagerDoctor: {
    ...base,
    role: 'BRANCH_MANAGER',
    jobFunction: 'DOCTOR',
    isClinical: true,
  },
  branchManagerNonDoctor: {
    ...base,
    role: 'BRANCH_MANAGER',
    jobFunction: null,
    isClinical: false,
  },
  doctor: { ...base, role: 'STAFF', jobFunction: 'DOCTOR', isClinical: true },
  receptionist: {
    ...base,
    role: 'STAFF',
    jobFunction: 'RECEPTIONIST',
    isClinical: false,
  },
  accountant: {
    ...base,
    role: 'STAFF',
    jobFunction: 'ACCOUNTANT',
    isClinical: false,
  },
};

describe('PermissionCatalog', () => {
  const catalog = new PermissionCatalog();
  const catalogIds = Object.values(PERMISSIONS) as CatalogPermissionId[];

  describe('matrix parity', () => {
    for (const id of catalogIds) {
      for (const persona of PERSONAS) {
        const expected = PERMISSION_MATRIX[id][persona];
        it(`${id} for ${persona} -> ${expected}`, () => {
          expect(catalog.check(id, personaContexts[persona])).toBe(expected);
        });
      }
    }
  });

  describe('completeness', () => {
    it('recognises every catalog id', () => {
      for (const id of catalogIds) {
        expect(catalog.has(id)).toBe(true);
      }
    });

    it('the matrix covers exactly the catalog ids', () => {
      expect(Object.keys(PERMISSION_MATRIX).sort()).toEqual(
        [...catalogIds].sort(),
      );
    });

    it('denies an unknown permission id', () => {
      expect(
        catalog.check(
          'totally.unknown' as CatalogPermissionId,
          personaContexts.ownerDoctor,
        ),
      ).toBe(false);
    });
  });
});
