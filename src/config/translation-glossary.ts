/**
 * translation-glossary.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Server-side, extensible glossary of AV-industry brand names, protocols, and
 * standards that must never be machine-translated — they are copied verbatim
 * into the English output regardless of surrounding sentence structure.
 *
 * Add new terms here (not inline in a prompt string) so every caller — the
 * translation provider, prompt builders, QA checks — shares one source of truth.
 */
export const AV_GLOSSARY_TERMS: string[] = [
  "AV-over-IP",
  "AVoIP",
  "HDBaseT",
  "Dante",
  "Dante AV",
  "AES67",
  "NDI",
  "SDVoE",
  "PoE",
  "PoE+",
  "PoE++",
  "HDMI",
  "DisplayPort",
  "USB-C",
  "BYOD",
  "BYOM",
  "Digital Signage",
  "Microsoft Teams Rooms",
  "Zoom Rooms",
  "Webex",
  "Crestron",
  "Extron",
  "Q-SYS",
  "Biamp",
  "Shure",
  "Sennheiser",
  "Televic",
  "Appspace",
  "Logitech",
  "Neat",
  "Barco",
  "Poly",
];
