import type { Category } from "../../lib/content/types.js";
import type { SearchReason } from "../../lib/search/types.js";

export const PENGUIN_QUERY = "企鹅饼干礼盒结构板，带尺寸和材料说明";

export type DiscoveryMode = "search" | "browse";

export interface DiscoveryImage {
  src: string;
  srcSet: string;
  sizes: string;
  width: number;
  height: number;
  alt: string;
}

export interface DiscoveryCard {
  caseId: string;
  title: string;
  categoryId: string;
  categoryName: string;
  href: string;
  layout: string;
  layoutLabel: string;
  inputMode: string;
  intents: string[];
  textSlots: string[];
  reasons: SearchReason[];
  reasonHeading: "为什么命中" | "结构特征";
  challenge: string;
  transferableRule: string;
  image: DiscoveryImage;
}

export interface DiscoveryFilterOption {
  value: string;
  label: string;
}

export interface DiscoveryFilterOptions {
  intents: DiscoveryFilterOption[];
  layouts: DiscoveryFilterOption[];
  inputs: DiscoveryFilterOption[];
  slots: DiscoveryFilterOption[];
}

export interface CategoryIntentLink {
  label: string;
  intentId: string;
}

export interface DiscoveryData {
  categories: Category[];
  categoryCounts: Record<string, number>;
  cards: Record<string, DiscoveryCard>;
  penguinCards: DiscoveryCard[];
}

export interface DiscoveryPayload {
  mode: DiscoveryMode;
  categoryId: string | null;
  initialQuery: string;
  cards: Record<string, DiscoveryCard>;
}
