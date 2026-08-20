/**
 * Mini Barn Market — the Instagram grid's data source.
 *
 * index.html draws the grid in three tiers. Tier 1 is the pinned posts baked
 * into the HTML: captions and links, working with no JavaScript and no network
 * at all. Tier 2 upgrades them into real Instagram embeds. Tier 3 is this
 * function, which hands back actual photography so the grid has pictures in it.
 *
 * It answers with:
 *
 *     { "posts": [ { "link", "thumb", "caption", "type" }, ... ] }
 *
 * and the page takes the first six. A failure here is not a broken page — the
 * page falls back down the tiers on its own — but the grid does go to flat
 * tiles with captions and no imagery, which is what the owner will notice.
 *
 * TWO MODES
 *
 *   With IG_TOKEN set — a long-lived Instagram Graph API token — it serves the
 *   account's LATEST posts and reels, newest first, and keeps itself current.
 *
 *   With no token it serves the pinned posts' own stills, read server-side out
 *   of each post's public embed page. That needs no credential and no setup, so
 *   the grid has real photography from the day the site goes up.
 *
 * WHY THE STILLS ARE SCRAPED RATHER THAN LINKED
 *
 * Instagram's CDN URLs are signed and expire, so they cannot be committed to
 * the repo — a hard-coded one works for a few days and then 404s. They have to
 * be fetched fresh, which is what this does, with the answer cached at the edge
 * so Instagram is not asked on every page view.
 *
 * HISTORY
 *
 * This function existed on the site before 20 Aug 2026 but was never in a
 * repository — the site was published by dragging a folder onto Netlify, and
 * when the repo was seeded from a mirror of the live site the function could
 * not be captured, because a mirror only sees what a browser can download.
 * The grid went to tier 1 and the pictures disappeared. Rebuilt from the
 * contract that index.html still expected.
 */

/* The pinned posts, in the order they appear in index.html. Keep this list and
   the .ig-grid markup in step: these captions are what the page shows if the
   still cannot be fetched. */
const PINNED = [
  { code: "reel/DbJutd0BsoV", caption: "Better than organic, non-toxic, small batch, handmade." },
  { code: "reel/DZG45lfvVFX", caption: "Lime, but make it caviar. Australian finger limes, straight off the farm." },
  { code: "reel/DZGzfBtP9ZN", caption: "Your neighborhood farm stand is open. Always." },
  { code: "reel/DXSOjBqjnKv", caption: "Sourdough, sweet treats, eggs, produce in season, and a good deal more." },
  { code: "reel/DZhEprNpUPL", caption: "A San Diego County farm stand that never closes." },
  { code: "reel/Danv9abBoim", caption: "Twenty-four hours, seven days, held up by the honor system." },
];

const UA =
  "Mozilla/5.0 (compatible; MiniBarnMarket/1.0; +https://minibarnmarket.com)";

/**
 * Pull the post's own still out of an embed page.
 *
 * Two things here are load-bearing, and both were got wrong first time:
 *
 *   The page carries these URLs in two different escapings — HTML attributes
 *   use &amp;, the embedded JSON blobs use \/ and & — so both have to be
 *   normalised before matching or the URL comes out mangled.
 *
 *   There is no length limit on the match. These URLs run to about 600
 *   characters and the signature, oh= and oe=, sits at the very end. A capped
 *   pattern returns something that looks like a URL, passes every eyeball
 *   test, and 403s when a browser asks for it.
 */
function stillFrom(html) {
  const text = html
    .replace(/\\u0026/g, "&")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&");
  const found = text.match(/https:\/\/[a-z0-9.\-]*scontent[^\s"'<>\\)]+/gi) || [];
  for (const url of found) {
    // t51.2885-19 is the profile avatar, and an s96x96-style crop is a
    // thumbnail of it. Neither is the post.
    if (/t51\.2885-19/.test(url)) continue;
    if (/s\d{2,3}x\d{2,3}/.test(url)) continue;
    // Unsigned means it will 403 the moment a browser asks. Skip it rather
    // than hand the page a picture that cannot load.
    if (!/[?&]oh=/.test(url) || !/[?&]oe=/.test(url)) continue;
    return url;
  }
  return null;
}

async function fromEmbeds() {
  const posts = await Promise.all(
    PINNED.map(async (p) => {
      const link = `https://www.instagram.com/${p.code}/`;
      const base = {
        link,
        caption: p.caption,
        type: p.code.startsWith("reel/") ? "VIDEO" : "IMAGE",
      };
      try {
        const res = await fetch(`https://www.instagram.com/${p.code}/embed/`, {
          headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9" },
        });
        if (!res.ok) return null;
        const thumb = stillFrom(await res.text());
        return thumb ? { ...base, thumb } : null;
      } catch {
        return null;
      }
    })
  );
  // A post whose still could not be read is dropped rather than sent without
  // one: the page would render an empty tile where a picture should be, and
  // tier 1 already does that better.
  return posts.filter(Boolean);
}

async function fromGraph(token) {
  const fields = "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp";
  const res = await fetch(
    `https://graph.instagram.com/me/media?fields=${fields}&limit=12&access_token=${encodeURIComponent(token)}`
  );
  if (!res.ok) throw new Error(`Graph API said ${res.status}`);
  const data = await res.json();
  return (data.data || [])
    .map((m) => ({
      link: m.permalink,
      // A video's media_url is the video file itself; its still is thumbnail_url.
      thumb: m.media_type === "VIDEO" ? m.thumbnail_url : m.media_url,
      caption: (m.caption || "").split("\n")[0].slice(0, 140),
      type: m.media_type === "VIDEO" ? "VIDEO" : "IMAGE",
    }))
    .filter((p) => p.thumb);
}

export default async () => {
  const json = (body, status = 200, maxAge = 1800) =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        "content-type": "application/json",
        // Cached at the edge so Instagram is asked roughly twice an hour
        // rather than once per visitor. stale-while-revalidate means a slow
        // refetch never makes a reader wait.
        "cache-control": `public, max-age=0, s-maxage=${maxAge}, stale-while-revalidate=86400`,
      },
    });

  const token = process.env.IG_TOKEN;

  try {
    if (token) {
      try {
        const posts = await fromGraph(token);
        if (posts.length) return json({ posts, source: "graph" });
      } catch {
        // An expired or revoked token must not empty the grid — fall through
        // to the embeds, which need no credential.
      }
    }
    const posts = await fromEmbeds();
    if (!posts.length) return json({ posts: [], error: "no stills available" }, 200, 60);
    return json({ posts, source: "embed" });
  } catch (err) {
    // Answer 200 with an empty list rather than an error status. The page
    // treats an empty list as "fall back to the pinned posts", which is
    // exactly right, and a 500 would land in the browser console for nothing.
    return json({ posts: [], error: String(err) }, 200, 60);
  }
};
