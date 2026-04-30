import { ApiError } from "./externalApi";

/**
 * Map an `ApiError` from POST/DELETE `/api/projects/:id/actions-upload`
 * (or any sibling endpoint that emits the same structured codes) to a
 * user-readable string. Shared by the Settings card and the Project
 * Wizard's Advanced step so both surfaces render identical copy.
 */
export function formatUploadError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "schema_validation_failed") {
      const errors =
        (err.payload.errors as Array<{ code: string }> | undefined) ?? [];
      const codes = errors.map((e) => e.code).slice(0, 3).join(", ");
      return `Schema validation failed: ${codes || "unknown"}`;
    }
    if (err.code === "invalid_json") {
      return `Invalid JSON: ${err.detail ?? "could not parse"}`;
    }
    if (err.code === "invalid_placeholder") {
      const placeholder =
        typeof err.payload.placeholder === "string"
          ? err.payload.placeholder
          : "?";
      const actionId =
        typeof err.payload.actionId === "string"
          ? err.payload.actionId
          : "?";
      return `Unknown placeholder \`{${placeholder}}\` in action \`${actionId}\` (command_template).`;
    }
    if (err.code === "payload_too_large") {
      return "File exceeds the 256 KB upload limit.";
    }
    if (err.code === "project_path_unavailable") {
      return "This project does not have a filesystem path on the server.";
    }
    return `${err.code}${err.detail ? ": " + err.detail : ""}`;
  }
  return String(err).slice(0, 200);
}
