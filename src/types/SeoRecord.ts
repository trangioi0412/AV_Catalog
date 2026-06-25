export interface SeoRecord {
  ID: string;
  metaTitle?: string;
  metaDescription?: string;
  shortDescription?: string;
  altText?: string;
  faq?: string;
  [key: string]: any;
}
