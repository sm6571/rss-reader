// Dynamic import wrapper for ESM-only @extractus/article-extractor
let _extract = null;

async function getExtractor() {
  if (!_extract) {
    const mod = await import('@extractus/article-extractor');
    _extract = mod.extract;
  }
  return _extract;
}

async function extractArticle(url) {
  if (!url) return null;
  try {
    const extract = await getExtractor();
    const article = await extract(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
      }
    });
    if (!article || !article.content) return null;
    return {
      content: article.content,
      author: article.author || '',
      title: article.title || ''
    };
  } catch (err) {
    return null;
  }
}

module.exports = { extractArticle };
