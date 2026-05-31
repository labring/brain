/** biome-ignore lint/performance/noBarrelFile: Compatibility facade for app-local Platform Address imports. */
export {
  CUSTOM_DOMAIN_BINDING_ID_PATTERN,
  CUSTOM_DOMAIN_BINDING_ID_RE,
  customDomainBindingIdFromValue,
  generateCustomDomainBindingId,
  generatePlatformAddressId,
  isCustomDomainBindingId,
  isPlatformAddressId,
  normalizeCustomDomainBindingId,
  normalizePlatformAddressId,
  PLATFORM_ADDRESS_ID_PATTERN,
  PLATFORM_ADDRESS_ID_RE,
  platformAddressEndpoint,
  platformAddressHost,
  platformAddressIdFromValue,
  platformAddressIdsFromRows,
} from "@workspace/crossplane/lib/platform-address";
