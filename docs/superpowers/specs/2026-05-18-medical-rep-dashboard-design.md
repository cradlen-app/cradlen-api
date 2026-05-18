# Medical Rep Dashboard Page — Design Spec

**Date:** 2026-05-18
**Status:** Approved

---

## Context

The dashboard sidebar already shows a **Medical Rep** nav item (owner-only, order 70, path `/medical-rep`), but no page exists behind it. Owners need a way to see all medical representatives who visit the clinic, filter them by status, search by name, view their details, and block/unblock access.

---

## Scope

- Paginated list of medical reps with search and status filter
- Read-only detail drawer (opens on row click)
- Block / Unblock status toggle (confirmation dialog)
- No add / edit / delete in this iteration

---

## Architecture

Placed in `src/features/medical-rep/` following the same pattern as `src/features/medications/`. The sidebar nav item is already hardcoded in `OWNER_LEGACY_NAV` — no kernel changes needed.

---

## File Structure

```
src/features/medical-rep/
├── types/
│   └── medical-rep.types.ts          # Domain type + API response shape
├── lib/
│   ├── medical-rep.api.ts            # fetchMedicalReps, toggleMedicalRepStatus
│   └── medical-rep.queryKeys.ts      # Query key factory
├── hooks/
│   ├── useMedicalReps.ts             # TanStack Query list hook
│   └── useToggleMedicalRepStatus.ts  # Mutation hook
└── components/
    ├── MedicalRepPage.tsx            # Main container (page-level state)
    ├── MedicalRepTable.tsx           # Table + skeleton loader
    └── MedicalRepDrawer.tsx          # Read-only detail drawer

src/app/[locale]/[orgId]/[branchId]/dashboard/medical-rep/
└── page.tsx                          # Thin route wrapper
```

---

## Types (`medical-rep.types.ts`)

```typescript
// API response shape (matches backend)
export interface ApiMedicalRep {
  id: string;
  full_name: string;
  company_name?: string;
  national_id?: string;
  phone?: string;
  products?: string[];        // medication/product names
  last_visit_date?: string;   // ISO date string
  visits_count?: number;
  status: "active" | "blocked";
  notes?: string;
}

// Domain type (camelCase, safe defaults)
export interface MedicalRep {
  id: string;
  fullName: string;
  companyName: string;
  nationalId: string;
  phone: string;
  products: string[];
  lastVisitDate: string | null;
  visitsCount: number;
  status: "active" | "blocked";
  notes: string;
}

export interface MedicalRepListResponse {
  data: ApiMedicalRep[];
  meta: { total: number; page: number; limit: number };
}
```

Mapper `mapApiMedicalRepToMedicalRep` converts `ApiMedicalRep → MedicalRep`.

---

## API Functions (`medical-rep.api.ts`)

```typescript
// GET /medical-reps?search=...&status=...&page=...&limit=...
fetchMedicalReps(params: { search?: string; status?: string; page: number; limit: number })
  → Promise<MedicalRepListResponse>

// PATCH /medical-reps/:id/status  { status: "active" | "blocked" }
toggleMedicalRepStatus(id: string, status: "active" | "blocked")
  → Promise<void>
```

Uses `apiAuthFetch` (same as `medical-rep.api.ts` inside `features/visits/`).

---

## Query Keys (`medical-rep.queryKeys.ts`)

```typescript
export const medicalRepQueryKeys = {
  all: () => ["medical-reps"] as const,
  list: (params: { search?: string; status?: string; page: number; limit: number }) =>
    ["medical-reps", "list", params] as const,
};
```

---

## Hooks

**`useMedicalReps`** — TanStack Query, enabled when `branchId` exists, `staleTime: 30_000`.

**`useToggleMedicalRepStatus`** — mutation that calls `toggleMedicalRepStatus`, then invalidates `medicalRepQueryKeys.all()`. Shows success/error toast via Sonner.

Uses `useAuthContext()` to get `orgId` / `branchId` (same pattern as `useMedications`).

---

## Components

### `MedicalRepPage`
- State: `search`, `page`, `statusFilter` ("" | "active" | "blocked"), `selectedRep: MedicalRep | null`, `drawerOpen`, `blockingRep: MedicalRep | null`
- Deferred search via `useDeferredValue`
- Renders: toolbar → table → drawer → block confirm dialog
- Passes `onRowClick` → opens drawer, `onStatusClick` → opens confirm dialog

### `MedicalRepTable`
- Props: `reps`, `isLoading`, `total`, `page`, `limit`, `onPageChange`, `onRowClick`, `onStatusClick`
- Columns: Name+avatar, Phone, Products (`, `-joined), Last Visit (formatted date), Visits, Status badge, Notes
- Avatar: two-letter initials, color seeded from name (same approach as existing visit tables)
- Skeleton: 10 rows × 7 columns while loading
- Status badge: green dot + "Active" or red dot + "Block" — clickable

### `MedicalRepDrawer`
- Shell identical to `MedicationDrawer`: `Dialog.Root` from `radix-ui`, `fixed inset-y-0 inset-e-0 z-[41] flex w-full max-w-[480px] flex-col bg-white shadow-2xl`
- Header: breadcrumb (`Medical Rep / Details`) + rep name as title + X close
- Body (`px-6 py-5 space-y-4 overflow-y-auto`): read-only field rows for Phone, National ID, Company, Last Visit, Total Visits, Products (tag chips), Notes
- Footer: Cancel button + Block/Unblock action button (`bg-red-600` for block, `bg-brand-primary` for unblock)
- Clicking footer action opens the confirm dialog (does not mutate directly)

### Block Confirm Dialog
- Radix `AlertDialog` (same as `DeleteMedicationDialog`)
- Title: "Block Medical Rep" / "Unblock Medical Rep"
- Description: confirmation text with rep name
- Confirm triggers `useToggleMedicalRepStatus` mutation

---

## Route (`page.tsx`)

```typescript
import { setRequestLocale } from "next-intl/server";
import { MedicalRepPage } from "@/features/medical-rep/components/MedicalRepPage";

export default async function MedicalRepRoute({ params }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <MedicalRepPage />;
}
```

---

## i18n

Add `"medicalRep"` namespace to `src/messages/en.json` and `src/messages/ar.json`:

```json
"medicalRep": {
  "title": "Medical Rep",
  "search": "Search ....",
  "statusFilter": { "all": "Status", "active": "Active", "blocked": "Block" },
  "table": {
    "name": "Name", "phone": "Phone", "products": "Products",
    "lastVisit": "Last Visit", "visits": "Visits",
    "status": "Status", "notes": "Notes",
    "showingResults": "show {count} of {total} results"
  },
  "status": { "active": "Active", "blocked": "Block" },
  "drawer": {
    "breadcrumb": "Medical Rep", "title": "Rep Details",
    "phone": "Phone", "nationalId": "National ID", "company": "Company",
    "lastVisit": "Last Visit", "totalVisits": "Total Visits",
    "products": "Products", "notes": "Notes",
    "blockButton": "Block Rep", "unblockButton": "Unblock Rep", "cancel": "Cancel"
  },
  "blockDialog": {
    "blockTitle": "Block Medical Rep", "unblockTitle": "Unblock Medical Rep",
    "blockDescription": "Block {name}? They will no longer be able to book visits.",
    "unblockDescription": "Unblock {name}? They will be able to book visits again.",
    "confirm": "Confirm", "cancel": "Cancel"
  },
  "toast": {
    "blocked": "Rep blocked", "unblocked": "Rep unblocked",
    "error": "Something went wrong"
  }
}
```

---

## Verification

1. `npm run dev` — navigate to `/<locale>/<orgId>/<branchId>/dashboard/medical-rep`
2. Table loads and paginates correctly
3. Search debounces and filters results
4. Status dropdown filters list
5. Clicking a row opens drawer with correct data
6. Block/Unblock button in drawer opens confirm dialog
7. Confirming updates status, closes drawer, refreshes list, shows toast
8. `npm run lint && npm run build` — no errors
9. Check Arabic locale: RTL layout, translated strings
