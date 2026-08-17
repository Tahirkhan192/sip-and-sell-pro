/**
 * PHASE 5B — local master-data procedures (public surface).
 *
 * Everything exported here writes ONLY master/reference data, ONLY into the
 * local SQLite database, ONLY when the local flags and health checks allow it.
 * Nothing here contacts Lovable Cloud, and no transactional entity (sale,
 * purchase, expense, cash movement, stock movement, production, staff payment,
 * attendance, closing) has a local write path.
 *
 * Production screens still write through the cloud repository; routing them
 * over to these procedures is a later phase.
 */

export {
  buildInsertRow,
  buildUpdateValues,
  createMasterRow,
  restoreMasterRow,
  softDeleteMasterRow,
  updateMasterRow,
  type MasterMutationResult,
} from "./run";

export * from "./categories";
export * from "./parties";
export * from "./catalog";
export * from "./settings";
export * from "./expenses";
export * from "./inventory";

export {
  CLOUD_ONLY_TABLES,
  MASTER_TABLES,
  MASTER_TABLE_SPECS,
  MasterDataError,
  classifyTable,
  encodeColumnValue,
  isMasterTable,
  tableSpec,
  type MasterTable,
  type MasterTableSpec,
  type TableClassification,
} from "../master-tables";
