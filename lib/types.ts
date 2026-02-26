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
}

export interface SheetStats {
  totalRows: number;
  filledRows: number;
  emptyRows: number;
}

export interface SheetTab {
  title: string;
  index: number;
  rowCount: number;
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
