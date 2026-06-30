import brainV2Logo from "./brain-v2-logo.svg";
import sealosLogo from "./sealos-logo.svg";

export const brainV2LogoAsset = brainV2Logo;
export const brainV2LogoSrc = assetSrc(brainV2Logo);
export const sealosLogoAsset = sealosLogo;
export const sealosLogoSrc = assetSrc(sealosLogo);

function assetSrc(src: string | { src: string }): string {
  return typeof src === "string" ? src : src.src;
}
