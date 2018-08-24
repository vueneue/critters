# VueNeue - Critters

> A transformed version of [Google Critters](https://github.com/GoogleChromeLabs/critters) but without webpack requirement

## Usage

Base files:

- [HTML file](sample/index.html)
- [CSS file](sample/styles.css)

**Code**

```js
const fs = require("fs");
const Critters = require("./src");

// Read HTML file
const html = fs.readFileSync("index.html");

// Store stylesheets contents in object
const cssFiles = {
  "/styles.css": fs.readFileSync("styles.css")
};

// Process
const critical = new Critters();

critical.process(html, cssFiles).then(html => {
  // html = optimized with critical CSS
});
```

## License

**MIT** - See `LICENSE` file
