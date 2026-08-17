/**
 * PHASE 5B — people and organisations: customers, suppliers, employees, staff
 * and branches.
 *
 * Profile data only. Every balance-like field is derived by the cloud from
 * transactions (customer balances and visit history, supplier balance, staff
 * katha balance and salary history), so it is not writable here — the sole
 * exception is a staff member's OPENING katha, which the existing screen sets
 * once when the record is created.
 */

import {
  createMasterRow,
  restoreMasterRow,
  softDeleteMasterRow,
  updateMasterRow,
  type MasterMutationResult,
} from "./run";

/* ---------------- customers ---------------- */

export type CustomerInput = {
  name: string;
  phone?: string | null;
  address?: string | null;
  notes?: string | null;
};

export function createCustomer(input: CustomerInput): Promise<MasterMutationResult> {
  return createMasterRow("customers", normalizeParty(input));
}

export function updateCustomer(
  id: string,
  input: Partial<CustomerInput>,
): Promise<MasterMutationResult> {
  return updateMasterRow("customers", id, normalizeParty(input));
}

export function deleteCustomer(id: string): Promise<MasterMutationResult> {
  return softDeleteMasterRow("customers", id);
}

/* ---------------- suppliers ---------------- */

export type SupplierInput = {
  name: string;
  phone?: string | null;
  address?: string | null;
  notes?: string | null;
};

export function createSupplier(input: SupplierInput): Promise<MasterMutationResult> {
  return createMasterRow("suppliers", normalizeParty(input));
}

export function updateSupplier(
  id: string,
  input: Partial<SupplierInput>,
): Promise<MasterMutationResult> {
  return updateMasterRow("suppliers", id, normalizeParty(input));
}

export function deleteSupplier(id: string): Promise<MasterMutationResult> {
  return softDeleteMasterRow("suppliers", id);
}

function normalizeParty(input: Record<string, any>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (input.name !== undefined) out.name = String(input.name).trim();
  if (input.phone !== undefined) out.phone = input.phone ? String(input.phone).trim() : null;
  if (input.address !== undefined) out.address = input.address || null;
  if (input.notes !== undefined) out.notes = input.notes || null;
  return out;
}

/* ---------------- employees ---------------- */

export type EmployeeInput = {
  name: string;
  role?: string | null;
  phone?: string | null;
  salary?: number;
  joined_on?: string | null;
  active?: boolean;
};

export function createEmployee(input: EmployeeInput): Promise<MasterMutationResult> {
  return createMasterRow("employees", { ...input, name: input.name.trim() });
}

export function updateEmployee(
  id: string,
  input: Partial<EmployeeInput>,
): Promise<MasterMutationResult> {
  const patch = { ...input };
  if (patch.name !== undefined) patch.name = patch.name.trim();
  return updateMasterRow("employees", id, patch);
}

export function deleteEmployee(id: string): Promise<MasterMutationResult> {
  return softDeleteMasterRow("employees", id);
}

/* ---------------- staff ---------------- */

export type StaffInput = {
  name: string;
  father_name?: string | null;
  phone?: string | null;
  cnic?: string | null;
  joining_date: string;
  monthly_salary?: number;
  status?: "active" | "inactive";
  notes?: string | null;
  opening_katha?: number;
};

/**
 * Creates a staff member. `katha_balance` starts at the opening katha, which
 * is exactly what the Staff screen does today; every later change to it comes
 * from katha sales and staff payments, which stay cloud-only.
 */
export function createStaff(input: StaffInput): Promise<MasterMutationResult> {
  const opening = input.opening_katha ?? 0;
  return createMasterRow("staff", {
    ...normalizeStaff(input),
    joining_date: input.joining_date,
    opening_katha: opening,
    katha_balance: opening,
  });
}

/** Profile edit only — katha balance and salary history are never touched. */
export function updateStaff(
  id: string,
  input: Partial<StaffInput>,
): Promise<MasterMutationResult> {
  return updateMasterRow("staff", id, normalizeStaff(input));
}

export function deleteStaff(id: string): Promise<MasterMutationResult> {
  return softDeleteMasterRow("staff", id);
}

export function restoreStaff(id: string): Promise<MasterMutationResult> {
  return restoreMasterRow("staff", id);
}

function normalizeStaff(input: Partial<StaffInput>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (input.name !== undefined) out.name = input.name.trim();
  if (input.father_name !== undefined) out.father_name = input.father_name?.trim() || null;
  if (input.phone !== undefined) out.phone = input.phone?.trim() || null;
  if (input.cnic !== undefined) out.cnic = input.cnic?.trim() || null;
  if (input.joining_date !== undefined) out.joining_date = input.joining_date;
  if (input.monthly_salary !== undefined) out.monthly_salary = input.monthly_salary;
  if (input.status !== undefined) out.status = input.status;
  if (input.notes !== undefined) out.notes = input.notes?.trim() || null;
  if (input.opening_katha !== undefined) out.opening_katha = input.opening_katha;
  return out;
}

/* ---------------- branches ---------------- */

export type BranchInput = { name: string; address?: string | null };

export function createBranch(input: BranchInput): Promise<MasterMutationResult> {
  return createMasterRow("branches", { ...input, name: input.name.trim() });
}

export function updateBranch(
  id: string,
  input: Partial<BranchInput>,
): Promise<MasterMutationResult> {
  return updateMasterRow("branches", id, input);
}

export function deleteBranch(id: string): Promise<MasterMutationResult> {
  return softDeleteMasterRow("branches", id);
}
