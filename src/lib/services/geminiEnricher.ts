import { GoogleGenAI } from "@google/genai";
import fs from "fs";
import path from "path";
import { DiscoveredProduct } from "./sitemapParser";


// Initialize the Google Gen AI client
// Assumes GEMINI_API_KEY is defined in process.env
const apiKey = process.env.GEMINI_API_KEY;
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

export interface EnrichInput {
  Brand: string;
  Product: string;
  Title?: string;
  Category?: string;
}

export interface EnrichedProductOutput {
  Category: string;
  Product: string;
  Title: string;
  "product (item)": string;
  Series: string;
  "Main Feature": string;
  "Product Overview": string;
  "Technical Specifications": string; // JSON string of Specification[]
  image: string;
  Brand: string;
  Datasheet: string;
}

/**
 * Helper to download a file from a URL and save it locally.
 */
async function downloadFile(url: string, destPath: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
      }
    });

    if (!res.ok) {
      console.warn(`[Downloader] Failed to fetch URL: ${url}. Status: ${res.status}`);
      return false;
    }

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Ensure target directory exists
    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(destPath, buffer);
    return true;
  } catch (err) {
    console.error(`[Downloader] Error saving file from ${url}:`, err);
    return false;
  }
}

/**
 * Helper to slugify product codes for safe filenames.
 */
function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-") // Replace spaces with -
    .replace(/[^\w\-]+/g, "") // Remove all non-word chars
    .replace(/\-\-+/g, "-"); // Replace multiple - with single -
}

/**
 * Main function to enrich basic product details using Gemini Search Grounding.
 */
export async function enrichProductDataWithGeminiAgent(
  basicInfo: EnrichInput
): Promise<EnrichedProductOutput> {
  if (!ai) {
    throw new Error(
      "Gemini API key is not configured. Please add GEMINI_API_KEY to .env.local"
    );
  }

  const { Brand, Product, Title, Category } = basicInfo;
  console.log(`[Gemini Agent] Starting enrichment for Brand: ${Brand}, Product: ${Product}`);

  // ==========================================
  // STEP 1: Research Agent (Google Search Grounding)
  // ==========================================
  const researchPrompt = `
You are an AV Product Discovery and Data Enrichment Agent.
Your mission is to research and enrich professional Audio Visual product details for the following product:

INPUT:
{
  "brand": "${Brand}",
  "product": "${Product}"
  ${Title ? `, "providedTitle": "${Title}"` : ""}
  ${Category ? `, "providedCategory": "${Category}"` : ""}
}

GOALS:
1. Verify and enrich details for this product belonging to the manufacturer.
2. Prioritize official manufacturer sources.
3. Ignore consumer electronics.
4. Focus only on professional AV products.

Professional AV includes:
* Video Conferencing
* Audio Conferencing
* DSP
* AV over IP
* Matrix Switcher
* Microphone
* Camera
* Speaker
* Controller
* Digital Signage
* Interactive Display
* Room Scheduling
* Collaboration Device

RESEARCH PROCESS:
STEP 1: Locate manufacturer website and product catalog page.
STEP 2: Identify the active product matching the product code/model.
STEP 3: Find datasheet (must end with .pdf or point directly to a PDF file).
STEP 4: Determine exact category (from list above).
STEP 5: Determine product series, family, or line.
STEP 6: Extract specifications as a structured list.
STEP 7: Generate confidence score.

REASONING RULES:
* Never invent products.
* Never invent specifications.
* Never invent datasheet links.
* Prefer exact manufacturer data.
* Cross-check using multiple official sources.
* Reject products with insufficient evidence.

Find and synthesize the following details:
1. Brand: Verify the brand name.
2. Product/Model: The exact model code.
3. Title: The full official product name in Vietnamese (dịch nghĩa tiếng Việt công nghệ mượt mà, kỹ thuật AV chuẩn xác).
4. Category (Nhóm thiết bị): The exact product category.
5. Series: The product series, family, or line if applicable.
6. Main Feature: 3-4 core features in Vietnamese, separated by semicolons (;).
7. Product Overview: A clear, descriptive summary of the product in Vietnamese.
8. Technical Specifications: Gather key specifications (e.g. Dimensions, Power, Connectivity, Resolution) as a structured list.
9. Image URL: Find a high-quality, lightweight, clear web-friendly image URL of the product. It must be a direct image link.
10. Datasheet URL: Find the official PDF datasheet or manual link (must end with .pdf or point directly to a PDF file).
11. Product Item URL: The official product page link or reference page link on the brand website.

Present your research findings clearly. Include the exact URL links for the image and datasheet.
`;

  console.log("[Gemini Agent] Running Step 1: Research with Search Grounding...");
  const researchResponse = await ai.models.generateContent({
    model: "gemini-2.5-pro",
    contents: researchPrompt,
    config: {
      tools: [
        {
          googleSearch: {},
        },
      ],
    },
  });

  const researchText = researchResponse.text;
  if (!researchText) {
    throw new Error("Research Agent failed to return any content.");
  }
  console.log("[Gemini Agent] Step 1 finished. Received research findings.");

  // ==========================================
  // STEP 2: Parser Agent (JSON Schema Enforcement)
  // ==========================================
  const parserPrompt = `
You are a Data Extraction Assistant.
Your task is to read the research findings below and structure it into a single, clean JSON object following the provided schema.

Research Findings:
"""
${researchText}
"""

Guidelines:
- Match the keys exactly as specified in the schema.
- The 'TechnicalSpecifications' field must be a valid stringified JSON array of specification objects. Format: '[{"label":"Chiều cao","value":"100mm"},{"label":"Cân nặng","value":"1.5kg"}]'.
- Translate product titles, features, and overview into natural, professional Vietnamese.
- For 'image', use the best product image URL found in the research. Do not make up or invent URLs. If none exists, return an empty string.
- For 'Datasheet', use the PDF datasheet URL found in the research. Must point directly to a PDF. If none exists, return an empty string.
- For 'productItem', use the official brand product page URL.
`;

  console.log("[Gemini Agent] Running Step 2: Parsing into Structured JSON...");
  const parserResponse = await ai.models.generateContent({
    model: "gemini-2.5-pro",
    contents: parserPrompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "object",
        properties: {
          Category: {
            type: "string",
            description: "Nhóm thiết bị (Màn hình cảm ứng / Bộ xử lý DSP / Camera / Micro...)",
          },
          Product: {
            type: "string",
            description: "Mã model chính xác của sản phẩm",
          },
          Title: {
            type: "string",
            description: "Tên sản phẩm (Dịch nghĩa tiếng Việt công nghệ mượt mà)",
          },
          productItem: {
            type: "string",
            description: "URL trang tài liệu gốc hoặc trang sản phẩm của hãng",
          },
          Series: {
            type: "string",
            description: "Dòng sản phẩm (Series/Family/Range) nếu có",
          },
          MainFeature: {
            type: "string",
            description: "Tóm tắt các tính năng cốt lõi bằng tiếng Việt, phân tách các ý bằng dấu chấm phẩy (;)",
          },
          ProductOverview: {
            type: "string",
            description: "Mô tả tổng quan sản phẩm bằng tiếng Việt",
          },
          TechnicalSpecifications: {
            type: "string",
            description: "Thông số kỹ thuật định dạng JSON string của mảng các đối tượng {label, value}",
          },
          image: {
            type: "string",
            description: "URL hình ảnh sản phẩm chất lượng tốt tìm được trên mạng. Do not invent/hallucinate URLs. Return empty string if not found.",
          },
          Brand: {
            type: "string",
            description: "Tên hãng (Crestron / Q-SYS / Extron...)",
          },
          Datasheet: {
            type: "string",
            description: "URL tài liệu PDF datasheet sản phẩm tìm được trên mạng. Must end in .pdf. Return empty string if not found.",
          },
          confidenceScore: {
            type: "number",
            description: "Confidence score of the gathered details (0 to 1)",
          },
          verified: {
            type: "boolean",
            description: "Whether the product is verified as professional AV",
          },
        },
        required: [
          "Category",
          "Product",
          "Title",
          "productItem",
          "Series",
          "MainFeature",
          "ProductOverview",
          "TechnicalSpecifications",
          "image",
          "Brand",
          "Datasheet",
          "confidenceScore",
          "verified",
        ],
      },
    },
  });

  const jsonText = parserResponse.text;
  if (!jsonText) {
    throw new Error("Parser Agent failed to return a JSON string.");
  }

  interface ParserOutput {
    Category: string;
    Product: string;
    Title: string;
    productItem: string;
    Series: string;
    MainFeature: string;
    ProductOverview: string;
    TechnicalSpecifications: string;
    image: string;
    Brand: string;
    Datasheet: string;
    confidenceScore: number;
    verified: boolean;
  }

  let parserData: ParserOutput;
  try {
    parserData = JSON.parse(jsonText.trim()) as ParserOutput;
  } catch (err) {
    console.error("[Gemini Agent] Failed to parse JSON response:", jsonText);
    throw new Error(`Enrichment Parser returned malformed JSON: ${(err as Error).message}`);
  }

  const enrichedData: EnrichedProductOutput = {
    Category: parserData.Category,
    Product: parserData.Product,
    Title: parserData.Title,
    "product (item)": parserData.productItem,
    Series: parserData.Series,
    "Main Feature": parserData.MainFeature,
    "Product Overview": parserData.ProductOverview,
    "Technical Specifications": parserData.TechnicalSpecifications,
    image: parserData.image,
    Brand: parserData.Brand,
    Datasheet: parserData.Datasheet,
  };

  // ==========================================
  // STEP 3: Local Storage & Optimization
  // ==========================================
  const productSlug = slugify(enrichedData.Product || Product);
  
  // 1. Handle image downloading
  if (enrichedData.image && enrichedData.image.startsWith("http")) {
    const ext = path.extname(new URL(enrichedData.image).pathname) || ".jpg";
    const cleanExt = [".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(ext.toLowerCase()) ? ext : ".jpg";
    const localImgPath = path.join(process.cwd(), "public", "downloads", "images", `${productSlug}${cleanExt}`);
    
    console.log(`[Gemini Agent] Downloading image: ${enrichedData.image} to ${localImgPath}`);
    const downloadSuccess = await downloadFile(enrichedData.image, localImgPath);
    if (downloadSuccess) {
      // Set the path relative to the public folder
      enrichedData.image = `/downloads/images/${productSlug}${cleanExt}`;
      console.log(`[Gemini Agent] Image downloaded successfully. Saved path: ${enrichedData.image}`);
    } else {
      console.warn(`[Gemini Agent] Failed to download image from: ${enrichedData.image}. Retaining original URL.`);
    }
  }

  // 2. Handle datasheet downloading
  if (enrichedData.Datasheet && enrichedData.Datasheet.startsWith("http")) {
    const localPdfPath = path.join(process.cwd(), "public", "downloads", "datasheets", `${productSlug}.pdf`);
    
    console.log(`[Gemini Agent] Downloading datasheet: ${enrichedData.Datasheet} to ${localPdfPath}`);
    const downloadSuccess = await downloadFile(enrichedData.Datasheet, localPdfPath);
    if (downloadSuccess) {
      enrichedData.Datasheet = `/downloads/datasheets/${productSlug}.pdf`;
      console.log(`[Gemini Agent] Datasheet downloaded successfully. Saved path: ${enrichedData.Datasheet}`);
    } else {
      console.warn(`[Gemini Agent] Failed to download datasheet from: ${enrichedData.Datasheet}. Retaining original URL.`);
    }
  }

  return enrichedData;
}

/**
 * AI-driven product discovery agent that uses Google Search Grounding to find products from scratch.
 */
export async function discoverProductsWithGeminiAgent(
  brand: string,
  keyword?: string
): Promise<DiscoveredProduct[]> {
  if (!ai) {
    throw new Error(
      "Gemini API key is not configured. Please add GEMINI_API_KEY to .env.local"
    );
  }

  console.log(`[Gemini Discovery Agent] Starting product discovery for brand: ${brand}`);

  const discoveryPrompt = `
You are an AV Product Discovery Agent.
Your mission is to search Google using Google Search Grounding to find all professional Audio Visual products from the manufacturer "${brand}".

INPUT:
{
  "brand": "${brand}"
  ${keyword ? `, "keyword": "${keyword}"` : ""}
}

GOALS:
1. Identify all correct and verified model names (e.g. MXA920, Neat Board, etc.) for this brand.
2. Prioritize official manufacturer source listings.
3. Ignore consumer electronics. Focus 100% on professional AV products.

For every discovered product return a structured object with these fields:
- Category: The category of the product (e.g. Video Conferencing / Audio Conferencing / DSP / Microphone / Camera / Speaker / Controller / Room Scheduling).
- Product: The exact model code or product identifier (e.g. MXA920, Rally Bar Mini, Neat Board Pro).
- Title: The full official product name in Vietnamese (e.g. Micrô ma trận âm trần Shure MXA920).
- Brand: The brand name.
- confidenceScore: Confidence score (0 to 1).
- verified: True if the product is verified as professional AV, false otherwise.

Do NOT attempt to search for specifications, images, datasheets, or overviews in this step. These will be retrieved via a dedicated enrichment step later. Focus on retrieving high-accuracy model codes and categories. Find up to 10 products.
`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-pro",
    contents: discoveryPrompt,
    config: {
      tools: [
        {
          googleSearch: {},
        },
      ],
      responseMimeType: "application/json",
      responseSchema: {
        type: "array",
        items: {
          type: "object",
          properties: {
            Category: { type: "string" },
            Product: { type: "string" },
            Title: { type: "string" },
            Brand: { type: "string" },
            confidenceScore: { type: "number" },
            verified: { type: "boolean" },
          },
          required: [
            "Category",
            "Product",
            "Title",
            "Brand",
            "confidenceScore",
            "verified",
          ],
        },
      },
    },
  });

  const jsonText = response.text;
  if (!jsonText) {
    throw new Error("Gemini Discovery Agent failed to return a response.");
  }

  interface DiscoveryOutput {
    Category: string;
    Product: string;
    Title: string;
    Brand: string;
    confidenceScore: number;
    verified: boolean;
  }

  let discoveredList: DiscoveryOutput[];
  try {
    discoveredList = JSON.parse(jsonText.trim()) as DiscoveryOutput[];
  } catch (err) {
    console.error("[Gemini Discovery Agent] Failed to parse JSON response:", jsonText);
    return [];
  }

  // Filter for verified professional AV products and map to DiscoveredProduct.
  // Note: We return empty strings for features, overview, specifications, image, and datasheet.
  // This forces the discovery engine pipeline to run the dedicated enrichProductDataWithGeminiAgent
  // function for each candidate, resulting in extremely high-quality and accurate details.
  return discoveredList
    .filter((p) => p.verified && p.confidenceScore >= 0.5)
    .map((p) => ({
      Category: p.Category,
      Product: p.Product,
      Title: p.Title,
      productItem: "",
      Series: "",
      MainFeature: "",
      ProductOverview: "",
      TechnicalSpecifications: "[]",
      image: "",
      Datasheet: "",
    }));
}
