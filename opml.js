// OPML import/export for RSS feeds

function parseOPML(xmlString) {
  const feeds = [];
  // Simple regex-based parser (avoids needing xml2js dependency)
  const outlineRegex = /<outline[^>]*>/gi;
  let match;

  while ((match = outlineRegex.exec(xmlString)) !== null) {
    const tag = match[0];
    const xmlUrl = getAttr(tag, 'xmlUrl') || getAttr(tag, 'xmlurl');
    if (!xmlUrl) continue; // skip category outlines

    feeds.push({
      url: xmlUrl,
      title: getAttr(tag, 'title') || getAttr(tag, 'text') || '',
      siteUrl: getAttr(tag, 'htmlUrl') || getAttr(tag, 'htmlurl') || '',
      category: getParentCategory(xmlString, match.index) || 'Uncategorized'
    });
  }

  return feeds;
}

function getAttr(tag, name) {
  const regex = new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i');
  const match = tag.match(regex);
  return match ? decodeXMLEntities(match[1]) : null;
}

function getParentCategory(xml, position) {
  // Look backward from position to find enclosing outline with text but no xmlUrl
  const before = xml.substring(0, position);
  const categoryRegex = /<outline[^>]*text\s*=\s*"([^"]*)"[^>]*>/gi;
  let lastCategory = null;
  let match;

  while ((match = categoryRegex.exec(before)) !== null) {
    const tag = match[0];
    if (!getAttr(tag, 'xmlUrl') && !getAttr(tag, 'xmlurl')) {
      lastCategory = decodeXMLEntities(match[1]);
    }
  }

  return lastCategory;
}

function decodeXMLEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function escapeXML(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function generateOPML(feeds, title = 'RSS Reader Feeds') {
  const categories = {};
  feeds.forEach(f => {
    const cat = f.category || 'Uncategorized';
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(f);
  });

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<opml version="2.0">\n`;
  xml += `  <head><title>${escapeXML(title)}</title></head>\n`;
  xml += `  <body>\n`;

  for (const [cat, catFeeds] of Object.entries(categories)) {
    xml += `    <outline text="${escapeXML(cat)}">\n`;
    for (const f of catFeeds) {
      xml += `      <outline type="rss" text="${escapeXML(f.title)}" title="${escapeXML(f.title)}" xmlUrl="${escapeXML(f.url)}" htmlUrl="${escapeXML(f.site_url || '')}"/>\n`;
    }
    xml += `    </outline>\n`;
  }

  xml += `  </body>\n</opml>`;
  return xml;
}

module.exports = { parseOPML, generateOPML };
