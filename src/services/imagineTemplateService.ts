import { launch } from '@cloudflare/playwright';
import { generateTextWithRetry, getAIConfigFromRegistry, type AIConfig } from './aiClient.js';

export const FANQIE_DEFAULT_RANK_URLS = [
  'https://fanqienovel.com/rank',
] as const;

const FANQIE_RANK_DISCOVERY_URL = 'https://fanqienovel.com/rank';
const FANQIE_DEFAULT_SCRAPE_LIMIT = 36;
const FANQIE_MAX_DISCOVERED_SOURCES = 8;
const PLAYWRIGHT_LAUNCH_RETRY_DELAYS_MS = [1_500, 5_000, 12_000] as const;
const FANQIE_PAGE_TIMEOUT_MS = 18_000;
const FANQIE_SCRAPE_DEADLINE_MS = 150_000;
const FANQIE_BOOK_META_TIMEOUT_MS = 12_000;

export interface FanqieHotItem {
  rank: number;
  title: string;
  author?: string;
  summary?: string;
  status?: string;
  readingCountText?: string;
  updatedAtText?: string;
  category?: string;
  url?: string;
  sourceUrl?: string;
}

export interface ImagineTemplate {
  id: string;
  name: string;
  genre: string;
  coreTheme: string;
  oneLineSellingPoint: string;
  keywords: string[];
  protagonistSetup: string;
  hookDesign: string;
  conflictDesign: string;
  growthRoute: string;
  fanqieSignals: string[];
  recommendedOpening: string;
  sourceBooks: string[];
}

export interface ImagineTemplateSnapshot {
  snapshotDate: string;
  source: string;
  sourceUrl: string;
  ranking: FanqieHotItem[];
  templates: ImagineTemplate[];
  modelProvider?: string;
  modelName?: string;
  status: 'ready' | 'error';
  errorMessage?: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface ImagineTemplateSnapshotSummary {
  snapshotDate: string;
  templateCount: number;
  status: 'ready' | 'error';
  createdAt: number;
  updatedAt: number;
}

export interface ImagineTemplateEnv {
  DB: D1Database;
  FANQIE_BROWSER?: Fetcher;
}

interface FanqieRankSource {
  url: string;
  label: string;
  gender: number;
  rankMold: number;
  categoryId: number;
}

function cleanText(input: string | null | undefined): string {
  return (input || '').replace(/\s+/g, ' ').trim();
}

export function toChinaDateKey(epochMs = Date.now()): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date(epochMs));
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractBookIdFromUrl(url?: string): string {
  const raw = cleanText(url);
  if (!raw) return '';
  const match = raw.match(/\/page\/(\d+)/);
  return match?.[1] || '';
}

function looksObfuscatedTitle(title?: string): boolean {
  const text = cleanText(title);
  if (!text) return true;
  return /[\uE000-\uF8FF]/.test(text);
}

function summarizeSourceUrls(hotItems: FanqieHotItem[], fallback?: string[]): string {
  const urls = new Set<string>();

  for (const item of hotItems) {
    const url = cleanText(item.sourceUrl);
    if (url) urls.add(url);
  }

  if (urls.size === 0) {
    for (const url of fallback || []) {
      const normalized = cleanText(url);
      if (normalized) urls.add(normalized);
    }
  }

  if (urls.size === 0) {
    urls.add(FANQIE_RANK_DISCOVERY_URL);
  }

  return [...urls].join('\n');
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function isPlaywrightRateLimitError(error: unknown): boolean {
  const message = String((error as Error)?.message || '').toLowerCase();
  return message.includes('rate limit') || message.includes('code: 429') || message.includes('too many requests');
}

async function launchBrowserWithRetry(browserBinding: Fetcher): Promise<any> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= PLAYWRIGHT_LAUNCH_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await launch(browserBinding);
    } catch (error) {
      lastError = error as Error;
      if (!isPlaywrightRateLimitError(lastError) || attempt === PLAYWRIGHT_LAUNCH_RETRY_DELAYS_MS.length) {
        throw lastError;
      }

      const delay = PLAYWRIGHT_LAUNCH_RETRY_DELAYS_MS[attempt];
      console.warn(
        `[ImagineTemplates] Playwright launch rate-limited, retrying in ${delay}ms (attempt ${attempt + 1}/${PLAYWRIGHT_LAUNCH_RETRY_DELAYS_MS.length + 1})`
      );
      await sleep(delay);
    }
  }

  throw lastError || new Error('Failed to launch Playwright browser');
}

async function discoverRankSources(browser: any): Promise<FanqieRankSource[]> {
  const page = await browser.newPage();
  try {
    await page.goto(FANQIE_RANK_DISCOVERY_URL, {
      waitUntil: 'domcontentloaded',
      timeout: FANQIE_PAGE_TIMEOUT_MS,
    });
    await page.waitForTimeout(900);

    const links = await page.evaluate(() => {
      const normalize = (value: string | null | undefined) => (value || '').replace(/\s+/g, ' ').trim();
      const doc = (globalThis as any).document as any;
      const location = (globalThis as any).location as any;
      const toAbs = (href: string | null | undefined) => {
        if (!href) return '';
        try {
          return new URL(href, location.origin).toString();
        } catch {
          return href;
        }
      };

      const anchors = Array.from(doc.querySelectorAll('.muye-rank-menu a[href^="/rank/"]')) as any[];
      const rows: Array<{ href: string; label: string }> = [];

      for (const anchor of anchors) {
        const href = normalize(anchor.getAttribute?.('href'));
        const label = normalize(anchor.textContent);
        if (!href.startsWith('/rank/')) continue;
        if (!label) continue;
        rows.push({
          href: toAbs(href),
          label,
        });
      }

      return rows;
    });

    const deduped = new Map<string, FanqieRankSource>();
    for (const item of links as Array<{ href: string; label: string }>) {
      const href = cleanText(item.href);
      const match = href.match(/\/rank\/(\d+)_(\d+)_(\d+)/);
      if (!match) continue;

      const gender = Number.parseInt(match[1], 10);
      const rankMold = Number.parseInt(match[2], 10);
      const categoryId = Number.parseInt(match[3], 10);
      if (!Number.isFinite(gender) || !Number.isFinite(rankMold) || !Number.isFinite(categoryId)) continue;

      const key = `${gender}_${rankMold}_${categoryId}`;
      if (!deduped.has(key)) {
        deduped.set(key, {
          url: href,
          label: cleanText(item.label),
          gender,
          rankMold,
          categoryId,
        });
      }
    }

    const all = [...deduped.values()];
    const pickBy = (gender: number, rankMold: number, count: number) =>
      all.filter((item) => item.gender === gender && item.rankMold === rankMold).slice(0, count);

    const selected = [
      ...pickBy(1, 2, 4), // 男频阅读榜
      ...pickBy(0, 2, 4), // 女频阅读榜
      ...pickBy(1, 1, 3), // 男频新书榜
      ...pickBy(0, 1, 3), // 女频新书榜
    ];

    const selectedKeys = new Set(selected.map((item) => `${item.gender}_${item.rankMold}_${item.categoryId}`));
    if (selected.length < FANQIE_MAX_DISCOVERED_SOURCES) {
      for (const source of all) {
        const key = `${source.gender}_${source.rankMold}_${source.categoryId}`;
        if (selectedKeys.has(key)) continue;
        selected.push(source);
        selectedKeys.add(key);
        if (selected.length >= FANQIE_MAX_DISCOVERED_SOURCES) break;
      }
    }

    return selected.slice(0, FANQIE_MAX_DISCOVERED_SOURCES);
  } finally {
    await page.close();
  }
}

async function scrapeOneRankPage(browser: any, source: FanqieRankSource): Promise<FanqieHotItem[]> {
  const page = await browser.newPage();
  try {
    await page.goto(source.url, {
      waitUntil: 'domcontentloaded',
      timeout: FANQIE_PAGE_TIMEOUT_MS,
    });
    await page.waitForTimeout(700);

    const items = await page.evaluate((payload: { sourceUrl: string; categoryLabel: string }) => {
      const normalize = (value: string | null | undefined) => (value || '').replace(/\s+/g, ' ').trim();
      const doc = (globalThis as any).document as any;
      const location = (globalThis as any).location as any;
      const toAbs = (href: string | null | undefined) => {
        if (!href) return '';
        try {
          return new URL(href, location.origin).toString();
        } catch {
          return href;
        }
      };

      const rows: Array<{
        rank: number;
        title: string;
        author?: string;
        summary?: string;
        status?: string;
        readingCountText?: string;
        updatedAtText?: string;
        category?: string;
        url?: string;
        sourceUrl?: string;
      }> = [];

      const cards = Array.from(doc.querySelectorAll('.rank-book-item')) as any[];
      for (let i = 0; i < cards.length; i += 1) {
        const card = cards[i];
        const titleAnchor = card.querySelector?.('.title a');
        const title = normalize(titleAnchor?.textContent || '');
        const rankText = normalize(card.querySelector?.('.book-item-index h1')?.textContent || '');
        const rank = Number.parseInt(rankText.replace(/[^\d]/g, ''), 10);
        const author = normalize(
          card.querySelector?.('.author a span')?.textContent
          || card.querySelector?.('.author span')?.textContent
          || ''
        );
        const summary = normalize(card.querySelector?.('.desc')?.textContent || '').slice(0, 220);
        const status = normalize(card.querySelector?.('.book-item-footer-status')?.textContent || '');
        const readingRaw = normalize(card.querySelector?.('.book-item-count')?.textContent || '');
        const chapterRaw = normalize(card.querySelector?.('.book-item-footer-last .chapter')?.textContent || '');
        const timeRaw = normalize(card.querySelector?.('.book-item-footer-time')?.textContent || '');
        const href = normalize(titleAnchor?.getAttribute?.('href') || '');

        if (!title && !href) continue;

        rows.push({
          rank: Number.isFinite(rank) ? rank : i + 1,
          title,
          author: author || undefined,
          summary: summary || undefined,
          status: status || undefined,
          readingCountText: readingRaw.replace(/^在读[:：]?/, '') || undefined,
          updatedAtText: timeRaw || chapterRaw.replace(/^最近更新[:：]?/, '') || undefined,
          category: payload.categoryLabel || undefined,
          url: toAbs(href),
          sourceUrl: payload.sourceUrl,
        });
      }

      return rows;
    }, {
      sourceUrl: source.url,
      categoryLabel: source.label,
    });

    return items;
  } finally {
    await page.close();
  }
}

async function fetchBookPageMetadata(url: string): Promise<{
  title?: string;
  summary?: string;
  category?: string;
  author?: string;
}> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FANQIE_BOOK_META_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Referer': FANQIE_RANK_DISCOVERY_URL,
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new Error(`Fetch page failed: ${response.status}`);
  }

  const html = await response.text();
  const readFirstMatch = (regexp: RegExp): string => {
    const match = html.match(regexp);
    if (!match) return '';
    return decodeHtmlEntities(cleanText(match[1]));
  };

  const title =
    readFirstMatch(/<div\s+class="info-name"[^>]*>\s*<h1>([^<]+)<\/h1>/i)
    || readFirstMatch(/<title>\s*([^<_|]+?)\s*(?:_[^<]*)?<\/title>/i)
    || '';

  const summary = readFirstMatch(/<meta\s+name="description"\s+content="([^"]+)"/i);
  const author =
    readFirstMatch(/<span\s+class="author-name-text">([^<]+)<\/span>/i)
    || readFirstMatch(/\u4f5c\u8005[:：\s]*([^"，,\s]{1,30})/i);

  const categories: string[] = [];
  const regex = /<span\s+class="info-label-grey">([^<]+)<\/span>/ig;
  let match: RegExpExecArray | null = null;
  while ((match = regex.exec(html))) {
    const value = decodeHtmlEntities(cleanText(match[1]));
    if (value) categories.push(value);
    if (categories.length >= 3) break;
  }

  return {
    title: title || undefined,
    summary: summary || undefined,
    author: author || undefined,
    category: categories.join(' / ') || undefined,
  };
}

async function enrichHotItemsWithBookMetadata(items: FanqieHotItem[]): Promise<void> {
  const candidates = items
    .map((item, index) => ({
      index,
      item,
      bookId: extractBookIdFromUrl(item.url),
    }))
    .filter(({ bookId, item }) =>
      Boolean(bookId) && (looksObfuscatedTitle(item.title) || !cleanText(item.summary))
    )
    .slice(0, 18);

  if (candidates.length === 0) return;

  let cursor = 0;
  const workerCount = Math.max(1, Math.min(4, candidates.length));

  const workers = Array.from({ length: workerCount }, async () => {
    while (cursor < candidates.length) {
      const current = candidates[cursor];
      cursor += 1;

      try {
        const item = current.item;
        const targetUrl = item.url || `https://fanqienovel.com/page/${current.bookId}`;
        const metadata = await fetchBookPageMetadata(targetUrl);

        if (metadata.title && (looksObfuscatedTitle(item.title) || !cleanText(item.title))) {
          item.title = metadata.title;
        }
        if (metadata.summary && !cleanText(item.summary)) {
          item.summary = metadata.summary.slice(0, 220);
        }
        if (metadata.author && !cleanText(item.author)) {
          item.author = metadata.author;
        }
        if (metadata.category && !cleanText(item.category)) {
          item.category = metadata.category;
        }
      } catch (error) {
        console.warn(`[ImagineTemplates] enrich book metadata failed for ${current.bookId}:`, (error as Error).message);
      }
    }
  });

  await Promise.all(workers);
}

export async function scrapeFanqieHotListWithPlaywright(
  env: ImagineTemplateEnv,
  options?: { sourceUrls?: string[]; limit?: number }
): Promise<FanqieHotItem[]> {
  if (!env.FANQIE_BROWSER) {
    throw new Error('Missing FANQIE_BROWSER binding for Playwright scraping');
  }

  const requestedSourceUrls = (options?.sourceUrls || []).map((entry) => cleanText(entry)).filter(Boolean);
  const limit = Math.max(1, Math.min(100, options?.limit ?? FANQIE_DEFAULT_SCRAPE_LIMIT));
  const browser = await launchBrowserWithRetry(env.FANQIE_BROWSER);

  try {
    let sources: FanqieRankSource[] = [];
    if (requestedSourceUrls.length > 0) {
      sources = requestedSourceUrls.map((url) => {
        const match = url.match(/\/rank\/(\d+)_(\d+)_(\d+)/);
        const gender = match ? Number.parseInt(match[1], 10) : -1;
        const rankMold = match ? Number.parseInt(match[2], 10) : -1;
        const categoryId = match ? Number.parseInt(match[3], 10) : -1;
        return {
          url,
          label: `分类榜单 ${categoryId > 0 ? categoryId : ''}`.trim(),
          gender,
          rankMold,
          categoryId,
        };
      });
    } else {
      sources = await discoverRankSources(browser as any);
    }

    if (sources.length === 0) {
      throw new Error('No valid fanqie rank source discovered');
    }

    const allItems: FanqieHotItem[] = [];

    for (const source of sources) {
      try {
        const pageItems = await scrapeOneRankPage(browser as any, source);
        allItems.push(...pageItems);
      } catch (error) {
        console.warn(`[ImagineTemplates] scrape failed for ${source.url}:`, (error as Error).message);
      }
    }

    await enrichHotItemsWithBookMetadata(allItems);

    const deduped = new Map<string, FanqieHotItem>();
    for (const item of allItems) {
      const key = extractBookIdFromUrl(item.url) || cleanText(item.title).toLowerCase();
      if (!key) continue;
      const existing = deduped.get(key);
      if (!existing || item.rank < existing.rank) {
        deduped.set(key, item);
      }
    }

    const sorted = [...deduped.values()].sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return (a.title || '').localeCompare(b.title || '');
    });

    if (sorted.length === 0) {
      throw new Error('Fanqie rank scraping returned zero entries');
    }

    return sorted
      .slice(0, limit)
      .map((item) => ({
        ...item,
        title: cleanText(item.title) || '热榜作品',
        sourceUrl: cleanText(item.sourceUrl) || FANQIE_RANK_DISCOVERY_URL,
      }));
  } finally {
    await browser.close();
  }
}

async function getLatestSnapshotWithRanking(db: D1Database, limit = 10): Promise<ImagineTemplateSnapshot | null> {
  const rows = await db.prepare(`
    SELECT *
    FROM ai_imagine_template_snapshots
    ORDER BY snapshot_date DESC
    LIMIT ?
  `).bind(Math.max(1, Math.min(60, limit))).all();

  for (const row of (rows.results || []) as any[]) {
    const snapshot = parseSnapshotRow(row);
    if (snapshot && Array.isArray(snapshot.ranking) && snapshot.ranking.length > 0) {
      return snapshot;
    }
  }

  return null;
}

function extractFirstJsonObject(raw: string): string | null {
  const text = raw.trim();
  let start = text.indexOf('{');

  while (start >= 0) {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < text.length; i += 1) {
      const ch = text[i];

      if (escaped) {
        escaped = false;
        continue;
      }

      if (inString && ch === '\\') {
        escaped = true;
        continue;
      }

      if (ch === '"') {
        inString = !inString;
        continue;
      }

      if (inString) continue;

      if (ch === '{') depth += 1;
      if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          return text.slice(start, i + 1);
        }
      }
    }

    start = text.indexOf('{', start + 1);
  }

  return null;
}

function normalizeStringArray(value: unknown, max = 8): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => cleanText(String(entry)))
      .filter(Boolean)
      .slice(0, max);
  }

  if (typeof value === 'string') {
    return value
      .split(/[、,，;；|]/)
      .map((entry) => cleanText(entry))
      .filter(Boolean)
      .slice(0, max);
  }

  return [];
}

function buildTemplateId(snapshotDate: string, index: number, name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug
    ? `tpl-${snapshotDate}-${index + 1}-${slug.slice(0, 24)}`
    : `tpl-${snapshotDate}-${index + 1}`;
}

function sanitizeTemplate(raw: any, index: number, snapshotDate: string): ImagineTemplate {
  const name = cleanText(raw?.name || raw?.title || `热点模板 ${index + 1}`);
  const genre = cleanText(raw?.genre || raw?.type || '热点融合');
  const coreTheme = cleanText(raw?.coreTheme || raw?.theme || '逆袭与成长');
  const oneLineSellingPoint = cleanText(raw?.oneLineSellingPoint || raw?.sellingPoint || '高反差冲突 + 高密度爽点');
  const protagonistSetup = cleanText(raw?.protagonistSetup || raw?.protagonist || '主角具备清晰目标与强执行力');
  const hookDesign = cleanText(raw?.hookDesign || raw?.hook || '开篇用危机事件+身份反差制造强钩子');
  const conflictDesign = cleanText(raw?.conflictDesign || raw?.conflict || '每 3-5 章触发一次明显冲突升级');
  const growthRoute = cleanText(raw?.growthRoute || raw?.growth || '小胜-受挫-反杀-跨阶成长');
  const recommendedOpening = cleanText(raw?.recommendedOpening || raw?.opening || '第一章直入主冲突，80字内给出悬念与代价');

  const keywords = normalizeStringArray(raw?.keywords, 10);
  const fanqieSignals = normalizeStringArray(raw?.fanqieSignals || raw?.platformSignals, 10);
  const sourceBooks = normalizeStringArray(raw?.sourceBooks || raw?.references || raw?.hotBooks, 5);

  return {
    id: cleanText(raw?.id) || buildTemplateId(snapshotDate, index, name),
    name,
    genre,
    coreTheme,
    oneLineSellingPoint,
    keywords,
    protagonistSetup,
    hookDesign,
    conflictDesign,
    growthRoute,
    fanqieSignals,
    recommendedOpening,
    sourceBooks,
  };
}

function fallbackTemplatesFromHotList(hotItems: FanqieHotItem[], snapshotDate: string): ImagineTemplate[] {
  const topItems = hotItems.slice(0, 12);

  return topItems.map((item, index) => {
    const seed = cleanText(item.title) || `热点题材 ${index + 1}`;
    const genre = cleanText(item.category?.split('·').pop()) || '热点融合';

    return {
      id: buildTemplateId(snapshotDate, index, seed),
      name: `${seed} 同款强钩子模板`,
      genre,
      coreTheme: '强目标驱动下的逆袭与博弈',
      oneLineSellingPoint: '高压开局 + 快节奏升级 + 连续反转',
      keywords: ['打脸', '反转', '升级', '悬念'],
      protagonistSetup: '主角带着明确执念与资源短板切入，先弱后强',
      hookDesign: '第一章抛出不可逆代价事件，迫使主角立即行动',
      conflictDesign: '外部压迫和内部短板双线并进，每卷末爆点收束',
      growthRoute: '生存破局 -> 小范围掌控 -> 跨层博弈 -> 终局对决',
      fanqieSignals: ['高频爽点', '章节末悬念', '冲突密度高', '情绪回报快'],
      recommendedOpening: `开篇 100 字内呈现「${seed}」同款危机现场与主角抉择。`,
      sourceBooks: [seed],
    };
  });
}

export async function extractImagineTemplatesFromHotList(params: {
  aiConfig: AIConfig;
  hotItems: FanqieHotItem[];
  snapshotDate: string;
  maxTemplates?: number;
}): Promise<ImagineTemplate[]> {
  const { aiConfig, hotItems, snapshotDate } = params;
  const maxTemplates = Math.max(6, Math.min(30, params.maxTemplates ?? 16));

  const shortlist = hotItems.slice(0, Math.max(20, maxTemplates));
  const hotListText = shortlist
    .map((item) => {
      const parts = [
        `#${item.rank}`,
        item.title,
        item.author ? `作者:${item.author}` : '',
        item.category ? `分类:${item.category}` : '',
        item.summary ? `简介:${item.summary}` : '',
      ].filter(Boolean);
      return `- ${parts.join(' | ')}`;
    })
    .join('\n');

  const system = `你是顶级网文策划编辑，擅长把热点榜单抽象成可复用的创作模板。\n请严格输出 JSON，不要输出 Markdown，不要输出解释。`;
  const prompt = `请基于以下番茄小说热榜内容，生成 ${maxTemplates} 个“AI 自动想象模板”。\n\n要求：\n1) 模板必须覆盖多类型，不要都一样。\n2) 每个模板都要可直接用于生成 Story Bible。\n3) 强调“开篇钩子、冲突升级、爽点兑现、成长路线”。\n4) 不要照抄榜单情节，要抽象成可复用套路。\n\n榜单数据：\n${hotListText}\n\n返回 JSON 结构：\n{\n  "templates": [\n    {\n      "name": "模板名",\n      "genre": "类型",\n      "coreTheme": "核心主题",\n      "oneLineSellingPoint": "一句话卖点",\n      "keywords": ["关键词1", "关键词2"],\n      "protagonistSetup": "主角设定",\n      "hookDesign": "开篇钩子",\n      "conflictDesign": "冲突设计",\n      "growthRoute": "成长路线",\n      "fanqieSignals": ["平台信号1", "平台信号2"],\n      "recommendedOpening": "开篇建议",\n      "sourceBooks": ["来自哪些热门书名"]\n    }\n  ]\n}`;

  let raw = '';
  try {
    raw = await generateTextWithRetry(aiConfig, {
      system,
      prompt,
      temperature: 0.65,
      maxTokens: 3200,
    }, 4);
  } catch (error) {
    console.warn('[ImagineTemplates] model generation failed, using fallback templates:', (error as Error).message);
    return fallbackTemplatesFromHotList(shortlist, snapshotDate).slice(0, maxTemplates);
  }

  const jsonCandidate = extractFirstJsonObject(raw) || raw;
  let parsed: any;

  try {
    parsed = JSON.parse(jsonCandidate);
  } catch (error) {
    console.warn('[ImagineTemplates] template JSON parse failed, using fallback templates:', (error as Error).message);
    return fallbackTemplatesFromHotList(shortlist, snapshotDate).slice(0, maxTemplates);
  }

  const templatesRaw = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.templates)
      ? parsed.templates
      : [];

  const templates = templatesRaw
    .slice(0, maxTemplates)
    .map((item: any, index: number) => sanitizeTemplate(item, index, snapshotDate));

  if (templates.length === 0) {
    return fallbackTemplatesFromHotList(shortlist, snapshotDate).slice(0, maxTemplates);
  }

  return templates;
}

export async function upsertImagineTemplateSnapshot(
  db: D1Database,
  snapshot: ImagineTemplateSnapshot
): Promise<void> {
  const now = Date.now();
  await db.prepare(`
    INSERT INTO ai_imagine_template_snapshots (
      snapshot_date,
      source,
      source_url,
      ranking_json,
      templates_json,
      model_provider,
      model_name,
      status,
      error_message,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(snapshot_date) DO UPDATE SET
      source = excluded.source,
      source_url = excluded.source_url,
      ranking_json = excluded.ranking_json,
      templates_json = excluded.templates_json,
      model_provider = excluded.model_provider,
      model_name = excluded.model_name,
      status = excluded.status,
      error_message = excluded.error_message,
      updated_at = excluded.updated_at
  `).bind(
    snapshot.snapshotDate,
    snapshot.source,
    snapshot.sourceUrl,
    JSON.stringify(snapshot.ranking),
    JSON.stringify(snapshot.templates),
    snapshot.modelProvider || null,
    snapshot.modelName || null,
    snapshot.status,
    snapshot.errorMessage || null,
    now,
    now
  ).run();
}

function parseSnapshotRow(row: any): ImagineTemplateSnapshot | null {
  if (!row) return null;

  try {
    const ranking = JSON.parse(row.ranking_json || '[]') as FanqieHotItem[];
    const templates = JSON.parse(row.templates_json || '[]') as ImagineTemplate[];

    return {
      snapshotDate: String(row.snapshot_date),
      source: String(row.source || 'fanqie_rank'),
      sourceUrl: String(row.source_url || FANQIE_DEFAULT_RANK_URLS[0]),
      ranking,
      templates,
      modelProvider: row.model_provider || undefined,
      modelName: row.model_name || undefined,
      status: row.status === 'error' ? 'error' : 'ready',
      errorMessage: row.error_message || undefined,
      createdAt: Number(row.created_at || 0),
      updatedAt: Number(row.updated_at || 0),
    };
  } catch (error) {
    console.warn('[ImagineTemplates] parse snapshot row failed:', (error as Error).message);
    return null;
  }
}

export async function getImagineTemplateSnapshot(
  db: D1Database,
  snapshotDate?: string
): Promise<ImagineTemplateSnapshot | null> {
  let row: any = null;

  if (snapshotDate) {
    row = await db.prepare(`
      SELECT *
      FROM ai_imagine_template_snapshots
      WHERE snapshot_date = ?
      LIMIT 1
    `).bind(snapshotDate).first();
  } else {
    row = await db.prepare(`
      SELECT *
      FROM ai_imagine_template_snapshots
      WHERE status = 'ready'
      ORDER BY snapshot_date DESC
      LIMIT 1
    `).first();
  }

  return parseSnapshotRow(row);
}

export async function listImagineTemplateSnapshotDates(
  db: D1Database,
  limit = 30
): Promise<ImagineTemplateSnapshotSummary[]> {
  const rows = await db.prepare(`
    SELECT snapshot_date, status, templates_json, created_at, updated_at
    FROM ai_imagine_template_snapshots
    ORDER BY snapshot_date DESC
    LIMIT ?
  `).bind(Math.max(1, Math.min(365, limit))).all();

  return ((rows.results || []) as any[]).map((row) => {
    let templateCount = 0;
    try {
      const parsed = JSON.parse(row.templates_json || '[]');
      templateCount = Array.isArray(parsed) ? parsed.length : 0;
    } catch {
      templateCount = 0;
    }

    return {
      snapshotDate: String(row.snapshot_date),
      templateCount,
      status: row.status === 'error' ? 'error' : 'ready',
      createdAt: Number(row.created_at || 0),
      updatedAt: Number(row.updated_at || 0),
    };
  });
}

export async function resolveImagineTemplateById(
  db: D1Database,
  templateId: string,
  snapshotDate?: string
): Promise<{ template: ImagineTemplate; snapshotDate: string } | null> {
  const targetId = cleanText(templateId);
  if (!targetId) return null;

  const snapshots: ImagineTemplateSnapshot[] = [];

  if (snapshotDate) {
    const snapshot = await getImagineTemplateSnapshot(db, snapshotDate);
    if (snapshot) snapshots.push(snapshot);
  } else {
    const rows = await db.prepare(`
      SELECT *
      FROM ai_imagine_template_snapshots
      WHERE status = 'ready'
      ORDER BY snapshot_date DESC
      LIMIT 10
    `).all();

    for (const row of (rows.results || []) as any[]) {
      const snapshot = parseSnapshotRow(row);
      if (snapshot) snapshots.push(snapshot);
    }
  }

  for (const snapshot of snapshots) {
    const found = snapshot.templates.find((item) => item.id === targetId);
    if (found) {
      return {
        template: found,
        snapshotDate: snapshot.snapshotDate,
      };
    }
  }

  return null;
}

export async function refreshImagineTemplatesForDate(
  env: ImagineTemplateEnv,
  options?: {
    snapshotDate?: string;
    force?: boolean;
    maxTemplates?: number;
    sourceUrls?: string[];
  }
): Promise<{
  snapshotDate: string;
  templateCount: number;
  hotCount: number;
  skipped: boolean;
  status: 'ready' | 'error';
  errorMessage?: string;
}> {
  const snapshotDate = options?.snapshotDate || toChinaDateKey();
  const force = Boolean(options?.force);
  const existingSnapshot = await getImagineTemplateSnapshot(env.DB, snapshotDate);

  if (!force) {
    if (existingSnapshot && existingSnapshot.status === 'ready' && existingSnapshot.templates.length > 0) {
      return {
        snapshotDate,
        templateCount: existingSnapshot.templates.length,
        hotCount: existingSnapshot.ranking.length,
        skipped: true,
        status: 'ready',
      };
    }
  }

  let hotItems: FanqieHotItem[] = [];

  try {
    try {
      hotItems = await withTimeout(
        scrapeFanqieHotListWithPlaywright(env, {
          sourceUrls: options?.sourceUrls,
          limit: 36,
        }),
        FANQIE_SCRAPE_DEADLINE_MS,
        `Fanqie scraping timeout after ${FANQIE_SCRAPE_DEADLINE_MS}ms`
      );
    } catch (scrapeError) {
      const fallbackSnapshot = (existingSnapshot && existingSnapshot.ranking.length > 0)
        ? existingSnapshot
        : await getLatestSnapshotWithRanking(env.DB, 12);

      if (fallbackSnapshot && fallbackSnapshot.ranking.length > 0) {
        hotItems = fallbackSnapshot.ranking
          .slice(0, 36)
          .map((item) => ({
            ...item,
            sourceUrl: cleanText(item.sourceUrl) || FANQIE_RANK_DISCOVERY_URL,
          }));
        console.warn(
          '[ImagineTemplates] scrape failed, using cached ranking snapshot:',
          (scrapeError as Error).message
        );
      } else {
        throw scrapeError;
      }
    }

    const aiConfig =
      await getAIConfigFromRegistry(env.DB, 'generate_outline') ||
      await getAIConfigFromRegistry(env.DB, 'generate_chapter');

    if (!aiConfig) {
      throw new Error('No AI model configured for imagine template extraction');
    }

    const templates = await extractImagineTemplatesFromHotList({
      aiConfig,
      hotItems,
      snapshotDate,
      maxTemplates: options?.maxTemplates,
    });

    await upsertImagineTemplateSnapshot(env.DB, {
      snapshotDate,
      source: 'fanqie_rank',
      sourceUrl: summarizeSourceUrls(hotItems, options?.sourceUrls || [...FANQIE_DEFAULT_RANK_URLS]),
      ranking: hotItems,
      templates,
      modelProvider: aiConfig.provider,
      modelName: aiConfig.model,
      status: 'ready',
    });

    return {
      snapshotDate,
      templateCount: templates.length,
      hotCount: hotItems.length,
      skipped: false,
      status: 'ready',
    };
  } catch (error) {
    const message = (error as Error).message;

    await upsertImagineTemplateSnapshot(env.DB, {
      snapshotDate,
      source: 'fanqie_rank',
      sourceUrl: summarizeSourceUrls(hotItems, options?.sourceUrls || [...FANQIE_DEFAULT_RANK_URLS]),
      ranking: hotItems,
      templates: [],
      status: 'error',
      errorMessage: message,
    });

    return {
      snapshotDate,
      templateCount: 0,
      hotCount: hotItems.length,
      skipped: false,
      status: 'error',
      errorMessage: message,
    };
  }
}
