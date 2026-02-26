import { launch } from '@cloudflare/playwright';
import { generateTextWithRetry, getAIConfigFromRegistry, type AIConfig } from './aiClient.js';
import { parse as parsePartialJson } from 'partial-json';

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
const TEMPLATE_NAME_STYLES = [
  '强钩子开局',
  '冲突升级',
  '反转推进',
  '成长逆袭',
  '多线博弈',
  '情绪兑现',
  '悬念驱动',
  '节奏拉满',
] as const;

const GROWTH_ROUTE_VARIANTS = [
  '困局求生 -> 小胜立威 -> 关键失利 -> 极限反杀 -> 终局翻盘',
  '弱势潜伏 -> 资源积累 -> 阶层突破 -> 多线博弈 -> 目标兑现',
  '被动入局 -> 连续破局 -> 同盟扩张 -> 规则改写 -> 新秩序建立',
  '代价开局 -> 局部控场 -> 高层对抗 -> 信念重塑 -> 终章收束',
] as const;

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

function cleanCopyText(input: string | null | undefined): string {
  const text = cleanText(input);
  if (!text) return '';

  return text
    .replace(/[\uE000-\uF8FF]/gu, '')
    .replace(/[\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/gu, '')
    .replace(/[□■◻◼▢▣▤▥▦▧▨▩]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function clipText(value: string, max = 20): string {
  return value.length > max ? value.slice(0, max) : value;
}

function normalizeGenreLabel(raw: string | null | undefined): string {
  const cleaned = cleanCopyText(raw)
    .replace(/[|/\\]+/g, '·')
    .replace(/[\s·]{2,}/g, '·')
    .replace(/^[·\s]+|[·\s]+$/g, '');
  if (!cleaned) return '综合题材';
  return clipText(cleaned, 10);
}

function buildReadableTemplateName(index: number, genre: string): string {
  const style = TEMPLATE_NAME_STYLES[index % TEMPLATE_NAME_STYLES.length];
  const serial = String(index + 1).padStart(2, '0');
  return `${normalizeGenreLabel(genre)}·${style} 模板${serial}`;
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
  if (/[\uE000-\uF8FF]/.test(text)) return true;
  const normalized = cleanCopyText(text);
  if (!normalized) return true;
  return normalized.length < Math.max(2, Math.floor(text.length * 0.6));
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
      .map((item, index) => {
        const title = cleanCopyText(item.title) || `热榜作品 ${index + 1}`;
        return {
          ...item,
          title,
          author: cleanCopyText(item.author) || undefined,
          summary: clipText(cleanCopyText(item.summary), 220) || undefined,
          status: cleanCopyText(item.status) || undefined,
          readingCountText: cleanCopyText(item.readingCountText) || undefined,
          updatedAtText: cleanCopyText(item.updatedAtText) || undefined,
          category: cleanCopyText(item.category) || undefined,
          url: cleanText(item.url) || undefined,
          sourceUrl: cleanText(item.sourceUrl) || FANQIE_RANK_DISCOVERY_URL,
        };
      });
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

function extractFirstJsonSegment(raw: string, opener: '{' | '[', closer: '}' | ']'): string | null {
  const text = raw.trim();
  let start = text.indexOf(opener);

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

      if (ch === opener) depth += 1;
      if (ch === closer) {
        depth -= 1;
        if (depth === 0) {
          return text.slice(start, i + 1);
        }
      }
    }

    start = text.indexOf(opener, start + 1);
  }

  return null;
}

function extractFirstJsonObject(raw: string): string | null {
  return extractFirstJsonSegment(raw, '{', '}');
}

function extractFirstJsonArray(raw: string): string | null {
  return extractFirstJsonSegment(raw, '[', ']');
}

function normalizeTemplatePayload(parsed: unknown): any[] {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') {
    const holder = parsed as any;
    if (Array.isArray(holder.templates)) return holder.templates;
    if (Array.isArray(holder.data)) return holder.data;
  }
  return [];
}

function parseTemplatePayload(raw: string): any[] {
  const text = raw.trim();
  if (!text) return [];

  const candidates = [extractFirstJsonObject(text), extractFirstJsonArray(text), text]
    .filter(Boolean) as string[];
  const deduped = [...new Set(candidates)];

  for (const candidate of deduped) {
    try {
      const parsed = JSON.parse(candidate);
      const templates = normalizeTemplatePayload(parsed);
      if (templates.length > 0) return templates;
    } catch {
      // try next candidate
    }
  }

  for (const candidate of deduped) {
    if (!candidate.includes('{') && !candidate.includes('[')) continue;
    try {
      const parsed = parsePartialJson(candidate);
      const templates = normalizeTemplatePayload(parsed);
      if (templates.length > 0) return templates;
    } catch {
      // ignore partial parse failures
    }
  }

  return [];
}

function normalizeStringArray(value: unknown, max = 8): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => cleanCopyText(String(entry)))
      .filter(Boolean)
      .slice(0, max);
  }

  if (typeof value === 'string') {
    return value
      .split(/[、,，;；|]/)
      .map((entry) => cleanCopyText(entry))
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

function pickFirstClause(text: string, max = 40): string {
  const cleaned = cleanCopyText(text);
  if (!cleaned) return '';
  const first = cleaned.split(/[。！？!?\n]/)[0] || cleaned;
  return clipText(first, max);
}

function deriveKeywordsFromHotItem(item: FanqieHotItem, genre: string): string[] {
  const text = `${cleanCopyText(item.title)} ${cleanCopyText(item.category)} ${cleanCopyText(item.summary)}`;
  const keywords: string[] = [];
  const push = (value: string) => {
    const normalized = cleanCopyText(value);
    if (!normalized) return;
    if (!keywords.includes(normalized)) keywords.push(normalized);
  };

  const rules: Array<{ pattern: RegExp; keyword: string }> = [
    { pattern: /末世|丧尸|废土|灾变|冰河|天灾|求生/, keyword: '末世求生' },
    { pattern: /修仙|仙侠|宗门|灵气|飞升|剑道/, keyword: '修炼升级' },
    { pattern: /都市|商战|职场|豪门|神豪/, keyword: '都市逆袭' },
    { pattern: /科幻|机甲|星际|赛博|科技/, keyword: '科技冲突' },
    { pattern: /游戏|副本|网游|规则怪谈|闯关/, keyword: '规则闯关' },
    { pattern: /悬疑|推理|谜案|诡异|反转/, keyword: '悬念反转' },
    { pattern: /恋爱|婚姻|情感|追妻|甜宠|虐恋/, keyword: '情感拉扯' },
    { pattern: /朝堂|权谋|宫斗|世家|夺嫡/, keyword: '权谋博弈' },
    { pattern: /重生|穿越|系统|签到|金手指/, keyword: '金手指破局' },
    { pattern: /复仇|打脸|逆袭|翻身/, keyword: '逆袭打脸' },
  ];

  for (const rule of rules) {
    if (rule.pattern.test(text)) push(rule.keyword);
  }

  push(genre);
  const categoryTokens = cleanCopyText(item.category)
    .split(/[·/|]/)
    .map((entry) => cleanCopyText(entry))
    .filter(Boolean);
  for (const token of categoryTokens) {
    push(clipText(token, 10));
  }

  if (keywords.length === 0) {
    ['高压开局', '冲突升级', '反转兑现', '成长逆袭'].forEach(push);
  }

  return keywords.slice(0, 8);
}

function buildSeedTemplateFromHotItem(
  item: FanqieHotItem,
  index: number,
  snapshotDate: string
): ImagineTemplate {
  const categoryTokens = cleanCopyText(item.category)
    .split(/[·/|]/)
    .map((entry) => cleanCopyText(entry))
    .filter(Boolean);
  const genre = normalizeGenreLabel(categoryTokens[categoryTokens.length - 1] || categoryTokens[0] || '热点融合');
  const title = cleanCopyText(item.title) || `热榜作品 ${index + 1}`;
  const summarySeed = pickFirstClause(item.summary || '', 34);
  const conflictSeed = summarySeed || `${clipText(title, 16)}同类高压危机`;
  const name = buildReadableTemplateName(index, genre);
  const coreTheme = summarySeed || `${genre}题材下的高压破局与成长跃迁`;
  const oneLineSellingPoint = `以${clipText(title, 14)}同类爽点为引擎：危机开局→连锁反转→阶段兑现`;
  const protagonistSetup = `主角从弱势处境切入，围绕“${clipText(conflictSeed, 18)}”这一代价目标，在资源短板中持续补强。`;
  const hookDesign = `首章 300 字内抛出「${clipText(conflictSeed, 18)}」级不可逆事件，逼迫主角立刻选边站队。`;
  const conflictDesign = `设置外压（对手/规则）与内耗（短板/关系）双线推进，每 3-5 章完成一次冲突抬升。`;
  const growthRoute = GROWTH_ROUTE_VARIANTS[index % GROWTH_ROUTE_VARIANTS.length];
  const fanqieSignals = ['高压开局', '连续反转', '章节尾钩子', '情绪快兑现'];
  const recommendedOpening = `开篇先给危机场景与代价，再给主角第一步反制动作，末段留下一层更大风险。`;

  return {
    id: buildTemplateId(snapshotDate, index, name),
    name,
    genre,
    coreTheme,
    oneLineSellingPoint,
    keywords: deriveKeywordsFromHotItem(item, genre),
    protagonistSetup,
    hookDesign,
    conflictDesign,
    growthRoute,
    fanqieSignals,
    recommendedOpening,
    sourceBooks: [title],
  };
}

function buildSeedTemplatesFromHotList(
  hotItems: FanqieHotItem[],
  snapshotDate: string,
  maxTemplates: number
): ImagineTemplate[] {
  const targetCount = Math.max(1, Math.min(30, maxTemplates));
  const fallbackGenres = ['都市日常', '科幻末世', '东方仙侠', '古风世情', '西方奇幻', '游戏体育', '女频衍生', '悬疑灵异'];

  const sourceItems: FanqieHotItem[] = [];
  if (hotItems.length > 0) {
    for (let i = 0; i < targetCount; i += 1) {
      sourceItems.push(hotItems[i % hotItems.length]);
    }
  } else {
    for (let i = 0; i < targetCount; i += 1) {
      sourceItems.push({
        rank: i + 1,
        title: `热榜作品 ${i + 1}`,
        category: fallbackGenres[i % fallbackGenres.length],
        summary: `${fallbackGenres[i % fallbackGenres.length]}题材下的高压危机与升级反转`,
        sourceUrl: FANQIE_RANK_DISCOVERY_URL,
      });
    }
  }

  return sourceItems.map((item, index) => buildSeedTemplateFromHotItem(item, index, snapshotDate));
}

function sanitizeTemplate(
  raw: any,
  index: number,
  snapshotDate: string,
  seedHotItem?: FanqieHotItem
): ImagineTemplate {
  const seedTemplate = seedHotItem
    ? buildSeedTemplateFromHotItem(seedHotItem, index, snapshotDate)
    : buildSeedTemplateFromHotItem({
      rank: index + 1,
      title: `热榜作品 ${index + 1}`,
      category: '热点融合',
      summary: '高压开局与持续升级',
      sourceUrl: FANQIE_RANK_DISCOVERY_URL,
    }, index, snapshotDate);

  const genre = normalizeGenreLabel(raw?.genre || raw?.type || seedTemplate.genre);
  const rawName = cleanCopyText(raw?.name || raw?.title);
  const name = rawName || buildReadableTemplateName(index, genre);
  const coreTheme = cleanCopyText(raw?.coreTheme || raw?.theme) || seedTemplate.coreTheme;
  const oneLineSellingPoint = cleanCopyText(raw?.oneLineSellingPoint || raw?.sellingPoint) || seedTemplate.oneLineSellingPoint;
  const protagonistSetup = cleanCopyText(raw?.protagonistSetup || raw?.protagonist) || seedTemplate.protagonistSetup;
  const hookDesign = cleanCopyText(raw?.hookDesign || raw?.hook) || seedTemplate.hookDesign;
  const conflictDesign = cleanCopyText(raw?.conflictDesign || raw?.conflict) || seedTemplate.conflictDesign;
  const growthRoute = cleanCopyText(raw?.growthRoute || raw?.growth) || seedTemplate.growthRoute;
  const recommendedOpening = cleanCopyText(raw?.recommendedOpening || raw?.opening) || seedTemplate.recommendedOpening;

  const keywordsRaw = normalizeStringArray(raw?.keywords, 10);
  const fanqieSignalsRaw = normalizeStringArray(raw?.fanqieSignals || raw?.platformSignals, 10);
  const sourceBooksRaw = normalizeStringArray(raw?.sourceBooks || raw?.references || raw?.hotBooks, 5);

  return {
    id: cleanText(raw?.id) || buildTemplateId(snapshotDate, index, name),
    name,
    genre,
    coreTheme,
    oneLineSellingPoint,
    keywords: keywordsRaw.length > 0 ? keywordsRaw : seedTemplate.keywords,
    protagonistSetup,
    hookDesign,
    conflictDesign,
    growthRoute,
    fanqieSignals: fanqieSignalsRaw.length > 0 ? fanqieSignalsRaw : seedTemplate.fanqieSignals,
    recommendedOpening,
    sourceBooks: sourceBooksRaw.length > 0 ? sourceBooksRaw : seedTemplate.sourceBooks,
  };
}

function mergeTemplatesWithSeeds(templates: ImagineTemplate[], seeds: ImagineTemplate[]): ImagineTemplate[] {
  if (templates.length === 0) return [];
  if (seeds.length === 0) return templates;

  const merged = templates.map((template, index) => {
    const seed = seeds[index % seeds.length];
    return {
      ...template,
      id: cleanText(template.id) || seed.id,
      name: cleanCopyText(template.name) || seed.name,
      genre: normalizeGenreLabel(template.genre || seed.genre),
      coreTheme: cleanCopyText(template.coreTheme) || seed.coreTheme,
      oneLineSellingPoint: cleanCopyText(template.oneLineSellingPoint) || seed.oneLineSellingPoint,
      protagonistSetup: cleanCopyText(template.protagonistSetup) || seed.protagonistSetup,
      hookDesign: cleanCopyText(template.hookDesign) || seed.hookDesign,
      conflictDesign: cleanCopyText(template.conflictDesign) || seed.conflictDesign,
      growthRoute: cleanCopyText(template.growthRoute) || seed.growthRoute,
      recommendedOpening: cleanCopyText(template.recommendedOpening) || seed.recommendedOpening,
      keywords: normalizeStringArray(template.keywords, 10).length > 0
        ? normalizeStringArray(template.keywords, 10)
        : seed.keywords,
      fanqieSignals: normalizeStringArray(template.fanqieSignals, 10).length > 0
        ? normalizeStringArray(template.fanqieSignals, 10)
        : seed.fanqieSignals,
      sourceBooks: normalizeStringArray(template.sourceBooks, 5).length > 0
        ? normalizeStringArray(template.sourceBooks, 5)
        : seed.sourceBooks,
    };
  });

  const minUnique = Math.max(2, Math.ceil(Math.min(merged.length, 10) * 0.4));
  const textFields: Array<keyof ImagineTemplate> = [
    'coreTheme',
    'oneLineSellingPoint',
    'protagonistSetup',
    'hookDesign',
    'conflictDesign',
    'growthRoute',
    'recommendedOpening',
  ];

  for (const field of textFields) {
    const uniqueCount = new Set(
      merged.map((item) => cleanCopyText(String(item[field] || ''))).filter(Boolean)
    ).size;
    if (uniqueCount >= minUnique) continue;
    for (let i = 0; i < merged.length; i += 1) {
      merged[i][field] = seeds[i % seeds.length][field] as any;
    }
  }

  const keywordUnique = new Set(merged.map((item) => normalizeStringArray(item.keywords, 10).join('|')).filter(Boolean)).size;
  if (keywordUnique < minUnique) {
    for (let i = 0; i < merged.length; i += 1) {
      merged[i].keywords = seeds[i % seeds.length].keywords;
    }
  }

  const signalUnique = new Set(merged.map((item) => normalizeStringArray(item.fanqieSignals, 10).join('|')).filter(Boolean)).size;
  if (signalUnique < minUnique) {
    for (let i = 0; i < merged.length; i += 1) {
      merged[i].fanqieSignals = seeds[i % seeds.length].fanqieSignals;
    }
  }

  return merged;
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
  const seedTemplates = buildSeedTemplatesFromHotList(shortlist, snapshotDate, maxTemplates);
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
  const prompt = `请基于以下番茄小说热榜内容，生成 ${maxTemplates} 个“AI 自动想象模板”。\n\n要求：\n1) 模板必须覆盖多类型，不要都一样。\n2) 每个模板都要可直接用于生成 Story Bible。\n3) 强调“开篇钩子、冲突升级、爽点兑现、成长路线”。\n4) 不要照抄榜单情节，要抽象成可复用套路。\n5) 文案必须使用自然中文，不要出现乱码字符、私有区字符、机翻味表达。\n\n榜单数据：\n${hotListText}\n\n返回 JSON 结构：\n{\n  "templates": [\n    {\n      "name": "模板名",\n      "genre": "类型",\n      "coreTheme": "核心主题",\n      "oneLineSellingPoint": "一句话卖点",\n      "keywords": ["关键词1", "关键词2"],\n      "protagonistSetup": "主角设定",\n      "hookDesign": "开篇钩子",\n      "conflictDesign": "冲突设计",\n      "growthRoute": "成长路线",\n      "fanqieSignals": ["平台信号1", "平台信号2"],\n      "recommendedOpening": "开篇建议",\n      "sourceBooks": ["来自哪些热门书名"]\n    }\n  ]\n}`;

  let raw = '';
  try {
    raw = await generateTextWithRetry(aiConfig, {
      system,
      prompt,
      temperature: 0.65,
      maxTokens: 5200,
    }, 4);
  } catch (error) {
    console.warn('[ImagineTemplates] model generation failed, using fallback templates:', (error as Error).message);
    return seedTemplates.slice(0, maxTemplates);
  }

  const templatesRaw = parseTemplatePayload(raw);
  if (templatesRaw.length === 0) {
    console.warn('[ImagineTemplates] template JSON parse failed, using fallback templates');
    return seedTemplates.slice(0, maxTemplates);
  }

  const parsedTemplates = templatesRaw
    .slice(0, maxTemplates)
    .map((item: any, index: number) => sanitizeTemplate(item, index, snapshotDate, shortlist[index]));

  if (parsedTemplates.length === 0) {
    return seedTemplates.slice(0, maxTemplates);
  }

  const mergedTemplates = mergeTemplatesWithSeeds(parsedTemplates, seedTemplates);
  if (mergedTemplates.length < seedTemplates.length) {
    for (let i = mergedTemplates.length; i < seedTemplates.length; i += 1) {
      mergedTemplates.push(seedTemplates[i]);
    }
  }

  return mergedTemplates.slice(0, maxTemplates);
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
    const snapshotDate = String(row.snapshot_date);
    const rankingRaw = JSON.parse(row.ranking_json || '[]') as FanqieHotItem[];
    const ranking = rankingRaw.map((item, index) => ({
      rank: Number.isFinite(Number(item?.rank)) ? Number(item.rank) : index + 1,
      title: cleanCopyText(item?.title) || `热榜作品 ${index + 1}`,
      author: cleanCopyText(item?.author) || undefined,
      summary: clipText(cleanCopyText(item?.summary), 220) || undefined,
      status: cleanCopyText(item?.status) || undefined,
      readingCountText: cleanCopyText(item?.readingCountText) || undefined,
      updatedAtText: cleanCopyText(item?.updatedAtText) || undefined,
      category: cleanCopyText(item?.category) || undefined,
      url: cleanText(item?.url) || undefined,
      sourceUrl: cleanText(item?.sourceUrl) || FANQIE_RANK_DISCOVERY_URL,
    }));

    const templatesRaw = JSON.parse(row.templates_json || '[]') as ImagineTemplate[];
    const targetCount = Math.max(
      1,
      Math.min(
        30,
        templatesRaw.length > 0
          ? templatesRaw.length
          : Math.min(16, Math.max(6, ranking.length || 6))
      )
    );
    const seedTemplates = buildSeedTemplatesFromHotList(ranking, snapshotDate, targetCount);
    const sanitizedTemplates = templatesRaw
      .slice(0, targetCount)
      .map((item, index) => sanitizeTemplate(item, index, snapshotDate, ranking[index]));
    const templates = sanitizedTemplates.length > 0
      ? mergeTemplatesWithSeeds(sanitizedTemplates, seedTemplates)
      : row.status === 'error'
        ? []
        : seedTemplates;

    return {
      snapshotDate,
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
