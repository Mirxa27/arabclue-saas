/**
 * A small non-validating XML parser producing the lib/zatca/xml.ts tree — enough for UBL invoices
 * (ours, ZATCA's cleared ones, the SDK samples): elements, attributes, text, CDATA; comments,
 * processing instructions and the XML declaration are skipped. DOCTYPEs are refused (no entity
 * expansion, no external resources). Whitespace text is kept, so canonicalize() of a parsed
 * document reproduces ZATCA's hash of it.
 */
import type { XmlElement, XmlNode } from "@/lib/zatca/xml";

export class XmlParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XmlParseError";
  }
}

const MAX_INPUT = 5 * 1024 * 1024;
const MAX_DEPTH = 100;
const NAME = /[A-Za-z_][A-Za-z0-9._:-]*/y;

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9A-Fa-f]+|#[0-9]+|lt|gt|amp|quot|apos);/g, (_, ref: string) => {
    if (ref === "lt") return "<";
    if (ref === "gt") return ">";
    if (ref === "amp") return "&";
    if (ref === "quot") return '"';
    if (ref === "apos") return "'";
    const code = ref.startsWith("#x") ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
    if (!Number.isFinite(code) || code > 0x10ffff) throw new XmlParseError(`invalid character reference &${ref};`);
    return String.fromCodePoint(code);
  });
}

export function parseXml(input: string): XmlElement {
  if (input.length > MAX_INPUT) throw new XmlParseError("XML document too large");
  // XML 1.0 §2.11 end-of-line handling
  const src = input.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  let i = 0;
  const stack: Array<{ name: string; attrs: Array<readonly [string, string]>; children: XmlNode[] }> = [];
  let root: XmlElement | null = null;

  const pushText = (text: string) => {
    if (!text) return;
    const top = stack[stack.length - 1];
    if (!top) {
      if (text.trim()) throw new XmlParseError("text outside the root element");
      return;
    }
    const last = top.children[top.children.length - 1];
    if (typeof last === "string") top.children[top.children.length - 1] = last + text;
    else top.children.push(text);
  };

  while (i < src.length) {
    const lt = src.indexOf("<", i);
    if (lt < 0) {
      pushText(decodeEntities(src.slice(i)));
      break;
    }
    if (lt > i) pushText(decodeEntities(src.slice(i, lt)));
    if (src.startsWith("<!--", lt)) {
      const end = src.indexOf("-->", lt + 4);
      if (end < 0) throw new XmlParseError("unterminated comment");
      i = end + 3;
    } else if (src.startsWith("<![CDATA[", lt)) {
      const end = src.indexOf("]]>", lt + 9);
      if (end < 0) throw new XmlParseError("unterminated CDATA section");
      pushText(src.slice(lt + 9, end));
      i = end + 3;
    } else if (src.startsWith("<?", lt)) {
      const end = src.indexOf("?>", lt + 2);
      if (end < 0) throw new XmlParseError("unterminated processing instruction");
      i = end + 2;
    } else if (src.startsWith("<!", lt)) {
      throw new XmlParseError("DOCTYPE declarations are not accepted");
    } else if (src.startsWith("</", lt)) {
      NAME.lastIndex = lt + 2;
      const m = NAME.exec(src);
      if (!m) throw new XmlParseError("invalid closing tag");
      const end = src.indexOf(">", NAME.lastIndex);
      if (end < 0 || src.slice(NAME.lastIndex, end).trim()) throw new XmlParseError("invalid closing tag");
      const open = stack.pop();
      if (!open || open.name !== m[0]) throw new XmlParseError(`mismatched closing tag </${m[0]}>`);
      const done: XmlElement = { name: open.name, attrs: open.attrs, children: open.children };
      if (stack.length) stack[stack.length - 1].children.push(done);
      else {
        if (root) throw new XmlParseError("more than one root element");
        root = done;
      }
      i = end + 1;
    } else {
      NAME.lastIndex = lt + 1;
      const m = NAME.exec(src);
      if (!m) throw new XmlParseError("invalid start tag");
      let j = NAME.lastIndex;
      const attrs: Array<readonly [string, string]> = [];
      for (;;) {
        while (/\s/.test(src[j] ?? "")) j++;
        if (src[j] === ">" || (src[j] === "/" && src[j + 1] === ">")) break;
        NAME.lastIndex = j;
        const an = NAME.exec(src);
        if (!an) throw new XmlParseError(`invalid attribute in <${m[0]}>`);
        j = NAME.lastIndex;
        while (/\s/.test(src[j] ?? "")) j++;
        if (src[j] !== "=") throw new XmlParseError(`attribute ${an[0]} has no value`);
        j++;
        while (/\s/.test(src[j] ?? "")) j++;
        const quote = src[j];
        if (quote !== '"' && quote !== "'") throw new XmlParseError(`attribute ${an[0]} is not quoted`);
        const close = src.indexOf(quote, j + 1);
        if (close < 0) throw new XmlParseError(`unterminated attribute ${an[0]}`);
        const raw = src.slice(j + 1, close);
        if (raw.includes("<")) throw new XmlParseError(`'<' in attribute ${an[0]}`);
        // XML 1.0 §3.3.3: literal whitespace characters become spaces; character references stay.
        attrs.push([an[0], decodeEntities(raw.replace(/[\t\n]/g, " "))]);
        j = close + 1;
      }
      const selfClosing = src[j] === "/";
      const node = { name: m[0], attrs, children: [] as XmlNode[] };
      if (selfClosing) {
        const done: XmlElement = node;
        if (stack.length) stack[stack.length - 1].children.push(done);
        else {
          if (root) throw new XmlParseError("more than one root element");
          root = done;
        }
        i = j + 2;
      } else {
        if (stack.length >= MAX_DEPTH) throw new XmlParseError("XML nesting too deep");
        if (!stack.length && root) throw new XmlParseError("more than one root element");
        stack.push(node);
        i = j + 1;
      }
    }
  }
  if (stack.length) throw new XmlParseError(`unclosed element <${stack[stack.length - 1].name}>`);
  if (!root) throw new XmlParseError("no root element");
  return root;
}
