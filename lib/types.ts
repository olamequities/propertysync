export interface PropertyData {
  address: string | null;
  borough: string | null;
  block: string | null;
  lot: string | null;
  owner_name: string | null;
  property_owners: string[];
  property_address: string | null;
  billing_name: string | null;
  billing_address_lines: string[];
  tax_class: string | null;
  building_class: string | null;
  market_value_land: string | null;
  market_value_total: string | null;
  assessed_value: string | null;
}

export interface SheetRow {
  rowIndex: number; // 1-based row in sheet (1 = header)
  fullAddress: string;
  houseNumber: string;
  street: string;
  borough: string;
  ownerName: string;
  billingNameAndAddress: string;
  processed: string;
  block: string;        // col G
  lot: string;          // col H
  parcelStatus: string; // col I
  parcelDetails: string; // col J
  estateStatus: string;  // col L
  estateFileNumber: string; // col M
}

export interface SheetStats {
  totalRows: number;
  filledRows: number;
  emptyRows: number;
  parcelScanned: number;
  parcelRemaining: number;
  parcelGoodLeads: number;
  parcelSold: number;
  parcelNoReverse: number;
  parcelSatisfied: number;
  parcelError: number;
  estateChecked: number;
  estateRemaining: number;
  estateYes: number;
  estateNo: number;
}

export interface SheetTab {
  title: string;
  index: number;
  rowCount: number;
}

export interface ParcelProgress {
  jobId: string;
  status: "running" | "paused" | "completed" | "cancelled" | "error";
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  currentAddress: string;
  errors: { row: number; address: string; error: string }[];
  startedAt: number;
  lastCompletedRow?: {
    rowIndex: number;
    parcelStatus: string;
    parcelDetails: string;
  };
}

export interface SyncProgress {
  jobId: string;
  status: "running" | "paused" | "completed" | "cancelled" | "error";
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  currentAddress: string;
  errors: { row: number; address: string; error: string }[];
  startedAt: number;
  lastCompletedRow?: {
    rowIndex: number;
    ownerName: string;
    billingNameAndAddress: string;
  };
}
