export function externalLookupsDisabled(): boolean {
  return process.env.VMI_EXTERNAL_LOOKUPS_DISABLED === '1' || process.env.VMI_OFFLINE_EVAL === '1';
}
