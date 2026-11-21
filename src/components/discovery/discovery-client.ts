import { searchStaticIndex } from "../../lib/search/index.js";
import type { SearchResult } from "../../lib/search/types.js";
import type { DiscoveryCard, DiscoveryPayload } from "./discovery-types.js";

const filterNames = ["intent", "layout", "input", "slot"] as const;
type FilterName = typeof filterNames[number];

type FilterState = Record<FilterName, string>;

function element<T extends Element>(root: ParentNode, selector: string): T {
  const match = root.querySelector<T>(selector);
  if (!match) throw new Error(`发现组件缺少 ${selector}`);
  return match;
}

function readPayload(root: HTMLElement): DiscoveryPayload {
  const source = element<HTMLScriptElement>(root, "[data-discovery-data]").textContent;
  if (!source) throw new Error("发现组件缺少静态数据");
  return JSON.parse(source) as DiscoveryPayload;
}

function compareCaseIds(left: DiscoveryCard, right: DiscoveryCard): number {
  return left.caseId.localeCompare(right.caseId, "en", { numeric: true });
}

function searchCard(card: DiscoveryCard, result: SearchResult): DiscoveryCard {
  return { ...card, reasons: result.reasons, reasonHeading: "为什么命中" };
}

function hydrateCard(template: HTMLTemplateElement, card: DiscoveryCard, position: number): DocumentFragment {
  const fragment = template.content.cloneNode(true) as DocumentFragment;
  const article = element<HTMLElement>(fragment, ".discovery-card");
  article.dataset.caseId = card.caseId;
  const setText = (selector: string, value: string) => {
    element<HTMLElement>(fragment, selector).textContent = value;
  };
  const setHref = (selector: string) => {
    element<HTMLAnchorElement>(fragment, selector).href = card.href;
  };
  setHref('[data-field="image-link"]');
  element<HTMLAnchorElement>(fragment, '[data-field="image-link"]').setAttribute("aria-label", `打开${card.title}案例`);
  setHref('[data-field="title-link"]');
  setHref('[data-field="case-link"]');
  setText('[data-field="title-link"]', card.title);
  setText('[data-field="category"]', card.categoryName);
  setText('[data-field="layout"]', card.layoutLabel);
  setText('[data-field="case-id"]', `#${card.caseId.replace("case-", "")}`);
  setText('[data-field="position"]', String(position).padStart(2, "0"));
  setText('[data-field="reason-heading"]', card.reasonHeading);
  element<HTMLElement>(fragment, ".discovery-card__reason").setAttribute("aria-label", card.reasonHeading);
  setText('[data-field="challenge"]', card.challenge);
  setText('[data-field="rule"]', card.transferableRule);
  const image = element<HTMLImageElement>(fragment, '[data-field="image"]');
  image.src = card.image.src;
  image.srcset = card.image.srcSet;
  image.sizes = card.image.sizes;
  image.width = card.image.width;
  image.height = card.image.height;
  image.alt = card.image.alt;
  image.loading = position === 1 ? "eager" : "lazy";
  const reasons = element<HTMLUListElement>(fragment, '[data-field="reasons"]');
  const reasonNodes = card.reasons.map((reason) => {
    const item = document.createElement("li");
    item.dataset.reasonKind = reason.kind;
    item.textContent = reason.text;
    return item;
  });
  reasons.replaceChildren(...reasonNodes);
  return fragment;
}

function initialize(root: HTMLElement): void {
  if (root.dataset.ready === "true") return;
  root.dataset.ready = "true";
  const payload = readPayload(root);
  const form = element<HTMLFormElement>(root, "[data-discovery-form]");
  const queryInput = element<HTMLInputElement>(root, "[data-discovery-query]");
  const results = element<HTMLElement>(root, "[data-discovery-results]");
  const status = element<HTMLElement>(root, "[data-discovery-status]");
  const empty = element<HTMLElement>(root, "[data-discovery-empty]");
  const more = element<HTMLButtonElement>(root, "[data-discovery-more]");
  const template = element<HTMLTemplateElement>(root, "[data-discovery-card-template]");
  const filterCount = element<HTMLElement>(root, "[data-filter-count]");
  const summary = element<HTMLElement>(root, "[data-discovery-summary]");
  const selects = Object.fromEntries(filterNames.map((name) => [
    name,
    element<HTMLSelectElement>(root, `[data-discovery-filter="${name}"]`)
  ])) as Record<FilterName, HTMLSelectElement>;
  let visibleCount = 5;

  function filters(): FilterState {
    return Object.fromEntries(filterNames.map((name) => [name, selects[name].value])) as FilterState;
  }

  function matchesFilters(card: DiscoveryCard, state: FilterState): boolean {
    if (state.intent && !card.intents.includes(state.intent)) return false;
    if (state.layout && card.layout !== state.layout) return false;
    if (state.input && card.inputMode !== state.input) return false;
    if (state.slot && !card.textSlots.includes(state.slot)) return false;
    return true;
  }

  function candidates(query: string, state: FilterState): DiscoveryCard[] {
    let cards: DiscoveryCard[];
    if (query.trim()) {
      cards = searchStaticIndex(query, { limit: 50 })
        .filter((result) => !payload.categoryId || result.category_id === payload.categoryId)
        .map((result) => {
          const card = payload.cards[result.case_id];
          if (!card) throw new Error(`结果 ${result.case_id} 没有对应卡片数据`);
          return searchCard(card, result);
        });
    } else if (payload.mode === "browse") {
      cards = Object.values(payload.cards).sort(compareCaseIds);
    } else {
      cards = [];
    }
    return cards.filter((card) => matchesFilters(card, state));
  }

  function syncUrl(query: string, state: FilterState): void {
    const url = new URL(window.location.href);
    if (query.trim()) url.searchParams.set("q", query);
    else url.searchParams.delete("q");
    for (const name of filterNames) {
      if (state[name]) url.searchParams.set(name, state[name]);
      else url.searchParams.delete(name);
    }
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function render(scrollToResults = false, syncHistory = true): void {
    const query = queryInput.value;
    const state = filters();
    const matching = candidates(query, state);
    const searching = query.trim().length > 0 || payload.mode === "search";
    const limit = searching ? 5 : visibleCount;
    const visible = matching.slice(0, limit);
    const fragments = visible.map((card, index) => hydrateCard(template, card, index + 1));
    results.replaceChildren(...fragments);
    results.hidden = visible.length === 0;
    empty.hidden = visible.length !== 0;
    more.hidden = searching || visible.length >= matching.length || visible.length === 0;
    const activeFilters = filterNames.filter((name) => state[name]).length;
    filterCount.hidden = activeFilters === 0;
    filterCount.textContent = activeFilters ? `${activeFilters} 项` : "";
    if (!query.trim() && payload.mode === "search") {
      status.textContent = "先描述一个画面任务，再查看结构依据。";
    } else if (searching) {
      status.textContent = visible.length > 0
        ? `${visible.length} 张卡，依次比较结构、意图和文本${activeFilters ? `，已套用 ${activeFilters} 项筛选` : ""}。`
        : "没有符合当前条件的结果。";
    } else {
      status.textContent = `共 ${matching.length} 个，当前显示 ${visible.length} 个。`;
    }
    if (syncHistory) syncUrl(query, state);
    if (scrollToResults) summary.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function reset(): void {
    queryInput.value = payload.mode === "search" ? "" : queryInput.value;
    for (const name of filterNames) selects[name].value = "";
    visibleCount = 5;
    render();
  }

  function readUrl(): void {
    const url = new URL(window.location.href);
    queryInput.value = url.searchParams.get("q") ?? payload.initialQuery;
    for (const name of filterNames) selects[name].value = url.searchParams.get(name) ?? "";
    visibleCount = 5;
    render(false, false);
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    visibleCount = 5;
    render(true);
  });
  for (const name of filterNames) {
    selects[name].addEventListener("change", () => {
      visibleCount = 5;
      render();
    });
  }
  root.querySelectorAll<HTMLButtonElement>("[data-quick-intent]").forEach((button) => {
    button.addEventListener("click", () => {
      selects.intent.value = button.dataset.quickIntent ?? "";
      visibleCount = 5;
      render();
    });
  });
  root.querySelectorAll<HTMLButtonElement>("[data-discovery-reset], [data-discovery-empty-reset]").forEach((button) => {
    button.addEventListener("click", reset);
  });
  root.querySelectorAll<HTMLButtonElement>("[data-discovery-example]").forEach((button) => {
    button.addEventListener("click", () => {
      queryInput.value = button.dataset.query ?? "";
      visibleCount = 5;
      render(true);
    });
  });
  more.addEventListener("click", () => {
    visibleCount += 5;
    render();
  });
  window.addEventListener("popstate", readUrl);
  readUrl();
}

export function initializeDiscovery(): void {
  document.querySelectorAll<HTMLElement>("[data-discovery]").forEach(initialize);
}
