/**
 * A tiny XML element tree with two serialisations, both written for ZATCA's hashing rules:
 *
 *   canonicalize(el)   Canonical XML 1.1 (http://www.w3.org/2006/12/xml-c14n11, inclusive, no
 *                      comments) of the subtree: namespace declarations first (default first, then
 *                      by prefix), then attributes by (namespace URI, local name); empty elements as
 *                      start/end pairs; C14N character escaping; a declaration that repeats what an
 *                      ancestor already declared is dropped.
 *   toXmlDocument(el)  `<?xml version="1.0" encoding="UTF-8"?>` + the same serialisation, except that
 *                      childless elements are self-closed (they only occur in the signature block).
 *
 * The published document is linearised (no insignificant whitespace, no comments, namespaces
 * declared where first needed), so what ZATCA's validator canonicalizes after parsing it is
 * byte-for-byte what we hash here (proved against libxml2's C14N 1.1 and ZATCA's SDK sample in
 * __tests__/zatca/canonical-hash.test.ts). Text is sanitised to XML 1.0 characters with normalised
 * line ends at construction time, so parsing cannot change it.
 *
 * C14N 1.1 differs from 1.0 only in xml:* attribute inheritance (xml:id/base/lang/space); this tree
 * never emits xml:* attributes, so the two coincide.
 */

export type XmlNode = XmlElement | string;

export type XmlElement = {
  readonly name: string;
  readonly attrs: ReadonlyArray<readonly [string, string]>;
  readonly children: ReadonlyArray<XmlNode>;
};

type AttrInput = Record<string, string | number | null | undefined> | null | undefined;
type ChildInput = XmlNode | number | null | undefined | false | ReadonlyArray<ChildInput>;

const NAME_RE = /^[A-Za-z_][A-Za-z0-9._-]*(:[A-Za-z_][A-Za-z0-9._-]*)?$/;

/** Remove characters XML 1.0 cannot carry and normalise line ends (\r\n, \r → \n). */
export function sanitizeXmlText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[^\u0009\u000A -퟿-�\u{10000}-\u{10FFFF}]/gu, "");
}

function flatten(children: ChildInput[], out: XmlNode[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) {
      flatten(c as ChildInput[], out);
      continue;
    }
    if (typeof c === "number") {
      out.push(String(c));
      continue;
    }
    if (typeof c === "string") {
      const clean = sanitizeXmlText(c);
      if (clean) out.push(clean);
      continue;
    }
    out.push(c as XmlElement);
  }
}

/** Build an element. Null/undefined attributes and children are skipped. */
export function el(name: string, attrs?: AttrInput, ...children: ChildInput[]): XmlElement {
  if (!NAME_RE.test(name)) throw new Error(`invalid XML name ${name}`);
  const list: Array<readonly [string, string]> = [];
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === null || value === undefined) continue;
    if (!NAME_RE.test(key) && !/^xmlns(:[A-Za-z_][A-Za-z0-9._-]*)?$/.test(key)) throw new Error(`invalid attribute name ${key}`);
    list.push([key, sanitizeXmlText(String(value))]);
  }
  const kids: XmlNode[] = [];
  flatten(children, kids);
  return { name, attrs: list, children: kids };
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r/g, "&#xD;");
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;")
    .replace(/\t/g, "&#x9;")
    .replace(/\n/g, "&#xA;")
    .replace(/\r/g, "&#xD;");
}

const isNsDecl = (key: string) => key === "xmlns" || key.startsWith("xmlns:");
const nsPrefix = (key: string) => (key === "xmlns" ? "" : key.slice(6));
const prefixOf = (qname: string) => (qname.includes(":") ? qname.slice(0, qname.indexOf(":")) : "");
const localOf = (qname: string) => (qname.includes(":") ? qname.slice(qname.indexOf(":") + 1) : qname);
const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function render(
  node: XmlElement,
  inScope: ReadonlyMap<string, string>,
  rendered: ReadonlyMap<string, string>,
  out: string[],
  selfCloseEmpty: boolean
): void {
  const scope = new Map(inScope);
  const declared: Array<[string, string]> = [];
  for (const [key, value] of node.attrs) {
    if (!isNsDecl(key)) continue;
    const prefix = nsPrefix(key);
    scope.set(prefix, value);
    declared.push([prefix, value]);
  }
  // Every prefix used by the element or its attributes must be in scope.
  const usedPrefixes = [prefixOf(node.name), ...node.attrs.filter(([k]) => !isNsDecl(k)).map(([k]) => prefixOf(k))];
  for (const p of usedPrefixes) {
    if (p && p !== "xml" && !scope.has(p)) throw new Error(`namespace prefix "${p}" is not declared for <${node.name}>`);
  }

  // C14N: output a namespace declaration unless the nearest rendered ancestor already has it.
  const nextRendered = new Map(rendered);
  const nsOut: Array<[string, string]> = [];
  for (const [prefix, uri] of declared) {
    if (rendered.get(prefix) === uri) continue;
    if (prefix === "" && uri === "" && !rendered.has("")) continue;
    nsOut.push([prefix, uri]);
    nextRendered.set(prefix, uri);
  }
  nsOut.sort((a, b) => byCodePoint(a[0], b[0]));

  const plain = node.attrs
    .filter(([k]) => !isNsDecl(k))
    .map(([k, v]) => {
      const p = prefixOf(k);
      const uri = p ? (p === "xml" ? "http://www.w3.org/XML/1998/namespace" : scope.get(p)!) : "";
      return { k, v, uri, local: localOf(k) };
    })
    .sort((a, b) => byCodePoint(a.uri, b.uri) || byCodePoint(a.local, b.local));

  out.push("<", node.name);
  for (const [prefix, uri] of nsOut) out.push(" ", prefix ? `xmlns:${prefix}` : "xmlns", '="', escapeAttr(uri), '"');
  for (const a of plain) out.push(" ", a.k, '="', escapeAttr(a.v), '"');
  if (selfCloseEmpty && node.children.length === 0) {
    out.push("/>");
    return;
  }
  out.push(">");
  for (const c of node.children) {
    if (typeof c === "string") out.push(escapeText(c));
    else render(c, scope, nextRendered, out, selfCloseEmpty);
  }
  out.push("</", node.name, ">");
}

/**
 * Canonical XML 1.1 of `root` treated as a document (or as an apex whose ancestors' namespaces are
 * passed in `inheritedNamespaces`, rendered on the apex as inclusive C14N requires).
 */
export function canonicalize(root: XmlElement, inheritedNamespaces: ReadonlyMap<string, string> = new Map()): string {
  const out: string[] = [];
  if (inheritedNamespaces.size) {
    // Inclusive C14N of a subtree renders every in-scope namespace on the apex.
    const declared = new Set(root.attrs.filter(([k]) => isNsDecl(k)).map(([k]) => nsPrefix(k)));
    const extra = [...inheritedNamespaces].filter(([p]) => !declared.has(p)).map(([p, uri]) => [p ? `xmlns:${p}` : "xmlns", uri] as const);
    render({ ...root, attrs: [...extra, ...root.attrs] }, new Map(), new Map(), out, false);
  } else {
    render(root, new Map(), new Map(), out, false);
  }
  return out.join("");
}

export const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';

/**
 * The published document: the canonical form, except that childless elements are written
 * self-closed (`<ds:DigestMethod Algorithm="…"/>`). Only the signature block has such elements — the
 * invoice body never does (BR-KSA-F-03) and the signature block is excluded from the invoice hash —
 * and xades:SignedProperties must read in the document exactly as ZATCA digests it (signing.ts).
 */
export function toXmlDocument(root: XmlElement): string {
  const out: string[] = [];
  render(root, new Map(), new Map(), out, true);
  return `${XML_DECLARATION}\n${out.join("")}`;
}

/**
 * Serialise a detached fragment the way a DOM serialiser writes an element extracted from a
 * document: every namespace it uses must be declared on the fragment itself (callers add them),
 * childless elements self-closed.
 */
export function serializeFragment(root: XmlElement): string {
  const out: string[] = [];
  render(root, new Map(), new Map(), out, true);
  return out.join("");
}

/** A copy of `node` without the direct children for which `drop` returns true. */
export function withoutChildren(node: XmlElement, drop: (child: XmlElement) => boolean): XmlElement {
  return { ...node, children: node.children.filter((c) => typeof c === "string" || !drop(c)) };
}

/** A copy of `node` with direct children mapped. */
export function mapChildren(node: XmlElement, fn: (child: XmlElement) => XmlElement): XmlElement {
  return { ...node, children: node.children.map((c) => (typeof c === "string" ? c : fn(c))) };
}

/** Concatenated text of an element's direct text children. */
export function textOf(node: XmlElement): string {
  return node.children.filter((c): c is string => typeof c === "string").join("");
}

export function findChild(node: XmlElement, name: string): XmlElement | undefined {
  return node.children.find((c): c is XmlElement => typeof c !== "string" && c.name === name);
}
