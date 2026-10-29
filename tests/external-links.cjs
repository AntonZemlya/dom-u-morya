// The only approved HTML difference in protected sections/legal documents.
function withNofollow(html) {
  return String(html).replace(/<a\b[^>]*>/gi, tag => {
    if (!/\bhref=["'](?:https?:)?\/\//i.test(tag)) return tag;
    return tag.replace(/\brel=(["'])(.*?)\1/i, (attr, quote, tokens) =>
      tokens.split(/\s+/).includes('nofollow') ? attr : `rel=${quote}${tokens} nofollow${quote}`);
  });
}
module.exports = {withNofollow};
