const canaryHtml = `<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex,nofollow" />
    <title>Player Canary</title>
    <style>
      body { margin: 0; padding: 16px; font-family: Arial, sans-serif; background: #111; color: #eee; }
      main { max-width: 980px; margin: 0 auto; }
      section { margin: 0 0 24px; }
      h1, h2 { margin: 0 0 12px; font-size: 18px; }
      h1 { font-size: 22px; }
      iframe { display: block; width: 100%; aspect-ratio: 16 / 9; border: 1px solid #555; background: #000; }
      code { color: #b7e3ff; }
    </style>
  </head>
  <body>
    <main>
      <h1>Player Canary</h1>
      <section id="sw">
        <h2>SW <code>abblfwmdc98g</code></h2>
        <iframe
          src="https://j-av.com/player/twvid/sw.php?id=abblfwmdc98g"
          title="SW player canary"
          allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
          allowfullscreen
          loading="eager"
        ></iframe>
      </section>
      <section id="fl">
        <h2>FL <code>v4u3thbfgnay</code></h2>
        <iframe
          src="https://j-av.com/player/twvid/fl.php?id=v4u3thbfgnay&image=https://pics.dmm.co.jp/mono/movie/adult/atid691/atid691pl.jpg"
          title="FL player canary"
          allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
          allowfullscreen
          loading="eager"
        ></iframe>
      </section>
    </main>
  </body>
</html>`;

export function onRequest() {
  return new Response(canaryHtml, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}
