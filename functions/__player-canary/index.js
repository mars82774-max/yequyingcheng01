const flToSwTests = [
  {
    entryId: "entry260805-122000",
    title: "墮入媚藥痴漢之手的誘餌搜查官 水戶香奈",
    videoId: "v4u3thbfgnay"
  },
  {
    entryId: "entry260531-072535",
    title: "我那個性沉穩內斂的青梅竹馬，羞澀地撩撥著我，故意露出內褲，臉頰緋紅，流露出她的愛意。我熾熱的目光讓她興奮不已，下身也濕潤了！ 井上もも",
    videoId: "onyt4ik2gp3a"
  },
  {
    entryId: "entry260531-071153",
    title: "新人 現役女大學生專屬 I罩杯 桃尻麗 AV出道！",
    videoId: "f8zff9p2dawc"
  },
  {
    entryId: "entry260530-151013",
    title: "在學校創了一個泡泡浴社團 學生會會長Unpai穿著淫蕩衣服來迎接你 射精無限制",
    videoId: "w39s6b36kr0a"
  },
  {
    entryId: "entry260404-140427",
    title: "「這個人與母親再婚的原因是我」妻子回娘家一週，對早熟巨乳繼女進行媚藥調教，讓她成為中出性愛玩偶。 百田光稀",
    videoId: "jcrl5adwp05i"
  },
  {
    entryId: "entry260405-124956",
    title: "如果持續用中年技巧和媚藥肉棒責備姪女（田徑運動員）健康的露餡屁股，就陷入了屁股肉抽搐痙攣的絕倫活塞高潮之中。 九野雛乃",
    videoId: "ruaxy913vf76"
  },
  {
    entryId: "entry260403-180056",
    title: "新人NO.1 STYLE 那個話題的超平民姐姐 鈴木希 21歲 AV出道",
    videoId: "kuqj8cp95crj"
  },
  {
    entryId: "entry260327-133819",
    title: "【高衩醜陋特化】為了讓在客人眼裡最可愛的壞女人終結人生，把她人格矯正變成了爽聲肉便器了。 美園和花",
    videoId: "cz5wa94p4v00"
  },
  {
    entryId: "entry260323-170440",
    title: "日出到日落，整整8小時不停高潮！？巨乳美人小穴，容量完全超載 金松季歩",
    videoId: "ailvw7d4chgy"
  },
  {
    entryId: "entry260321-120640",
    title: "地球毀滅倒計時1天 廢柴男唯一心願就是把隔壁巨乳辣妹幹到人格崩壞 藤井蘭蘭",
    videoId: "w61rk5v8823u"
  }
];

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
      h1, h2, p { margin: 0 0 12px; }
      h2 { font-size: 18px; }
      h1 { font-size: 22px; }
      p { color: #d8d8d8; line-height: 1.5; }
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
      ${flToSwTests.map((test, index) => `<section id="fl-sw-${index + 1}">
        <h2>FL→SW TEST ${index + 1} <code>${escapeHtml(test.videoId)}</code></h2>
        <p><strong>ENTRY_ID</strong>: <code>${escapeHtml(test.entryId)}</code></p>
        <p><strong>TITLE</strong>: ${escapeHtml(test.title)}</p>
        <p><strong>ORIGINAL_TYPE</strong>: FL</p>
        <p><strong>VIDEO_ID</strong>: <code>${escapeHtml(test.videoId)}</code></p>
        <iframe
          src="https://j-av.com/player/twvid/sw.php?id=${encodeURIComponent(test.videoId)}"
          title="FL to SW player canary ${index + 1}"
          allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
          allowfullscreen
          loading="eager"
        ></iframe>
      </section>`).join("")}
    </main>
  </body>
</html>`;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

export function onRequest() {
  return new Response(canaryHtml, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}
