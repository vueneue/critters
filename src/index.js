/**
 * Copyright 2018 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not
 * use this file except in compliance with the License. You may obtain a copy of
 * the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
 * License for the specific language governing permissions and limitations under
 * the License.
 */

const path = require("path");
const { createDocument, serializeDocument } = require("./dom");
const {
  parseStylesheet,
  serializeStylesheet,
  walkStyleRules
} = require("./css");

/**
 * The mechanism to use for lazy-loading stylesheets.
 * _[JS]_ indicates that a strategy requires JavaScript (falls back to `<noscript>`).
 *
 * - **default:** Move stylesheet links to the end of the document and insert preload meta tags in their place.
 * - **"body":** Move all external stylesheet links to the end of the document.
 * - **"media":** Load stylesheets asynchronously by adding `media="not x"` and removing once loaded. _[JS]_
 * - **"swap":** Convert stylesheet links to preloads that swap to `rel="stylesheet"` once loaded. _[JS]_
 * - **"js":** Inject an asynchronous CSS loader similar to [LoadCSS](https://github.com/filamentgroup/loadCSS) and use it to load stylesheets. _[JS]_
 * - **"js-lazy":** Like `"js"`, but the stylesheet is disabled until fully loaded.
 * @typedef {(default|'body'|'media'|'swap'|'js'|'js-lazy')} PreloadStrategy
 * @public
 */

/**
 * All optional. Pass them to `new Critters({ ... })`.
 * @public
 * @typedef {Object} Options
 * @property {Boolean} external     Inline styles from external stylesheets _(default: `true`)_
 * @property {String} preload       Which {@link PreloadStrategy preload strategy} to use
 * @property {Boolean} noscriptFallback Add `<noscript>` fallback to JS-based strategies
 * @property {Boolean} inlineFonts  Inline critical font-face rules _(default: `false`)_
 * @property {Boolean} preloadFonts Preloads critical fonts _(default: `true`)_
 * @property {Boolean} fonts        Shorthand for setting `inlineFonts`+`preloadFonts`
 *  - values:
 *  - `true` to inline critical font-face rules and preload the fonts
 *  - `false` to don't inline any font-face rules and don't preload fonts
 * @property {Boolean} compress     Compress resulting critical CSS _(default: `true`)_
 */

/**
 * Create a Critters plugin instance with the given options.
 * @public
 * @param {Options} options Options to control how Critters inlines CSS.
 * @example
 * // webpack.config.js
 * module.exports = {
 *   plugins: [
 *     new Critters({
 *       // Outputs: <link rel="preload" onload="this.rel='stylesheet'">
 *       preload: 'swap',
 *
 *       // Don't inline critical font-face rules, but preload the font URLs:
 *       preloadFonts: true
 *     })
 *   ]
 * }
 */
module.exports = class Critters {
  /** @private */
  constructor(options) {
    this.options = options || {};
    this.urlFilter = this.options.filter;
    if (this.urlFilter instanceof RegExp) {
      this.urlFilter = this.urlFilter.test.bind(this.urlFilter);
    }
  }

  /**
   * Apply critical CSS processing to html-webpack-plugin
   */
  async process(html, cssFiles) {
    // Parse the generated HTML in a DOM we can mutate
    const document = createDocument(html);

    // `external:false` skips processing of external sheets
    if (this.options.external !== false) {
      const externalSheets = document.querySelectorAll(
        'link[rel="stylesheet"]'
      );
      await Promise.all(
        externalSheets.map(link => this.embedLinkedStylesheet(link, cssFiles))
      );
    }

    // go through all the style tags in the document and reduce them to only critical CSS
    const styles = document.querySelectorAll("style");
    await Promise.all(styles.map(style => this.processStyle(style, document)));

    // serialize the document back to HTML and we're done
    return serializeDocument(document);
  }

  /**
   * Inline the target stylesheet referred to by a <link rel="stylesheet"> (assuming it passes `options.filter`)
   */
  async embedLinkedStylesheet(link, cssFiles) {
    const href = link.getAttribute("href");
    const media = link.getAttribute("media");
    const document = link.ownerDocument;

    const sheet = cssFiles[href];

    const preloadMode = this.options.preload;

    // skip filtered resources, or network resources if no filter is provided
    if (this.urlFilter ? this.urlFilter(href) : href.match(/^(https?:)?\/\//))
      return Promise.resolve();

    // CSS loader is only injected for the first sheet, then this becomes an empty string
    let cssLoaderPreamble = `function $loadcss(u,m,l){(l=document.createElement('link')).rel='stylesheet';l.href=u;document.head.appendChild(l)}`;
    const lazy = preloadMode === "js-lazy";
    if (lazy) {
      cssLoaderPreamble = cssLoaderPreamble.replace(
        "l.href",
        `l.media='only x';l.onload=function(){l.media=m};l.href`
      );
    }

    // the reduced critical CSS gets injected into a new <style> tag
    const style = document.createElement("style");
    style.appendChild(document.createTextNode(sheet));
    link.parentNode.insertBefore(style, link.nextSibling);

    // drop a reference to the original URL onto the tag (used for reporting to console later)
    style.$$name = href;

    // Allow disabling any mutation of the stylesheet link:
    if (preloadMode === false) return;

    let noscriptFallback = false;

    if (preloadMode === "body") {
      document.body.appendChild(link);
    } else {
      link.setAttribute("rel", "preload");
      link.setAttribute("as", "style");
      if (preloadMode === "js" || preloadMode === "js-lazy") {
        const script = document.createElement("script");
        const js = `${cssLoaderPreamble}$loadcss(${JSON.stringify(href)}${
          lazy ? "," + JSON.stringify(media || "all") : ""
        })`;
        script.appendChild(document.createTextNode(js));
        link.parentNode.insertBefore(script, link.nextSibling);
        cssLoaderPreamble = "";
        noscriptFallback = true;
      } else if (preloadMode === "media") {
        // @see https://github.com/filamentgroup/loadCSS/blob/af1106cfe0bf70147e22185afa7ead96c01dec48/src/loadCSS.js#L26
        link.setAttribute("rel", "stylesheet");
        link.removeAttribute("as");
        link.setAttribute("media", "only x");
        link.setAttribute("onload", `this.media='${media || "all"}'`);
        noscriptFallback = true;
      } else if (preloadMode === "swap") {
        link.setAttribute("onload", "this.rel='stylesheet'");
        noscriptFallback = true;
      } else {
        const bodyLink = document.createElement("link");
        bodyLink.setAttribute("rel", "stylesheet");
        if (media) bodyLink.setAttribute("media", media);
        bodyLink.setAttribute("href", href);
        document.body.appendChild(bodyLink);
      }
    }

    if (this.options.noscriptFallback !== false && noscriptFallback) {
      const noscript = document.createElement("noscript");
      const noscriptLink = document.createElement("link");
      noscriptLink.setAttribute("rel", "stylesheet");
      noscriptLink.setAttribute("href", href);
      if (media) noscriptLink.setAttribute("media", media);
      noscript.appendChild(noscriptLink);
      link.parentNode.insertBefore(noscript, link.nextSibling);
    }
  }

  /**
   * Parse the stylesheet within a <style> element, then reduce it to contain only rules used by the document.
   */
  async processStyle(style) {
    const options = this.options;
    const document = style.ownerDocument;
    const head = document.querySelector("head");

    // basically `.textContent`
    let sheet =
      style.childNodes.length > 0 &&
      style.childNodes.map(node => node.nodeValue).join("\n");

    // store a reference to the previous serialized stylesheet for reporting stats
    const before = sheet;

    // Skip empty stylesheets
    if (!sheet) return;

    const ast = parseStylesheet(sheet);

    // a string to search for font names (very loose)
    let criticalFonts = "";

    // Walk all CSS rules, transforming unused rules to comments (which get removed)
    walkStyleRules(ast, rule => {
      if (rule.type === "rule") {
        // Filter the selector list down to only those matche
        rule.selectors = rule.selectors.filter(sel => {
          // Strip pseudo-elements and pseudo-classes, since we only care that their associated elements exist.
          // This means any selector for a pseudo-element or having a pseudo-class will be inlined if the rest of the selector matches.
          sel = sel.replace(/::?(?:[a-z-]+)([.[#~&^:*]|\s|\n|$)/gi, "$1");
          return document.querySelector(sel, document) != null;
        });
        // If there are no matched selectors, remove the rule:
        if (rule.selectors.length === 0) {
          return false;
        }

        if (rule.declarations) {
          for (let i = 0; i < rule.declarations.length; i++) {
            const decl = rule.declarations[i];
            if (decl.property.match(/\bfont\b/i)) {
              criticalFonts += " " + decl.value;
            }
          }
        }
      }

      // keep font rules, they're handled in the second pass:
      if (rule.type === "font-face") return;

      // If there are no remaining rules, remove the whole rule:
      return !rule.rules || rule.rules.length !== 0;
    });

    const shouldPreloadFonts =
      options.fonts === true || options.preloadFonts === true;
    const shouldInlineFonts =
      options.fonts !== false || options.inlineFonts === true;

    const preloadedFonts = [];
    walkStyleRules(ast, rule => {
      // only process @font-face rules in the second pass
      if (rule.type !== "font-face") return;

      let family, src;
      for (let i = 0; i < rule.declarations.length; i++) {
        const decl = rule.declarations[i];
        if (decl.property === "src") {
          // @todo parse this properly and generate multiple preloads with type="font/woff2" etc
          src = (decl.value.match(/url\s*\(\s*(['"]?)(.+?)\1\s*\)/) || [])[2];
        } else if (decl.property === "font-family") {
          family = decl.value;
        }
      }

      if (src && shouldPreloadFonts && preloadedFonts.indexOf(src) === -1) {
        preloadedFonts.push(src);
        const preload = document.createElement("link");
        preload.setAttribute("rel", "preload");
        preload.setAttribute("as", "font");
        if (src.match(/:\/\//)) {
          preload.setAttribute("crossorigin", "anonymous");
        }
        preload.setAttribute("href", src.trim());
        head.appendChild(preload);
      }

      // if we're missing info, if the font is unused, or if critical font inlining is disabled, remove the rule:
      if (
        !family ||
        !src ||
        criticalFonts.indexOf(family) === -1 ||
        !shouldInlineFonts
      )
        return false;
    });

    sheet = serializeStylesheet(ast, {
      compress: this.options.compress !== false
    });

    // If all rules were removed, get rid of the style element entirely
    if (sheet.trim().length === 0) {
      if (style.parentNode) {
        style.parentNode.removeChild(style);
      }
    } else {
      // replace the inline stylesheet with its critical'd counterpart
      while (style.lastChild) {
        style.removeChild(style.lastChild);
      }
      style.appendChild(document.createTextNode(sheet));
    }
  }
};
