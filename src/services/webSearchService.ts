/**
 * Web Search Service — 使用 Cloudflare Browser Rendering (Playwright) 抓取 Bing 搜索结果
 */

import { launch } from '@cloudflare/playwright';

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

const BING_SEARCH_TIMEOUT_MS = 15_000;
const MAX_RESULTS = 10;
const BROWSER_LAUNCH_RETRY_DELAYS_MS = [2000, 5000];

function isRateLimitError(err: Error): boolean {
  const msg = err.message.toLowerCase();
  return msg.includes('rate limit') || msg.includes('too many') || msg.includes('429') || msg.includes('concurrent');
}

async function launchWithRetry(browserBinding: Fetcher): Promise<any> {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= BROWSER_LAUNCH_RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await launch(browserBinding);
    } catch (err) {
      lastErr = err as Error;
      if (!isRateLimitError(lastErr) || attempt === BROWSER_LAUNCH_RETRY_DELAYS_MS.length) {
        throw lastErr;
      }
      await new Promise(resolve => setTimeout(resolve, BROWSER_LAUNCH_RETRY_DELAYS_MS[attempt]));
    }
  }
  throw lastErr;
}

/**
 * 通过 Playwright 打开 Bing 搜索页面，抓取搜索结果
 */
export async function searchWebWithBing(
  browserBinding: Fetcher,
  query: string,
  maxResults = MAX_RESULTS,
): Promise<WebSearchResult[]> {
  const browser = await launchWithRetry(browserBinding);
  const page = await browser.newPage();

  try {
    const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${maxResults}`;
    await page.goto(searchUrl, {
      waitUntil: 'domcontentloaded',
      timeout: BING_SEARCH_TIMEOUT_MS,
    });
    await page.waitForTimeout(800);

    const results: WebSearchResult[] = await page.evaluate((limit: number) => {
      const items: Array<{ title: string; url: string; snippet: string }> = [];
      const doc = (globalThis as any).document;

      // 多个 Bing 结果选择器（Bing 周期性更新布局）
      const SELECTORS = [
        '#b_results > li.b_algo',
        '#b_results li[class*="algo"]',
        '.b_algo',
        'li[data-bm]',
      ];

      let listItems: any[] = [];
      for (const selector of SELECTORS) {
        const found = Array.from(doc.querySelectorAll(selector) || []) as any[];
        if (found.length > 0) {
          listItems = found;
          break;
        }
      }

      for (const li of listItems) {
        if (items.length >= limit) break;

        const anchor = li.querySelector('h2 a, h3 a, .b_title a') as any;
        if (!anchor) continue;

        const title = (anchor.textContent || '').trim();
        const url = anchor.href || '';
        if (!title || !url) continue;

        // snippet from multiple possible locations
        const snippetEl = li.querySelector('.b_caption p, .b_snippet, p, .b_algoSlug') as any;
        const snippet = (snippetEl?.textContent || '').trim();

        items.push({ title, url, snippet });
      }

      return items;
    }, maxResults);

    return results;
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}
