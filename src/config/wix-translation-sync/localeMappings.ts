import { LocaleConfiguration } from "../../types/wix-translation-sync";

export const LOCALE_CONFIGS: Record<string, LocaleConfiguration> = {
  EN: {
    code: "EN",
    label: "English (EN)",
    wixTargetColumn: "Target language (EN)",
    cmsFieldSuffix: "_EN",
  },
  VI: {
    code: "VI",
    label: "Vietnamese (VI)",
    wixTargetColumn: "Target language (VI)",
    cmsFieldSuffix: "_VI",
  },
  JA: {
    code: "JA",
    label: "Japanese (JA)",
    wixTargetColumn: "Target language (JA)",
    cmsFieldSuffix: "_JA",
  },
  KO: {
    code: "KO",
    label: "Korean (KO)",
    wixTargetColumn: "Target language (KO)",
    cmsFieldSuffix: "_KO",
  },
  ZH: {
    code: "ZH",
    label: "Chinese (ZH)",
    wixTargetColumn: "Target language (ZH)",
    cmsFieldSuffix: "_ZH",
  },
  TH: {
    code: "TH",
    label: "Thai (TH)",
    wixTargetColumn: "Target language (TH)",
    cmsFieldSuffix: "_TH",
  },
};
