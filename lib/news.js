// Searches Google News RSS (free, no API key) for articles related to a note.
// Only headlines, publishers, dates and links come back - not full article text.

const MAX_PER_QUERY = 5;
const MAX_TOTAL = 8;

const decode = (s = "") =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .trim();

const tag = (xml, name) => decode(xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1]);

async function searchOne(query) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; MeeraBot/1.0)" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Google News RSS ${res.status}`);
  const xml = await res.text();

  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, MAX_PER_QUERY).map(([, item]) => {
    const source = tag(item, "source");
    let title = tag(item, "title");
    // Google appends " - Publisher" to every headline.
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
    const date = new Date(tag(item, "pubDate"));
    return {
      title,
      source,
      date: isNaN(date) ? "" : date.toISOString().slice(0, 10),
      link: tag(item, "link"),
    };
  });
}

// Returns up to MAX_TOTAL unique articles across all queries, numbered S1, S2, ...
// A failed search never blocks the draft; it just returns fewer (or no) articles.
export async function searchNews(queries = []) {
  const results = await Promise.allSettled(queries.slice(0, 3).map(searchOne));
  const seen = new Set();
  const articles = [];
  for (const r of results) {
    if (r.status !== "fulfilled") {
      console.warn("News search failed:", r.reason?.message);
      continue;
    }
    for (const a of r.value) {
      const key = a.title.toLowerCase();
      if (!a.link || seen.has(key)) continue;
      seen.add(key);
      articles.push(a);
    }
  }
  return articles.slice(0, MAX_TOTAL).map((a, i) => ({ id: `S${i + 1}`, ...a }));
}
