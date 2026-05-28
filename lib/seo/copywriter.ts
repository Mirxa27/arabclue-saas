/**
 * arabclue Arabic SEO & product-copy engine — Module ٠٤.
 *
 * Produces native Arabic (not machine-translated) product descriptions, meta tags,
 * and long-form blog content tuned for Google KSA. The key insight from Arabic SEO
 * practice: Google rewards original Arabic prose and penalizes translated boilerplate,
 * so every output is generated natively in Arabic from product facts — never translated.
 */
import { z } from "zod";
import { aiStructured } from "@/lib/ai/providers";
import type { Product, Dialect } from "@/lib/social/types";

export const ProductCopySchema = z.object({
  title: z.string().describe("SEO title, ≤ 60 chars, Arabic, includes the primary keyword naturally"),
  metaDescription: z.string().describe("Meta description, 140-160 chars, Arabic, with a soft CTA"),
  description: z.string().describe("Product description, 120-220 words of native Arabic prose, scannable"),
  bullets: z.array(z.string()).min(3).max(6).describe("Key feature bullets in Arabic"),
  keywords: z.array(z.string()).min(4).max(10).describe("Arabic + transliterated keywords KSA shoppers actually search"),
  altText: z.string().describe("Image alt text in Arabic")
});
export type ProductCopy = z.infer<typeof ProductCopySchema>;

export async function generateProductCopy(input: {
  product: Product;
  dialect?: Dialect;
  brandName?: string;
  tone?: string;
}): Promise<ProductCopy> {
  const dialect = input.dialect ?? "msa"; // product pages: MSA default for reach + professionalism
  const system = `
أنت كاتب SEO عربي محترف متخصص في السوق السعودي والخليجي.
اكتب محتوى عربياً أصلياً (وليس مترجماً) يتصدّر نتائج جوجل في المملكة.

قواعد:
- اكتب بـ${dialect === "khaliji" ? "لهجة سعودية دافئة" : dialect === "english" ? "الإنجليزية مع وعي ثقافي خليجي" : "العربية الفصحى الواضحة"}.
- ادمج الكلمات المفتاحية بشكل طبيعي، دون حشو.
- لا تَعِد بخصائص غير مذكورة في بيانات المنتج.
- اجعل الوصف قابلاً للمسح السريع (جُمل قصيرة).
- تجنّب أي محتوى يخالف القيم أو يذكر منتجات محظورة.
${input.brandName ? `- اسم العلامة: ${input.brandName}.` : ""}
${input.tone ? `- نبرة العلامة: ${input.tone}.` : ""}
  `.trim();

  const prompt = `
بيانات المنتج:
- الاسم: ${input.product.arabicName ?? input.product.name}
- الفئة: ${input.product.category}
- السعر: ${input.product.price} ${input.product.currency}
- وصف أولي: ${input.product.description || "(لا يوجد)"}
  `.trim();

  return aiStructured(ProductCopySchema, { system, prompt, temperature: 0.65, residency: "global" });
}

// ── Blog / topical content ───────────────────────────────────────────────────
export const BlogPostSchema = z.object({
  title: z.string(),
  slug: z.string().describe("URL slug: lowercase, hyphenated, transliterated or English"),
  metaDescription: z.string(),
  outline: z.array(z.string()).describe("H2/H3 headings in Arabic"),
  body: z.string().describe("Full article in Arabic markdown, 600-1000 words"),
  keywords: z.array(z.string()),
  internalLinkSuggestions: z.array(z.string()).describe("Anchor texts to link internally")
});
export type BlogPost = z.infer<typeof BlogPostSchema>;

/**
 * Generates a topical Arabic article. Used both for merchant stores and for arabclue.com's
 * own content moat (e.g., ZATCA Wave 24 explainers that pull in buyers).
 */
export async function generateBlogPost(input: {
  topic: string;
  primaryKeyword: string;
  audience?: string;
  dialect?: Dialect;
  brandContext?: string;
}): Promise<BlogPost> {
  const dialect = input.dialect ?? "msa";
  const system = `
أنت كاتب محتوى عربي خبير في السيو للسوق السعودي.
اكتب مقالاً عربياً أصلياً عالي الجودة، مفيداً فعلاً للقارئ، ومحسّناً لمحرّكات البحث.
- استخدم ${dialect === "khaliji" ? "لهجة سعودية ودودة" : "العربية الفصحى"}.
- ابْنِ المقال حول الكلمة المفتاحية «${input.primaryKeyword}» دون حشو.
- قدّم قيمة حقيقية: خطوات، أمثلة، إجابات واضحة.
- لا تختلق حقائق أو أرقاماً. إذا لزم رقم غير مؤكد، صِغْه بحذر.
${input.brandContext ? `- سياق العلامة: ${input.brandContext}` : ""}
  `.trim();

  const prompt = `
الموضوع: ${input.topic}
الكلمة المفتاحية الأساسية: ${input.primaryKeyword}
${input.audience ? `الجمهور المستهدف: ${input.audience}` : ""}
  `.trim();

  return aiStructured(BlogPostSchema, { system, prompt, temperature: 0.7, maxTokens: 3000 });
}
