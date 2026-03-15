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

/**
 * 通过 Playwright 打开 Bing 搜索页面，抓取搜索结果
 */
export async function searchWebWithBing(
  browserBinding: Fetcher,
  query: string,
  maxResults = MAX_RESULTS,
): Promise<WebSearchResult[]> {
  const browser = await launch(browserBinding);
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

      // Bing organic results
      const listItems = Array.from(doc.querySelectorAll('#b_results > li.b_algo') || []) as any[];
      for (const li of listItems) {
        if (items.length >= limit) break;

        const anchor = li.querySelector('h2 a') as any;
        if (!anchor) continue;

        const title = (anchor.textContent || '').trim();
        const url = anchor.href || '';
        if (!title || !url) continue;

        // snippet from <p> or .b_caption p
        const snippetEl = li.querySelector('.b_caption p, p') as any;
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
