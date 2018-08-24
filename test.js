const fs = require("fs-extra");
const Critters = require("./src");

(async () => {
  const cssFiles = {
    "/styles.css": await fs.readFile("sample/styles.css", "utf-8")
  };
  const html = await fs.readFile("sample/index.html", "utf-8");

  const critters = new Critters();

  const final = await critters.process(html, cssFiles);
  console.log(final);
})().catch(err => console.error(err));
