export type FieldError = { field?: string; message: string; code?: string; index?: number; rfid_number?: string };

export class ApiError extends Error {
  status: number;
  errors: FieldError[];
  body: unknown;

  constructor(message: string, status: number, errors: FieldError[] = [], body: unknown = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.errors = errors;
    this.body = body;
  }
}

export type ApiEnvelope<T> = { success: true; data: T; message?: string };

// Use the same-origin Next.js proxy by default. This keeps Docker-only hostnames
// out of browser code and avoids a web-dashboard CORS dependency.
const apiBaseUrl = (process.env.NEXT_PUBLIC_API_BASE_URL || "").replace(/\/$/, "");

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, { ...options, headers, cache: "no-store" });
  } catch {
    throw new ApiError("Tidak dapat terhubung ke server API. Periksa konfigurasi URL dan koneksi Anda.", 0);
  }

  const body: unknown = await response.json().catch(() => ({}));
  const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
  if (!response.ok || record.success === false) {
    throw new ApiError(
      typeof record.message === "string" ? record.message : "Permintaan ke server gagal.",
      response.status,
      Array.isArray(record.errors) ? record.errors as FieldError[] : [],
      body,
    );
  }
  return body as T;
}

export const messageFromError = (error: unknown) => {
  if (!(error instanceof ApiError)) return "Terjadi kesalahan tak terduga.";
  const details = error.errors.map((item) => `${item.field ? `${item.field}: ` : ""}${item.message}`).filter((message) => message !== error.message);
  return [error.message, ...details].join(" ");
};
export const fieldErrors = (error: unknown) => error instanceof ApiError ? error.errors : [];

export function getRepackRequirement(supplierPackQuantity: number, supplierPackUnits: number, minOutboundUnits: number): { totalPcs: number; requiredRfid: number } | null {
  if (![supplierPackQuantity, supplierPackUnits, minOutboundUnits].every(Number.isInteger)) return null;
  if (supplierPackQuantity < 1 || supplierPackUnits < 1 || minOutboundUnits < 1) return null;
  const totalPcs = supplierPackQuantity * supplierPackUnits;
  if (totalPcs % minOutboundUnits !== 0) return null;
  return { totalPcs, requiredRfid: totalPcs / minOutboundUnits };
}

export function normalizeUids(raw: string): string[] {
  return raw.split(/[\n,\t ]+/).map((uid) => uid.trim().toUpperCase()).filter(Boolean);
}

export type Product = {
  id: string;
  sku: string;
  name: string;
  base_unit: string;
  supplier_pack_units: number;
  supplier_pack_label?: string | null;
  min_outbound_units: number;
  expiry_required: boolean;
  status: "active" | "inactive" | string;
};

export type RfidTag = { id: number; rfid_number: string; status: string; created_at?: string };
export type Rack = { id: string; code: string; name: string; description?: string | null; status: "active" | "inactive" | string; created_at?: string; updated_at?: string };
export type PlacementItem = {
  rfid_number: string;
  rfid_tag_id: number;
  pack_plan_id: string;
  pack_number: number;
  label_code?: string;
  product_id: string;
  sku: string;
  product_name: string;
  units: number;
  base_unit: string;
  expires_on?: string | null;
  placement_status: string;
  current_rack?: Rack | null;
};
export type TerminalMovementType = "outbound" | "trash";
export type TerminalScanSession = {
  id: string;
  reader_code: string;
  scan_type: "terminal_movement";
  movement_type: TerminalMovementType;
  status: string;
  expires_at: string;
};
export type TerminalPreviewItem = PlacementItem & {
  eligible: boolean;
  error_code?: string;
  message?: string;
};
export type TerminalPreview = {
  movement_type: TerminalMovementType;
  eligible: boolean;
  total_requested: number;
  total_eligible: number;
  items: TerminalPreviewItem[];
};
export type InventoryMovementResponse = {
  client_request_id: string;
  movement_type: TerminalMovementType;
  total_processed: number;
  processed_at: string;
  items: PlacementItem[];
};
export type PlacementResponse = {
  client_request_id: string;
  rack: Rack;
  total_placed: number;
  placed_at: string;
  items: PlacementItem[];
};
export type PackPlan = {
  id: string;
  sequence_number: number;
  units: number;
  status: "pending_tag" | "tag_assigned" | "label_printed" | "cancelled" | string;
  placement_status?: "unplaced" | "placed" | "outbound" | "trash" | string;
  currentRack?: Rack | null;
  label_code?: string;
  rfidTag?: RfidTag | null;
};
export type PoSessionItem = {
  id: string;
  product_id?: string;
  product_name_snapshot: string;
  product_sku_snapshot?: string;
  base_unit?: string;
  base_unit_snapshot?: string;
  ordered_supplier_pack_quantity: number;
  supplier_pack_units_snapshot: number;
  supplier_pack_label_snapshot?: string | null;
  ordered_quantity: number;
  min_outbound_units: number;
  expires_on?: string | null;
  notes?: string | null;
  required_rfid_count: number;
  status: "pending_tags" | "ready_to_print" | "printed" | "cancelled" | string;
  packPlans?: PackPlan[];
};
export type LabelPrintJob = { id: string; status: "generated" | "printed" | "failed" | "cancelled" | string; format?: "pdf" | "zpl"; created_at?: string };
export type PoSession = {
  id: string;
  session_number: string;
  reference_number?: string | null;
  notes?: string | null;
  status: "active" | "completed" | "cancelled" | string;
  created_at?: string;
  items?: PoSessionItem[];
  labelPrintJobs?: LabelPrintJob[];
};
export type RfidProgress = { po_session_item_id: string; required_rfid_count: number; assigned_rfid_count: number; remaining_rfid_count: number; status: string };
export type ScanResult = { index?: number; rfid_number: string; id?: number; rfid_tag_id?: number; pack_plan_id?: string; pack_number?: number; label_code?: string; registered_now?: boolean; code?: string; eligible?: boolean; product_id?: string; sku?: string; product_name?: string; units?: number; base_unit?: string; expires_on?: string | null; placement_status?: string; current_rack?: Rack | null };
export type ScanError = { index?: number; rfid_number?: string; code: string; message: string; session_number?: string; po_session_item_id?: string; product_name?: string; placement_status?: string };
export type ScanResponse = { success: boolean; total_requested: number; total_assigned: number; total_errors: number; remaining_rfid_count: number; results: ScanResult[]; errors: ScanError[] };
export type LabelSnapshot = { session_number: string; sku: string; product_name: string; base_unit: string; units: number; pack_number: number; expiry_date?: string | null; rfid_uid: string; label_code: string };
export type PrintJobDetail = LabelPrintJob & { items: Array<{ id?: string; label_snapshot: LabelSnapshot }> };
