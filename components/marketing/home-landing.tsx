"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getSallaInstallHref } from "@/lib/marketing/install-url";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  FileText,
  Menu,
  Phone,
  Search,
  Share2,
  Store,
  X,
  Play,
  RefreshCw,
  Send,
  CheckCircle2,
  Sparkles
} from "lucide-react";

type Lang = "en" | "ar";

const copy = {
  en: {
    nav: {
      product: "AI Roles",
      how: "How to hire",
      pricing: "Pricing",
      faq: "FAQ",
      company: "About",
      login: "Log in",
      cta: "Hire Agent"
    },
    hero: {
      kicker: "Hire dedicated AI agents for Saudi & Gulf businesses",
      title: "Your custom workforce for operations and compliance.",
      titleAccent: "In Arabic. Pre-trained locally.",
      sub: "arabclue helps you skip expensive agencies or contractors. Hire highly specialized AI agents that issue ZATCA e-invoices, draft & post local-dialect social media, answer calls, and write perfect Arabic SEO content — all from one dashboard.",
      dalilNote:
        "Dalīl (دليل) means “your guide” in Arabic — your automated agent workforce showing how your business should run day to day.",
      cta1: "Hire your first agent",
      cta2: "See our AI roles",
      pills: ["AI Agents for Arabia", "Local Gulf Dialects", "ZATCA-Ready Ops"]
    },
    sandbox: {
      zatca: {
        btnIdle: "Simulate Checkout Hook",
        btnProcessing: "Running Compliance Pipeline...",
        btnDone: "Cleared ✓ Process Next Order",
        logStart: "[Salla Hook] Captured order checkout from Bayt Al-Oud Store.",
        logParse: "[Parser] Extracted Cambodian Oud (250 SAR) & Sioufi Oud (95 SAR).",
        logValidate: "[Compliance] Verified ZATCA Phase-2 invoice rules & tax splitting.",
        logSign: "[Cryptographer] Generated UUIDv4 & signed XML invoice payload.",
        logAPI: "[ZATCA Portal] Successfully submitted digital payload.",
        logSuccess: "[Success] Invoice cleared & QR code updated with signature!",
        toast: "Order #4092 cleared & reported to ZATCA! 🇸🇦"
      },
      social: {
        dialectLabel: "AI Speech Dialect",
        platforms: "Target Channels",
        btnIdle: "Approve & Publish Post",
        btnPosting: "Scheduling to TikTok, Instagram & X...",
        btnPosted: "Posted Successfully! 🎉",
        toast: "Post scheduled & published!"
      },
      voice: {
        representative: "AI Customer Representative",
        btnIdle: "Simulate Phone Call Inquiry",
        btnCalling: "Call Active...",
        btnDone: "Call Finished - Logs Saved",
        toast: "Call summary logged!"
      },
      seo: {
        retailCategory: "E-commerce Retail Category",
        keywords: "Target Keywords",
        density: "Keyword Density",
        scoreLabel: "SEO Optimization Score"
      }
    },
    audience: {
      kicker: "Modern Workforce",
      title: "Highly trained AI staff, built for Saudi & Gulf business ecosystems.",
      items: [
        {
          title: "Gulf E-commerce Shops",
          body: "Connect your storefront and let AI agents handle sales compliance, inventory descriptions, and live customer inquiries automatically."
        },
        {
          title: "Teams without an Agency",
          body: "You do not need a full marketing department. Our AI agents draft, design, schedule, and interact with DMs in your exact brand voice."
        },
        {
          title: "Saudi Regulatory Audits",
          body: "ZATCA e-invoicing is mandatory. Your compliance agent generates cryptographically signed XML invoices, UUIDs, and QR codes instantly."
        }
      ]
    },
    how: {
      kicker: "How to Hire",
      title: "Onboard your agent in three simple steps.",
      steps: [
        {
          n: "01",
          title: "Link your Business",
          body: "Connect your store or workspace. Your new agents immediately read your products, branding context, and operational policies."
        },
        {
          n: "02",
          title: "Assign AI Agent Roles",
          body: "Choose which agents to hire: compliance agents, social media marketers, voice representatives, or SEO copywriters."
        },
        {
          n: "03",
          title: "Approve and Automate",
          body: "Review drafts, invoice logs, or call recordings. Your agents run in the background 24/7; you retain final approval."
        }
      ]
    },
    section02: {
      kicker: "AI Agent Roles",
      title: "Four specialized employees. One subscription.",
      sub: "Instead of paying separate salaries or managing multiple SaaS subscriptions, hire dedicated agents built specifically for Gulf business standards."
    },
    modules: [
      {
        idx: "01",
        ar: "فاتورة",
        icon: "invoice",
        name: "ZATCA Invoicing Agent",
        tagline: "Every order, compliant by default",
        body: "Hire a ZATCA e-invoicing agent. It automatically processes Salla orders, generates cryptographically signed XML invoices, QR codes, and ensures full Fatoora compliance without manual exports.",
        bullets: ["QR + UUID on every invoice", "Audit-friendly records", "Tied to real order data"],
        deadline: "Pre-trained for KSA ZATCA Wave regulations"
      },
      {
        idx: "02",
        ar: "وسائل التواصل",
        icon: "social",
        name: "Social Media Marketer",
        tagline: "Plan, post, and reply in your dialect",
        body: "Hire a full marketing team in one agent. Pre-trained on Saudi holidays and Gulf slang, it designs gorgeous carousels, schedules posts across Instagram/TikTok, and answers DMs.",
        bullets: ["Instagram, TikTok, X, Snapchat, LinkedIn", "Pulls images from Salla", "Human handover when needed"],
        deadline: "Included from Plus plan"
      },
      {
        idx: "03",
        ar: "صوت",
        icon: "voice",
        name: "Arabic Voice Representative",
        tagline: "Your phone lines answered 24/7 in Saudi dialect",
        body: "Hire a call center agent that speaks natural Saudi Arabic. It answers FAQs, checks order status from Salla, and routes complex inquiries to humans when needed.",
        bullets: ["Gulf dialect by default", "Order lookup from Salla", "Call summaries in dashboard"],
        deadline: "Uses your business phone number"
      },
      {
        idx: "04",
        ar: "محتوى",
        icon: "seo",
        name: "Arabic SEO & Copy Specialist",
        tagline: "High-ranking Arabic product copy",
        body: "Hire a native copywriter. It writes perfect, search-optimized product titles, descriptions, and meta tags natively in Arabic so you rank top on Google Saudi.",
        bullets: ["Per-product or bulk runs", "Matches your brand voice", "No copy-paste from ChatGPT"],
        deadline: "Unlimited on Pro"
      }
    ],
    socialFeature: {
      kicker: "Inside social",
      title: "Five specialists. One content pipeline.",
      sub: "You are not buying “AI posts.” You get a small team that understands your catalog and calendar.",
      agents: [
        { role: "Planner", does: "Builds a 30-day grid from your products, promos, and Saudi holidays." },
        { role: "Copywriter", does: "Writes captions in the dialect you chose — casual Khaliji or formal MSA." },
        { role: "Designer", does: "Layouts carousels using your product photos and brand colors." },
        { role: "Scheduler", does: "Publishes on time across the channels you connected." },
        { role: "Engager", does: "Replies to comments and DMs; flags sensitive threads for you." }
      ]
    },
    pricing: {
      kicker: "Pricing",
      title: "Simple SAR plans. Billed through your Salla flow.",
      sub: "No hidden setup fee. Upgrade or downgrade when your shop grows.",
      plans: [
        {
          name: "Lite",
          audience: "Compliance Agent only",
          price: "99",
          unit: "SAR / month",
          features: ["ZATCA e-invoicing agent", "200 invoices / month", "Arabic dashboard", "Email support"]
        },
        {
          name: "Plus",
          audience: "Growing enterprises",
          price: "299",
          unit: "SAR / month",
          highlight: true,
          features: [
            "Everything in Lite",
            "Social agents (3 platforms)",
            "500 voice minutes / month",
            "100 product descriptions",
            "Priority support"
          ]
        },
        {
          name: "Pro",
          audience: "Full automation workforce",
          price: "599",
          unit: "SAR / month",
          features: [
            "Everything in Plus",
            "All 5 social platforms",
            "2,000 voice minutes",
            "Unlimited SEO descriptions",
            "WhatsApp Business AI",
            "Wathq company enrichment"
          ]
        }
      ]
    },
    faq: {
      kicker: "Questions",
      title: "Straight answers",
      items: [
        {
          q: "Do I need a commercial registration (CR) to start?",
          a: "No. You can install from Salla and explore the dashboard. ZATCA invoicing needs your VAT details when you are ready to go live."
        },
        {
          q: "What is ZATCA Wave 24?",
          a: "Saudi tax authority phases that require more businesses to issue structured e-invoices. If your revenue crossed the threshold, Fatoora integration is mandatory — arabclue handles the technical side per order."
        },
        {
          q: "Is customer data safe (PDPL)?",
          a: "Yes. We use encrypted storage, merchant-level isolation, and a data processing agreement at onboarding. You control exports and disconnect anytime."
        },
        {
          q: "Does it replace my accountant?",
          a: "No. arabclue produces compliant invoice files and records. Your accountant still reviews reports and filings — we remove the manual stamping work."
        },
        {
          q: "Can I use Arabic and English?",
          a: "Yes. Social, voice, and SEO support Khaliji, MSA, and English. Your dashboard is Arabic-first with English where needed."
        }
      ]
    },
    ctaBand: {
      title: "Ready to automate how your business runs?",
      sub: "Install on Salla in minutes. Connect your store and hire your first custom agent.",
      btn: "Start with Salla"
    },
    footer: {
      tag: "Your AI workforce for Saudi and GCC businesses",
      built: "Built in Riyadh & Jeddah for Vision 2030.",
      cols: {
        product: ["Product", ["Modules", "ZATCA", "Social", "Voice", "Pricing"]],
        company: ["Company", ["About", "Manifesto", "Careers", "Press"]],
        legal: ["Legal", ["PDPL", "Terms", "Privacy", "Maroof"]]
      }
    },
    stats: [
      { n: "1.7M", label: "Active commercial registrations in KSA" },
      { n: "8.2B+", label: "ZATCA e-invoices processed annually" },
      { n: "68K+", label: "Merchants on Salla" }
    ]
  },
  ar: {
    nav: {
      product: "الوكلاء الرقميون",
      how: "كيفية التوظيف",
      pricing: "الباقات",
      faq: "أسئلة شائعة",
      company: "من نحن",
      login: "دخول",
      cta: "وظّف وكيلاً"
    },
    hero: {
      kicker: "وظّف وكلاء ذكاء اصطناعي لإدارة وتنمية أعمالك في الخليج",
      title: "قوتك العاملة الذكية للمحاسبة والتسويق والصوت.",
      titleAccent: "بالعربية. مدربون محلياً.",
      sub: "أرب كلو يساعد المتاجر والشركات على الاستغناء عن الوكالات المكلفة وتشتيت العمل. وظّف وكلاء ذكاء اصطناعي متخصصين لإصدار فواتير زاتكا، وإدارة حسابات التواصل، والرد على المكالمات، وتحسين سيو المنتجات 24/7.",
      dalilNote: "«دليل» يعني قوتك العاملة المؤتمتة — المكان الذي يوضّح كيف يجب أن تدار أعمالك يومياً.",
      cta1: "وظّف وكيلك الأول",
      cta2: "شاهد التخصصات",
      pills: ["توظيف بضغطة زر", "لهجات محلية أصيلة", "امتثال تام للأنظمة"]
    },
    sandbox: {
      zatca: {
        btnIdle: "محاكاة معالجة طلب شراء",
        btnProcessing: "توقيع الفاتورة وتعميدها...",
        btnDone: "تم الاعتماد ✓ معالجة الطلب التالي",
        logStart: "[سلة] التقاط طلب شراء جديد من متجر بيت العود.",
        logParse: "[المحلل] استخراج دهن عود سيوفي (٩٥ ر.س) وبخور كمبودي (٢٥٠ ر.س).",
        logValidate: "[الامتثال] فحص متطلبات زاتكا وتقسيم ضريبة القيمة المضافة.",
        logSign: "[التشفير] توليد الرقم الفريد وتوقيع حمولة XML بمفتاح التاجر الخاص.",
        logAPI: "[بوابة زاتكا] تم إرسال ملف الفاتورة المعتمد رقمياً.",
        logSuccess: "[نجاح] تم تعميد الفاتورة وتشفير الباركود بنجاح!",
        toast: "تم اعتماد الفاتورة وإبلاغ هيئة الزكاة والضريبة والجمارك! 🇸🇦"
      },
      social: {
        dialectLabel: "لهجة الموظف الذكي",
        platforms: "المنصات المستهدفة",
        btnIdle: "موافقة ونشر المنشور",
        btnPosting: "جاري الجدولة على تيك توك، إنستقرام وإكس...",
        btnPosted: "تم النشر بنجاح! 🎉",
        toast: "تم جدولة ونشر المنشور بنجاح!"
      },
      voice: {
        representative: "ممثل خدمة العملاء الذكي",
        btnIdle: "محاكاة مكالمة هاتفية واردة",
        btnCalling: "مكالمة نشطة...",
        btnDone: "اكتملت المكالمة - تم حفظ الملخص",
        toast: "تم حفظ ملخص المكالمة بنجاح!"
      },
      seo: {
        retailCategory: "تصنيف متجر التجزئة",
        keywords: "الكلمات المفتاحية المستهدفة",
        density: "كثافة الكلمات المفتاحية",
        scoreLabel: "درجة تحسين السيو"
      }
    },
    audience: {
      kicker: "قوة عاملة حديثة",
      title: "موظفون افتراضيون مدربون طبقاً لمعايير وأنظمة بيئة الأعمال الخليجية.",
      items: [
        { title: "متاجر التجزئة الخليجية", body: "اربط متجرك ودع وكلاء الذكاء الاصطناعي يتولون المحاسبة، وتنسيق المنتجات، والاستعلامات تلقائياً." },
        { title: "الشركات بدون وكالات تسويق", body: "استغنِ عن الوكالات المكلفة. وكلاؤنا يخططون، ويصممون، ويتفاعلون مع مجتمعك بصوت علامتك التجاري الفريد." },
        { title: "الشركات أمام مواعيد زاتكا", body: "وكلاؤنا مدربون مسبقاً على لوائح الامتثال المحلية (زاتكا)، وموجات الفوترة الإلكترونية، وإصدار ملفات XML فورياً." }
      ]
    },
    how: {
      kicker: "كيفية التوظيف",
      title: "ابدأ بتوظيف وكلائك في ثلاث خطوات بسيطة.",
      steps: [
        { n: "٠١", title: "اربط عملك", body: "اربط متجرك أو مساحة عملك. يقرأ وكلاؤك الجدد كتالوج المنتجات، وسياق علامتك التجارية، وسياسات التشغيل." },
        { n: "٠٢", title: "حدد أدوار وكلائك", body: "اختر الموظفين المناسبين: وكيل الفوترة، أو مسوق قنوات التواصل، أو وكيل الصوت والدعم، أو خبير السيو." },
        { n: "٠٣", title: "تابع ووافق وتوسّع", body: "شاهد المسودات والفواتير وملخصات المكالمات. يعمل الوكلاء في الخلفية وأنت تبقى مسيطراً بالكامل." }
      ]
    },
    section02: {
      kicker: "تخصصات الوكلاء",
      title: "أربعة موظفين متخصصين. اشتراك واحد.",
      sub: "بدلاً من إدارة فرق عمل متعددة أو دفع رواتب مكلفة، وظّف وكلاء مخصصين ومدربين طبقاً لمعايير الأعمال الخليجية."
    },
    modules: [
      {
        idx: "٠١",
        ar: "فاتورة",
        icon: "invoice",
        name: "وكيل فوترة زاتكا",
        tagline: "كل طلب متوافق تلقائياً",
        body: "وظّف وكيل الفوترة الإلكترونية المتوافق مع زاتكا. ينشئ فواتير إلكترونية بـQR وXML من طلبات سلة تلقائياً دون تدخل يدوي.",
        bullets: ["QR وUUID لكل فاتورة", "سجلات قابلة للتدقيق", "مرتبطة ببيانات الطلب الحقيقية"],
        deadline: "متوافق مع أحدث لوائح وموجات زاتكا"
      },
      {
        idx: "٠٢",
        ar: "وسائل التواصل",
        icon: "social",
        name: "مسوق قنوات التواصل",
        tagline: "خطط وانشر وردّ بلهجتك",
        body: "وظّف فريق تسويق كامل في وكيل واحد. يكتب التعليقات ويصمم الكاروسلات باللهجة الخليجية، ويجدول المنشورات ويرد على الرسائل.",
        bullets: ["إنستغرام، تيك توك، إكس، سناب، لينكدإن", "صور من سلة", "تحويل للبشر عند الحاجة"],
        deadline: "متاح ابتداءً من الباقة الفضية"
      },
      {
        idx: "٠٣",
        ar: "صوت",
        icon: "voice",
        name: "ممثل الصوت والدعم العربي",
        tagline: "خط متجرك — يُجاب ٢٤/٧",
        body: "وظّف وكيل مركز اتصال يجيب بعربية سعودية طبيعية. يستعلم عن الطلبات ويرد على الأسئلة الشائعة ويحوّل للعملاء عند الحاجة.",
        bullets: ["لهجة خليجية افتراضياً", "استعلام الطلبات من سلة", "ملخصات في اللوحة"],
        deadline: "يعمل مباشرة على رقم هاتفك الحالي"
      },
      {
        idx: "٠٤",
        ar: "محتوى",
        icon: "seo",
        name: "أخصائي السيو والنسخ العربي",
        tagline: "نصوص يفهمها جوجل السعودي",
        body: "وظّف كاتب محتوى محلي. يكتب عناوين وأوصاف منتجات وسيو عربي أصيل لكتالوجك ليضمن تصدر متجرك في نتائج البحث.",
        bullets: ["لكل منتج أو دفعات", "يتوافق مع صوت علامتك", "بدون نسخ من أدوات عامة"],
        deadline: "أوصاف غير محدودة في باقة برو"
      }
    ],
    socialFeature: {
      kicker: "داخل التواصل",
      title: "خمسة متخصصين. مسار محتوى واحد.",
      sub: "أنت لا تشتري «منشورات ذكاء اصطناعي» فقط — بل فريقاً صغيراً يفهم كتالوجك وتقويمك.",
      agents: [
        { role: "المخطّط", does: "يبني شبكة ٣٠ يوماً من منتجاتك وعروضك والمناسبات السعودية." },
        { role: "الكاتب", does: "يكتب التعليقات باللهجة التي اخترتها — خليجية أو فصحى." },
        { role: "المصمم", does: "يركّب كاروسلات بصور منتجاتك وألوان علامتك." },
        { role: "المجدول", does: "ينشر في الوقت على القنوات التي ربطتها." },
        { role: "المجيب", does: "يرد على التعليقات والرسائل؛ يُبلّغك بالحالات الحساسة." }
      ]
    },
    pricing: {
      kicker: "الباقات",
      title: "باقات بالريال. فوترة عبر سلة.",
      sub: "بدون رسوم إعداد مخفية. غيّر الباقة عندما ينمو متجرك.",
      plans: [
        { name: "لايت", audience: "وكيل الفوترة فقط", price: "٩٩", unit: "ريال / شهر", features: ["وكيل فوترة زاتكا", "٢٠٠ فاتورة / شهر", "لوحة عربية", "دعم بريد"] },
        { name: "بلس", audience: "للشركات النامية", price: "٢٩٩", unit: "ريال / شهر", highlight: true, features: ["كل لايت", "وكلاء تواصل (٣ منصات)", "٥٠٠ دقيقة صوت", "١٠٠ وصف منتج", "دعم أولوية"] },
        { name: "برو", audience: "أتمتة كاملة للأعمال", price: "٥٩٩", unit: "ريال / شهر", features: ["كل بلس", "كل المنصات", "٢٠٠٠ دقيقة صوت", "أوصاف غير محدودة", "واتساب أعمال", "إثراء واثق"] }
      ]
    },
    faq: {
      kicker: "أسئلة",
      title: "إجابات مباشرة",
      items: [
        { q: "هل أحتاج سجلاً تجارياً للبدء؟", a: "لا. يمكنك التثبيت من سلة واستكشاف اللوحة. الفوترة تحتاج بيانات ضريبتك عند التشغيل الفعلي." },
        { q: "ما هي موجة زاتكا ٢٤؟", a: "مراحل تفرض على المزيد من المنشآت إصدار فواتير إلكترونية منظمة. إذا تجاوزت الحد، ربط فاتورة إلزامي — أرب كلو يتولى الجانب التقني لكل طلب." },
        { q: "هل بيانات العملاء آمنة (PDPL)؟", a: "نعم. تخزين مشفّر وعزل لكل تاجر واتفاقية معالجة عند التسجيل. يمكنك التصدير أو الفصل في أي وقت." },
        { q: "هل يستبدل المحاسب؟", a: "لا. أرب كلو يُنتج ملفات فواتير متوافقة. محاسبك يراجع التقارير — نحن نزيل العمل اليدوي للختم." },
        { q: "هل يدعم العربية والإنجليزية؟", a: "نعم. التواصل والصوت وSEO يدعمون الخليجية والفصحى والإنجليزية. اللوحة عربية أولاً." }
      ]
    },
    ctaBand: {
      title: "جاهز لأتمتة أعمال متجرك بالكامل؟",
      sub: "ثبّت على سلة خلال دقائق. اربط متجرك ووظّف وكيلك المخصص الأول.",
      btn: "ابدأ مع سلة"
    },
    footer: {
      tag: "فريق ذكاء اصطناعي متكامل لإدارة الأعمال الخليجية والعربية",
      built: "صُنع في الرياض وجدة لرؤية ٢٠٣٠.",
      cols: {
        product: ["المنتج", ["الوحدات", "زاتكا", "التواصل", "الصوت", "الأسعار"]],
        company: ["الشركة", ["من نحن", "الرؤية", "وظائف", "الإعلام"]],
        legal: ["القانوني", ["PDPL", "الشروط", "الخصوصية", "معروف"]]
      }
    },
    stats: [
      { n: "١٫٧ مليون", label: "سجل تجاري نشط في المملكة" },
      { n: "+٨ مليار", label: "فاتورة إلكترونية سنوياً عبر زاتكا" },
      { n: "+٦٨ ألف", label: "تاجر على سلة" }
    ]
  }
};

const moduleIcons = {
  invoice: FileText,
  social: Share2,
  voice: Phone,
  seo: Search
} as const;

const socialDrafts = {
  en: {
    khaliji: "Authentic Cambodian Oud incense that diffuses pure elegance and prestige ✨ Available now for direct checkout. Order now for delivery in hours! 🇸🇦📦 #BaytAlOud",
    najdi: "Welcome to Bayt Al-Oud! Pure Cambodian Oud that stands out. Available now across Riyadh and Qassim branches. Order now and expect fast delivery today! 🇸🇦🐪 #BaytAlOud",
    hijazi: "Ahlan wasahlan! Cambodian Oud scent is something else! Full of prestige and fixes your mood 😍 Available now in Jeddah & Makkah. Order now and it arrives in a flash! 🌊🇸🇦",
    msa: "The authentic Cambodian Oud fragrance embodies Arabic luxury and elegance ✨ Available now for direct order via our online catalog for all regions in Saudi Arabia and the GCC. Order now."
  },
  ar: {
    khaliji: "عطر العود الكمبودي الأصيل يفوح بالفخامة والأناقة ✨ متوفر الآن للطلب المباشر في جميع فروعنا بالمملكة والخليج. اطلبه الحين ويوصلك في ساعات! 🇸🇦📦 #بيت_العود #العود_الفاخر",
    najdi: "يا هلا بالعود الكمبودي اللي يجمد على الجرح ولحاله سالفة! 🤎 متوفر الحين بجميع فروعنا بالرياض والقصيم، اطلبه الحين ويبشر بسعدك يوصلك اليوم! 🇸🇦🐪 #بيت_العود",
    hijazi: "يا بويا عطر العود الكمبودي دا شي تاني! ريحة تفوح فخامة وتعدل المزاج 😍 متوفر دحين في فروعنا بجدة ومكة. اطلبه دحين ويوصلك إلين عندك بلمح البصر! 🌊🇸🇦",
    msa: "عطر العود الكمبودي الأصيل يجسد الفخامة والأناقة العربية ✨ متوفر الآن للطلب المباشر عبر موقعنا الإلكتروني لجميع أنحاء المملكة والخليج العربي. اطلبه الآن ليصلك خلال ساعات."
  }
} as const;

const seoMockData = {
  en: {
    oud: {
      title: "Luxury Oud & Incense Fragrances in Saudi Arabia | Bayt Al-Oud",
      url: "https://baytaloud.com/collections/oud",
      desc: "Shop authentic Cambodian Oud and natural incense in KSA & GCC. Exclusive offers and fast shipping to all regions. Quality you can trust.",
      keywords: "Cambodian Oud, natural incense, luxury perfume",
      density: "4.5%",
      score: 98
    },
    coffee: {
      title: "Authentic Arabic Coffee & Cardamom Blend | Golden Roast",
      url: "https://goldenroast.com.sa/collections/coffee",
      desc: "Enjoy the rich taste of traditional Saudi Arabic coffee blended with natural saffron and premium cardamom. Freshly roasted and ground daily.",
      keywords: "Arabic coffee, premium cardamom, Saudi coffee",
      density: "3.8%",
      score: 95
    },
    dates: {
      title: "Premium Khalas Al-Ahsa Dates & Eid Sweets | Palm Oasis",
      url: "https://palmoasis.com/collections/dates",
      desc: "Buy natural premium organic dates sourced from the finest farms of Al-Ahsa. Express home delivery across all Gulf cities. Order now.",
      keywords: "Khalas dates, organic dates, premium sweets",
      density: "4.2%",
      score: 97
    }
  },
  ar: {
    oud: {
      title: "عطور العود والبخور الفاخرة في السعودية | بيت العود",
      url: "https://baytaloud.com/collections/oud",
      desc: "تسوق عود طبيعي فاخر وبخور كمبودي أصيل في المملكة والخليج. عروض حصرية وتوصيل سريع لجميع المناطق. الجودة العالية التي تثق بها.",
      keywords: "بخور كمبودي, عود طبيعي, عطور فاخرة",
      density: "٤.٥٪",
      score: 98
    },
    coffee: {
      title: "القهوة العربية والهيل الزعفراني الأصيل | حمصة ذهبية",
      url: "https://goldenroast.com.sa/collections/coffee",
      desc: "استمتع بالمذاق الغني للقهوة العربية السعودية التقليدية المخلوطة بالزعفران الطبيعي والهيل الفاخر. محمصة ومطحونة طازجة يومياً.",
      keywords: "قهوة عربية, هيل زعفران, قهوة سعودية",
      density: "٣.٨٪",
      score: 95
    },
    dates: {
      title: "تمور خلاص الأحساء وحلويات العيد الفاخرة | واحة النخيل",
      url: "https://palmoasis.com/collections/dates",
      desc: "اشترِ تمور خلاص الأحساء العضوية الطبيعية الفاخرة المستخلصة من أجود مزارع النخيل. توصيل سريع ومباشر لجميع مدن الخليج.",
      keywords: "خلاص الأحساء, تمور فاخرة, حلويات العيد",
      density: "٤.٢٪",
      score: 97
    }
  }
} as const;

type HomeLandingProps = {
  initialLang?: Lang;
};

export function HomeLanding({ initialLang = "en" }: HomeLandingProps) {
  const [lang, setLang] = useState<Lang>(initialLang);
  const [menuOpen, setMenuOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [activeSandboxTab, setActiveSandboxTab] = useState<"invoice" | "social" | "voice" | "seo">("invoice");
  const t = copy[lang];
  const isAr = lang === "ar";
  const installHref = getSallaInstallHref();
  const installExternal = installHref.startsWith("http");

  const [billingCycle, setBillingCycle] = useState<"monthly" | "yearly">("monthly");

  // ZATCA simulation state
  const [zatcaState, setZatcaState] = useState<"idle" | "processing" | "done">("idle");
  const [zatcaLogs, setZatcaLogs] = useState<string[]>([]);
  const [zatcaOrderNum, setZatcaOrderNum] = useState(4092);

  // Social simulation state
  const [socialDialect, setSocialDialect] = useState<"khaliji" | "najdi" | "hijazi" | "msa">("khaliji");
  const [socialState, setSocialState] = useState<"idle" | "posting" | "posted">("idle");

  // Voice simulation state
  const [voiceState, setVoiceState] = useState<"idle" | "calling" | "done">("idle");
  const [voiceSeconds, setVoiceSeconds] = useState(0);
  const [voiceRevealCount, setVoiceRevealCount] = useState(0);

  // SEO simulation state
  const [seoCategory, setSeoCategory] = useState<"oud" | "coffee" | "dates">("oud");

  // Simulation handlers
  const runZatcaSimulation = () => {
    if (zatcaState === "processing") return;
    if (zatcaState === "done") {
      setZatcaState("idle");
      setZatcaLogs([]);
      return;
    }
    setZatcaState("processing");
    setZatcaLogs([t.sandbox.zatca.logStart]);

    setTimeout(() => {
      setZatcaLogs(prev => [...prev, t.sandbox.zatca.logParse]);
    }, 600);

    setTimeout(() => {
      setZatcaLogs(prev => [...prev, t.sandbox.zatca.logValidate]);
    }, 1200);

    setTimeout(() => {
      setZatcaLogs(prev => [...prev, t.sandbox.zatca.logSign]);
    }, 1800);

    setTimeout(() => {
      setZatcaLogs(prev => [...prev, t.sandbox.zatca.logAPI]);
    }, 2400);

    setTimeout(() => {
      setZatcaLogs(prev => [...prev, t.sandbox.zatca.logSuccess]);
      setZatcaState("done");
      setZatcaOrderNum(prev => prev + 1);
    }, 3000);
  };

  const runSocialSimulation = () => {
    if (socialState === "posting") return;
    if (socialState === "posted") {
      setSocialState("idle");
      return;
    }
    setSocialState("posting");
    setTimeout(() => {
      setSocialState("posted");
    }, 1800);
  };

  const runVoiceSimulation = () => {
    if (voiceState === "calling") return;
    if (voiceState === "done") {
      setVoiceState("idle");
      setVoiceSeconds(0);
      setVoiceRevealCount(0);
      return;
    }
    setVoiceState("calling");
    setVoiceSeconds(0);
    setVoiceRevealCount(0);

    const timer = setInterval(() => {
      setVoiceSeconds(prev => prev + 1);
    }, 1000);

    setTimeout(() => { setVoiceRevealCount(1); }, 1000);
    setTimeout(() => { setVoiceRevealCount(2); }, 3500);
    setTimeout(() => { setVoiceRevealCount(3); }, 6000);
    setTimeout(() => { setVoiceRevealCount(4); }, 8500);

    setTimeout(() => {
      clearInterval(timer);
      setVoiceState("done");
    }, 11000);
  };

  const getPlanPriceAndUnit = (planName: string, cycle: "monthly" | "yearly", isAr: boolean) => {
    if (planName === "Lite" || planName === "لايت") {
      return {
        price: cycle === "monthly" ? "99" : "79",
        unit: cycle === "monthly" 
          ? (isAr ? "ريال / شهر" : "SAR / month")
          : (isAr ? "ريال / شهر (دفع سنوي)" : "SAR / month (billed annually)"),
        billedNote: cycle === "yearly" 
          ? (isAr ? "948 ريال تدفع سنوياً" : "948 SAR billed annually") 
          : null
      };
    } else if (planName === "Plus" || planName === "بلس") {
      return {
        price: cycle === "monthly" ? "299" : "239",
        unit: cycle === "monthly" 
          ? (isAr ? "ريال / شهر" : "SAR / month")
          : (isAr ? "ريال / شهر (دفع سنوي)" : "SAR / month (billed annually)"),
        billedNote: cycle === "yearly" 
          ? (isAr ? "2,868 ريال تدفع سنوياً" : "2,868 SAR billed annually") 
          : null
      };
    } else {
      return {
        price: cycle === "monthly" ? "599" : "479",
        unit: cycle === "monthly" 
          ? (isAr ? "ريال / شهر" : "SAR / month")
          : (isAr ? "ريال / شهر (دفع سنوي)" : "SAR / month (billed annually)"),
        billedNote: cycle === "yearly" 
          ? (isAr ? "5,748 ريال تدفع سنوياً" : "5,748 SAR billed annually") 
          : null
      };
    }
  };

  useEffect(() => {
    document.documentElement.lang = isAr ? "ar" : "en";
  }, [isAr]);

  useEffect(() => {
    if (menuOpen) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  const navLinks = [
    { href: "#product", label: t.nav.product },
    { href: "#how", label: t.nav.how },
    { href: "#pricing", label: t.nav.pricing },
    { href: "#faq", label: t.nav.faq },
    { href: "/about", label: t.nav.company }
  ];

  return (
    <main dir={isAr ? "rtl" : "ltr"} className={isAr ? "ar" : ""}>
      <header className="border-b border-rule/50 bg-paper/85 backdrop-blur-md sticky top-0 z-50 shadow-[0_2px_15px_rgba(20,17,15,0.03)]">
        <div className="mx-auto max-w-[1400px] px-5 sm:px-6 lg:px-10 h-16 flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2.5 shrink-0">
            <Logo />
            <span className="font-display text-[22px] tracking-tightest leading-none">arabclue</span>
          </Link>

          <nav className="hidden lg:flex items-center gap-7 text-sm text-ink-soft">
            {navLinks.map((l) => (
              <a key={l.href} href={l.href} className="hover:text-ink transition-colors">
                {l.label}
              </a>
            ))}
          </nav>

          <div className="hidden md:flex items-center gap-3">
            <button
              type="button"
              onClick={() => setLang(lang === "en" ? "ar" : "en")}
              className="font-mono text-xs uppercase tracking-widest border border-ink/15 px-2.5 py-1.5 rounded-lg hover:border-ink/40 transition touch-target"
              aria-label="Switch language"
            >
              {lang === "en" ? "ع · AR" : "EN · ع"}
            </button>
            <Link href="/login" className="text-sm text-ink-soft hover:text-ink px-2">
              {t.nav.login}
            </Link>
            <a
              href={installHref}
              {...(installExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              className="button-primary text-xs"
            >
              {t.nav.cta} <ArrowUpRight size={14} />
            </a>
          </div>

          <button
            type="button"
            className="md:hidden p-2.5 rounded-xl border border-rule/70 touch-target"
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
          >
            <Menu size={20} />
          </button>
        </div>

        {menuOpen && (
          <div className="fixed inset-0 z-[60] md:hidden">
            <button type="button" className="absolute inset-0 bg-ink/40" onClick={() => setMenuOpen(false)} aria-label="Close menu" />
            <div className="absolute top-0 inset-x-0 bg-paper border-b border-rule shadow-glass-lg p-6 pb-8 animate-slide-up max-h-[85vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-6">
                <span className="font-display text-xl">arabclue</span>
                <button type="button" onClick={() => setMenuOpen(false)} className="p-2 rounded-lg border border-rule touch-target" aria-label="Close">
                  <X size={18} />
                </button>
              </div>
              <nav className="flex flex-col gap-1">
                {navLinks.map((l) => (
                  <a
                    key={l.href}
                    href={l.href}
                    onClick={() => setMenuOpen(false)}
                    className="py-3 text-lg border-b border-rule/40"
                  >
                    {l.label}
                  </a>
                ))}
                <Link href="/login" onClick={() => setMenuOpen(false)} className="py-3 text-lg text-ink-soft">
                  {t.nav.login}
                </Link>
              </nav>
              <div className="mt-6 flex flex-col gap-3">
                <button
                  type="button"
                  onClick={() => setLang(lang === "en" ? "ar" : "en")}
                  className="button-ghost w-full justify-center"
                >
                  {lang === "en" ? "العربية" : "English"}
                </button>
                <a href={installHref} className="button-primary w-full justify-center" {...(installExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
                  {t.nav.cta} <ArrowUpRight size={16} />
                </a>
              </div>
            </div>
          </div>
        )}
      </header>

      {/* HERO */}
      <section className="relative overflow-hidden pt-10 pb-20 lg:pt-20 lg:pb-28">
        {/* Luminous Background Grid and Accents */}
        <div className="absolute inset-0 bg-grid-mesh opacity-[0.25] pointer-events-none" />
        <div className="absolute top-[10%] left-[20%] w-[35rem] h-[35rem] bg-accent/5 rounded-full blur-[100px] pointer-events-none" />
        <div className="absolute bottom-[20%] right-[10%] w-[30rem] h-[30rem] bg-accent-warm/5 rounded-full blur-[90px] pointer-events-none" />
        
        <div className="relative mx-auto max-w-[1400px] px-5 sm:px-6 lg:px-10">
          <div className="grid lg:grid-cols-12 gap-12 lg:gap-16 items-center">
            
            {/* Left: Copy & Actions */}
            <div className="lg:col-span-6 reveal">
              <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono uppercase tracking-wider bg-accent/10 border border-accent/20 text-accent mb-6 animate-pulse-soft">
                ⚡ {t.hero.kicker}
              </span>
              <h1 className={`display-1 text-[clamp(2.25rem,5.5vw,4.25rem)] leading-[1.05] ${isAr ? "arabic-display font-normal" : ""}`}>
                {t.hero.title}
                <span className="block mt-2 text-accent">{t.hero.titleAccent}</span>
              </h1>
              <p className={`mt-6 max-w-[36rem] text-base sm:text-lg leading-relaxed text-ink-soft ${isAr ? "arabic-display font-light" : ""}`}>
                {t.hero.sub}
              </p>
              <p className={`mt-4 max-w-[36rem] text-xs sm:text-sm leading-relaxed text-ink-mute border-s-2 border-accent/25 ps-4 ${isAr ? "arabic-display font-light" : ""}`}>
                {t.hero.dalilNote}
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                {t.hero.pills.map((pill) => (
                  <span key={pill} className="landing-pill">
                    {pill}
                  </span>
                ))}
              </div>
              <div className="mt-8 flex flex-wrap gap-3" id="install">
                <a href={installHref} {...(installExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})} className="button-primary font-semibold">
                  {t.hero.cta1} <ArrowUpRight size={16} />
                </a>
                <a href="#product" className="button-ghost font-medium">
                  {t.hero.cta2} <ChevronDown size={16} />
                </a>
              </div>
            </div>

            {/* Right: Stateful AI Agent Sandbox Workspace */}
            <div className="lg:col-span-6 reveal" style={{ animationDelay: "150ms" }}>
              <div className="w-full rounded-2xl glass-heavy border border-rule/35 shadow-glass-xl overflow-hidden glow-border-accent transition-all duration-500">
                
                {/* Safari Browser Title Bar */}
                <div className="flex items-center justify-between px-4 py-3 bg-paper-deep/20 border-b border-rule/25">
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-400/80 border border-red-500/10" />
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-400/80 border border-amber-500/10" />
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/80 border border-emerald-500/10" />
                  </div>
                  <span className="text-[10px] font-mono text-ink-mute/70 tracking-crisp flex items-center gap-1.5 bg-paper/35 px-4 py-1 rounded-lg border border-rule/15 max-w-[200px] truncate sm:max-w-none">
                    <Store size={10} className="text-accent" /> arabclue.com/agents
                  </span>
                  <div className="w-10" />
                </div>

                {/* Workspace Tabs Selector */}
                <div className="grid grid-cols-4 gap-0.5 p-1 bg-paper-deep/10 border-b border-rule/20">
                  {[
                    { id: "invoice" as const, label: isAr ? "زاتكا" : "ZATCA", icon: FileText },
                    { id: "social" as const, label: isAr ? "سوشال" : "Social", icon: Share2 },
                    { id: "voice" as const, label: isAr ? "صوت" : "Voice", icon: Phone },
                    { id: "seo" as const, label: isAr ? "سيو" : "SEO", icon: Search },
                  ].map((tab) => {
                    const TabIcon = tab.icon;
                    const active = activeSandboxTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveSandboxTab(tab.id)}
                        className={`flex flex-col sm:flex-row items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-semibold tracking-crisp transition-all duration-300 touch-target ${
                          active
                            ? "bg-paper text-accent shadow-glass-sm border border-rule/30"
                            : "text-ink-mute hover:text-ink hover:bg-paper/35"
                        }`}
                      >
                        <TabIcon size={12} className={active ? "text-accent" : "text-ink-mute"} />
                        <span>{tab.label}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Dynamic Workspace Area */}
                <div className="p-5 min-h-[360px] flex flex-col justify-between bg-paper/40 relative">
                  
                  {/* TAB 1: ZATCA Compliance */}
                  {activeSandboxTab === "invoice" && (
                    <div className="grid sm:grid-cols-12 gap-4 flex-1 animate-scale-in">
                      
                      {/* Left: Invoice Receipt Card */}
                      <div className="sm:col-span-6 p-4 rounded-xl border border-rule/50 bg-paper/65 shadow-glass-sm flex flex-col justify-between min-h-[240px]">
                        <div>
                          <div className="flex items-center justify-between border-b border-rule/30 pb-2 mb-2">
                            <div>
                              <p className="font-display text-[15px] font-bold text-ink">بيت العود الفاخر</p>
                              <p className="text-[9px] font-mono text-ink-mute">Bayt Al-Oud Saudi</p>
                            </div>
                            <span className={`px-2 py-0.5 rounded text-[8px] font-mono uppercase tracking-wider border ${
                              zatcaState === "done" 
                                ? "bg-success/15 text-success border-success/20" 
                                : zatcaState === "processing"
                                ? "bg-accent-warm/15 text-accent-warm border-accent-warm/20 animate-pulse-soft"
                                : "bg-ink/5 text-ink-mute border-rule/40"
                            }`}>
                              {zatcaState === "done" ? (isAr ? "معتمد ✓" : "Cleared ✓") : zatcaState === "processing" ? (isAr ? "جاري التعميد..." : "Validating...") : (isAr ? "معلق" : "Pending")}
                            </span>
                          </div>
                          
                          <div className="space-y-1 my-2">
                            <div className="flex justify-between text-[11px]">
                              <span className="text-ink-soft">1x بخور كمبودي</span>
                              <span className="font-mono text-ink">250.00 SAR</span>
                            </div>
                            <div className="flex justify-between text-[11px]">
                              <span className="text-ink-soft">1x دهن عود سيوفي</span>
                              <span className="font-mono text-ink">95.00 SAR</span>
                            </div>
                          </div>
                        </div>

                        <div className="mt-2">
                          <div className="flex items-center justify-between border-t border-rule/30 pt-2 mb-3">
                            <div>
                              <p className="text-[9px] font-mono text-ink-mute">Total SAR (Order #{zatcaOrderNum})</p>
                              <p className="font-mono text-xs font-bold text-accent">345.00 SAR</p>
                            </div>
                            <div className="w-9 h-9 border border-rule/60 bg-paper-deep/30 rounded flex items-center justify-center p-1" title="ZATCA Signed QR">
                              <svg className={`w-full h-full ${zatcaState === "done" ? "text-accent" : "text-ink-mute/40"}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                <rect x="2" y="2" width="6" height="6" rx="0.5" />
                                <rect x="16" y="2" width="6" height="6" rx="0.5" />
                                <rect x="2" y="16" width="6" height="6" rx="0.5" />
                                <path d="M16 16h2v2h-2zm2 2h2v2h-2zm-2 2h2v-2h-2zm-4-8h2v2h-2zm2 2h2v2h-2zm-2 2h2v2h-2zm-4-4h2v2h-2zm-2-2h2v2h-2z" />
                              </svg>
                            </div>
                          </div>

                          <button 
                            type="button"
                            onClick={runZatcaSimulation}
                            className={`w-full py-2.5 px-3 rounded-lg text-xs font-bold transition-all duration-300 flex items-center justify-center gap-1.5 shadow-glass-sm ${
                              zatcaState === "done"
                                ? "bg-accent/10 text-accent hover:bg-accent/20 border border-accent/20"
                                : "bg-ink text-paper hover:bg-accent hover:text-paper"
                            }`}
                          >
                            {zatcaState === "processing" ? (
                              <>
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                <span>{t.sandbox.zatca.btnProcessing}</span>
                              </>
                            ) : zatcaState === "done" ? (
                              <>
                                <Check className="w-3.5 h-3.5" />
                                <span>{t.sandbox.zatca.btnDone}</span>
                              </>
                            ) : (
                              <>
                                <Play className="w-3 h-3 fill-current" />
                                <span>{t.sandbox.zatca.btnIdle}</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>

                      {/* Right: signed ZATCA XML preview / logs terminal */}
                      <div className="sm:col-span-6 flex flex-col bg-ink/95 text-emerald-400 p-3.5 rounded-xl border border-rule/10 font-mono text-[9px] overflow-hidden leading-relaxed shadow-inner min-h-[240px]">
                        <div className="flex items-center gap-1.5 border-b border-white/10 pb-2 mb-2 shrink-0">
                          <span className={`w-1.5 h-1.5 rounded-full ${zatcaState === "processing" ? "bg-amber-400 animate-pulse" : "bg-emerald-400"}`} />
                          <span className="text-white/60">compliance-payload.xml</span>
                        </div>
                        {zatcaState === "idle" ? (
                          <pre className="flex-1 overflow-y-auto text-white/50 scrollbar-hide select-none flex flex-col justify-center items-center text-center px-4 gap-2">
                            <Sparkles className="w-5 h-5 text-accent-light/40" />
                            <span>{isAr ? "اضغط على محاكاة معالجة الطلب لتشغيل خط الامتثال لزاتكا." : "Click Checkout simulation to run ZATCA compliance checks."}</span>
                          </pre>
                        ) : (
                          <div className="flex-1 overflow-y-auto scrollbar-hide space-y-1.5 text-white/90">
                            {zatcaLogs.map((log, index) => (
                              <div key={index} className={`animate-fade-in ${index === zatcaLogs.length - 1 ? "text-accent-light" : ""}`}>
                                {log}
                              </div>
                            ))}
                            {zatcaState === "done" && (
                              <div className="pt-2 mt-2 border-t border-white/10 text-white/40 text-[8px] animate-fade-in select-all">
                                {`<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:tc:ubl...">
  <cbc:UUID>a8f2b1d-c402-4b2a...</cbc:UUID>
  <cac:Signature>
    <SignatureValue>MEYCIQDx8g6b...</SignatureValue>
  </cac:Signature>
</Invoice>`}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* TAB 2: Social Media AI */}
                  {activeSandboxTab === "social" && (
                    <div className="grid sm:grid-cols-12 gap-4 flex-1 animate-scale-in">
                      
                      {/* Left: Instagram mock post card */}
                      <div className="sm:col-span-7 p-4 rounded-xl border border-rule/50 bg-paper/65 shadow-glass-sm flex flex-col justify-between min-h-[240px]">
                        <div>
                          <div className="flex items-center justify-between border-b border-rule/20 pb-2 mb-2">
                            <div className="flex items-center gap-2">
                              <div className="w-6 h-6 rounded-full bg-gradient-to-br from-accent to-accent-warm flex items-center justify-center text-paper text-[8px] font-bold">ب</div>
                              <div>
                                <p className="text-[10px] font-bold text-ink leading-tight">بيت العود الفاخر</p>
                                <p className="text-[8px] text-ink-mute">Riyadh, Saudi Arabia</p>
                              </div>
                            </div>
                            <span className="text-[8px] font-mono text-ink-mute uppercase tracking-widest">{t.sandbox.social.platforms}</span>
                          </div>

                          {/* Dialect Selector Row */}
                          <div className="mb-2">
                            <p className="text-[8px] font-mono text-ink-mute uppercase tracking-wider mb-1">{t.sandbox.social.dialectLabel}</p>
                            <div className="grid grid-cols-4 gap-1">
                              {(["khaliji", "najdi", "hijazi", "msa"] as const).map((d) => (
                                <button
                                  key={d}
                                  type="button"
                                  onClick={() => setSocialDialect(d)}
                                  className={`py-1 px-0.5 rounded text-[8px] font-bold text-center border transition-all ${
                                    socialDialect === d
                                      ? "bg-accent/10 border-accent/40 text-accent font-semibold"
                                      : "bg-paper border-rule/30 text-ink-mute hover:text-ink"
                                  }`}
                                >
                                  {d === "khaliji" ? (isAr ? "خليجي" : "Khaliji") : d === "najdi" ? (isAr ? "نجدي" : "Najdi") : d === "hijazi" ? (isAr ? "حجازي" : "Hijazi") : (isAr ? "فصحى" : "MSA")}
                                </button>
                              ))}
                            </div>
                          </div>
                          
                          {/* Mock image mockup card */}
                          <div className="relative rounded-lg bg-gradient-to-tr from-accent/15 via-accent-warm/10 to-paper-deep/30 border border-rule/40 min-h-[90px] flex items-center justify-center p-3 mb-1 hover-glow transition-all duration-300">
                            <Store size={22} className="text-accent/35 animate-float-fast" />
                            <div className="absolute bottom-2 start-2 end-2 flex gap-1 justify-center flex-wrap">
                              {["Instagram", "TikTok", "X", "Snapchat"].map((plat) => (
                                <span key={plat} className="text-[7px] font-mono bg-paper/90 border border-rule/50 rounded px-1 py-0.5 text-ink-soft">
                                  {plat}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>

                        <div className="flex justify-between items-center text-[9px] font-mono text-ink-mute">
                          <span>Dialect: <strong className="text-accent">{socialDialect.toUpperCase()}</strong></span>
                          <span>Platforms: <strong className="text-accent">4 Linked</strong></span>
                        </div>
                      </div>

                      {/* Right: Caption editor preview */}
                      <div className="sm:col-span-5 p-4 rounded-xl border border-rule/50 bg-paper-deep/20 flex flex-col justify-between min-h-[240px]">
                        <div className="flex-1 flex flex-col">
                          <p className="text-[9px] font-mono uppercase tracking-widest text-ink-mute mb-2 border-b border-rule/20 pb-1 flex items-center justify-between">
                            <span>Draft Caption</span>
                            <span className="text-[8px] bg-accent/10 text-accent border border-accent/20 px-1 rounded">Dialect AI</span>
                          </p>
                          <div className="flex-1 flex items-center justify-center">
                            <p className="text-[11px] font-arabic text-ink-soft leading-relaxed text-right dir-rtl w-full">
                              "{socialDrafts[lang][socialDialect]}"
                            </p>
                          </div>
                        </div>
                        
                        <button
                          type="button"
                          onClick={runSocialSimulation}
                          className={`w-full py-2 px-3 rounded-lg text-xs font-bold transition-all duration-300 flex items-center justify-center gap-1.5 shadow-glass-sm mt-3 ${
                            socialState === "posted"
                              ? "bg-success/10 text-success border border-success/20 hover:bg-success/20"
                              : "bg-ink text-paper hover:bg-accent hover:text-paper"
                          }`}
                        >
                          {socialState === "posting" ? (
                            <>
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              <span>{t.sandbox.social.btnPosting}</span>
                            </>
                          ) : socialState === "posted" ? (
                            <>
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>{t.sandbox.social.btnPosted}</span>
                            </>
                          ) : (
                            <>
                              <Send className="w-3 h-3" />
                              <span>{t.sandbox.social.btnIdle}</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* TAB 3: Arabic Voice Agent */}
                  {activeSandboxTab === "voice" && (
                    <div className="grid sm:grid-cols-12 gap-4 flex-1 animate-scale-in">
                      
                      {/* Left: Call representative widget */}
                      <div className="sm:col-span-5 p-4 rounded-xl border border-rule/50 bg-paper/65 shadow-glass-sm flex flex-col justify-between items-center min-h-[240px] text-center">
                        <div className="w-full">
                          <p className="text-[9px] font-mono uppercase tracking-widest text-ink-mute border-b border-rule/20 pb-1.5">{t.sandbox.voice.representative}</p>
                          <p className="text-xs font-bold text-ink mt-2">الرد الآلي الصوتي السعودي</p>
                        </div>

                        {/* Call visualizer: pulsing bars */}
                        <div className="flex items-center justify-center gap-1 h-12 my-2">
                          {[0.1, 0.3, 0.2, 0.5, 0.4, 0.6, 0.3, 0.5, 0.2].map((delay, idx) => (
                            <span 
                              key={idx}
                              className={`w-1 rounded-full transition-all duration-300 ${
                                voiceState === "calling" 
                                  ? "bg-accent animate-wave-bar" 
                                  : "bg-ink-mute/30 h-1.5"
                              }`} 
                              style={voiceState === "calling" ? { animationDelay: `${delay}s`, height: "6px" } : { height: "6px" }} 
                            />
                          ))}
                        </div>

                        <div className="w-full">
                          <div className="flex justify-between items-center bg-paper-deep/30 px-2 py-1 rounded text-[10px] font-mono text-accent font-bold mb-2">
                            <span>+966 50 882 1404</span>
                            <span className={voiceState === "calling" ? "text-accent-warm animate-pulse" : "text-ink-mute"}>
                              {voiceState === "calling" ? `00:${voiceSeconds.toString().padStart(2, '0')}` : "00:00"}
                            </span>
                          </div>
                          
                          <button
                            type="button"
                            onClick={runVoiceSimulation}
                            className={`w-full py-2 px-3 rounded-lg text-xs font-bold transition-all duration-300 flex items-center justify-center gap-1.5 shadow-glass-sm ${
                              voiceState === "done"
                                ? "bg-accent/10 text-accent hover:bg-accent/20 border border-accent/20"
                                : "bg-ink text-paper hover:bg-accent hover:text-paper"
                            }`}
                          >
                            {voiceState === "calling" ? (
                              <>
                                <span className="w-2 h-2 rounded-full bg-red-500 animate-ping mr-1" />
                                <span>{t.sandbox.voice.btnCalling}</span>
                              </>
                            ) : voiceState === "done" ? (
                              <>
                                <Check className="w-3.5 h-3.5" />
                                <span>{t.sandbox.voice.btnDone}</span>
                              </>
                            ) : (
                              <>
                                <Phone className="w-3 h-3" />
                                <span>{t.sandbox.voice.btnIdle}</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>

                      {/* Right: Live translation transcript preview */}
                      <div className="sm:col-span-7 p-4 rounded-xl border border-rule/50 bg-paper-deep/20 flex flex-col gap-2 min-h-[240px] overflow-hidden">
                        <p className="text-[9px] font-mono uppercase tracking-widest text-ink-mute border-b border-rule/20 pb-1.5 flex justify-between shrink-0">
                          <span>Live Dialect Transcript</span>
                          <span className="text-[8px] bg-accent/10 text-accent border border-accent/20 px-1 rounded">Saudi Accent</span>
                        </p>
                        
                        <div className="space-y-2.5 overflow-y-auto flex-1 text-right dir-rtl scrollbar-hide text-[10.5px]">
                          {voiceState === "idle" && voiceRevealCount === 0 && (
                            <div className="h-full flex flex-col items-center justify-center text-center text-ink-mute/50 gap-1.5 py-6">
                              <Sparkles className="w-5 h-5 text-accent-light/40" />
                              <span>{isAr ? "اضغط على محاكاة المكالمة لتشغيل الرد الصوتي الآلي." : "Click simulate call to start voice representative session."}</span>
                            </div>
                          )}
                          
                          {voiceRevealCount >= 1 && (
                            <div className="border-r-2 border-rule/50 pr-2 font-arabic text-ink-mute animate-slide-up">
                              <p className="text-[8px] font-mono text-ink-mute/60">{isAr ? "العميل" : "Customer"}</p>
                              <p className="mt-0.5 font-medium">"هلا والله، بغيت أسأل البخور الكمبودي الفاخر متوفر اليوم بفرع جدة؟"</p>
                            </div>
                          )}
                          
                          {voiceRevealCount >= 2 && (
                            <div className="border-r-2 border-accent pr-2 font-arabic text-accent-deep animate-slide-up">
                              <p className="text-[8px] font-mono text-accent">{isAr ? "الموظف الذكي" : "AI Agent"}</p>
                              <p className="mt-0.5 font-medium">"يا هلا ومرحبا بك يا غالي! إي نعم متوفر وجاهز بالفرع، وتقدر الحين تطلبه ويوصلك مع مندوبنا خلال ساعتين فقط."</p>
                            </div>
                          )}

                          {voiceRevealCount >= 3 && (
                            <div className="border-r-2 border-rule/50 pr-2 font-arabic text-ink-mute animate-slide-up">
                              <p className="text-[8px] font-mono text-ink-mute/60">{isAr ? "العميل" : "Customer"}</p>
                              <p className="mt-0.5 font-medium">"ممتاز الله يسعدك! طيب أقدر أدفع عند الاستلام ولا لازم مدى؟"</p>
                            </div>
                          )}

                          {voiceRevealCount >= 4 && (
                            <div className="border-r-2 border-accent pr-2 font-arabic text-accent-deep animate-slide-up">
                              <p className="text-[8px] font-mono text-accent">{isAr ? "الموظف الذكي" : "AI Agent"}</p>
                              <p className="mt-0.5 font-medium">"ويسعدك يا رب! تقدر تدفع عند الاستلام كاش أو بطاقة مع المندوب، وأيضاً متاح الدفع بمدى وأبل باي بالموقع لسهولة طلبك."</p>
                            </div>
                          )}
                        </div>

                        {voiceState === "done" && (
                          <div className="bg-accent/5 border border-accent/25 rounded-lg p-2 text-[9.5px] text-accent-deep leading-relaxed animate-fade-in shrink-0">
                            <strong>{isAr ? "ملخص المكالمة بالذكاء الاصطناعي: " : "AI Call Summary: "}</strong>
                            {isAr 
                              ? "استفسار العميل عن توفر البخور الكمبودي بجدة. تم تأكيد التوفر وعرض التوصيل الفوري مع الدفع عند الاستلام."
                              : "Customer inquired about Cambodian Oud stock in Jeddah. Confirmed availability and offered immediate delivery with COD."
                            }
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* TAB 4: SEO Writer */}
                  {activeSandboxTab === "seo" && (
                    <div className="grid sm:grid-cols-12 gap-4 flex-1 animate-scale-in">
                      
                      {/* Left: Google preview mockup card */}
                      <div className="sm:col-span-7 p-4 rounded-xl border border-rule/50 bg-paper/65 shadow-glass-sm flex flex-col justify-between min-h-[240px] text-left">
                        <div>
                          <div className="flex items-center justify-between text-[9px] text-ink-mute border-b border-rule/20 pb-2 mb-3">
                            <span className="flex items-center gap-1">
                              <Store size={10} className="text-accent" /> google.com.sa
                            </span>
                            <span className="text-emerald-600 font-semibold">{isAr ? "بحث جوجل السعودية" : "KSA Arabic Search"}</span>
                          </div>

                          {/* Category pills switcher */}
                          <div className="mb-3">
                            <p className="text-[8px] font-mono text-ink-mute uppercase tracking-wider mb-1">{t.sandbox.seo.retailCategory}</p>
                            <div className="grid grid-cols-3 gap-1">
                              {(["oud", "coffee", "dates"] as const).map((cat) => (
                                <button
                                  key={cat}
                                  type="button"
                                  onClick={() => setSeoCategory(cat)}
                                  className={`py-1 px-0.5 rounded text-[8px] font-bold text-center border transition-all ${
                                    seoCategory === cat
                                      ? "bg-accent/10 border-accent/40 text-accent font-semibold"
                                      : "bg-paper border-rule/30 text-ink-mute hover:text-ink"
                                  }`}
                                >
                                  {cat === "oud" ? (isAr ? "بخور وعطور" : "Oud") : cat === "coffee" ? (isAr ? "قهوة عربية" : "Coffee") : (isAr ? "تمور وحلويات" : "Dates")}
                                </button>
                              ))}
                            </div>
                          </div>
                          
                          <div className="space-y-1 my-2">
                            <p className="text-[11px] text-cyan-700 hover:underline cursor-pointer font-medium leading-tight text-right dir-rtl">
                              {seoMockData[lang][seoCategory].title}
                            </p>
                            <p className="text-[8px] text-emerald-700 truncate leading-none">
                              {seoMockData[lang][seoCategory].url}
                            </p>
                            <p className="text-[10px] text-ink-soft leading-relaxed text-pretty font-arabic text-right dir-rtl mt-1">
                              {seoMockData[lang][seoCategory].desc}
                            </p>
                          </div>
                        </div>

                        <div className="flex justify-between items-center text-[8px] font-mono text-ink-mute border-t border-rule/20 pt-2">
                          <span>{t.sandbox.seo.keywords}: <strong className="text-accent">{seoMockData[lang][seoCategory].keywords}</strong></span>
                        </div>
                      </div>

                      {/* Right: SEO score progress card */}
                      <div className="sm:col-span-5 p-4 rounded-xl border border-rule/50 bg-paper-deep/20 flex flex-col justify-between min-h-[240px]">
                        <div>
                          <p className="text-[9px] font-mono uppercase tracking-widest text-ink-mute mb-2 border-b border-rule/20 pb-1 shrink-0">{t.sandbox.seo.scoreLabel}</p>
                          
                          <div className="text-center my-4 flex flex-col justify-center items-center">
                            <span className="text-4xl font-display font-bold text-accent animate-pulse-soft">{seoMockData[lang][seoCategory].score}%</span>
                            <p className="text-[9px] font-mono uppercase tracking-widest text-success mt-1">Excellent Ranking</p>
                          </div>
                        </div>

                        {/* progress bar */}
                        <div className="space-y-2">
                          <div className="flex justify-between text-[8px] font-mono text-ink-mute">
                            <span>{t.sandbox.seo.density}</span>
                            <span>{seoMockData[lang][seoCategory].density}</span>
                          </div>
                          <div className="h-2 w-full bg-rule/35 rounded-full overflow-hidden">
                            <div 
                              className="h-full bg-accent rounded-full transition-all duration-700 ease-spring" 
                              style={{ width: seoCategory === "oud" ? "92%" : seoCategory === "coffee" ? "82%" : "88%" }} 
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Sandbox Workspace Footer */}
                  <div className="flex items-center justify-between border-t border-rule/25 pt-3.5 mt-3.5 text-[10px] font-mono text-ink-mute shrink-0">
                    <span className="flex items-center gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        zatcaState === "processing" || voiceState === "calling" || socialState === "posting"
                          ? "bg-amber-500 animate-ping"
                          : "bg-emerald-500 animate-pulse"
                      }`} /> 
                      <span>{isAr ? "سجل العمليات المباشرة" : "Active Operations Logs"}</span>
                    </span>
                    <span>{isAr ? "مدرب لهجات محلية للخليج" : "Gulf Dialects pre-trained"}</span>
                  </div>


                </div>

              </div>
            </div>

          </div>

          {/* Combined Widescreen Stats Section directly below the Hero layout */}
          <div className="mt-16 sm:mt-20 border-t border-rule/55 pt-10">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 stagger-reveal">
              {t.stats.map((s, idx) => (
                <div key={s.label} className="landing-stat-card flex items-center justify-between gap-4 py-4 px-6 hover-glow hover-lift transition-all duration-300">
                  <div>
                    <p className={`text-xs text-ink-mute uppercase tracking-widest font-mono ${isAr ? "arabic-display" : ""}`}>{s.label}</p>
                    <div className="font-display text-3xl lg:text-4xl tracking-tightest nums leading-none text-accent mt-1.5">{s.n}</div>
                  </div>
                  {/* Custom geometric shape or icon container based on index */}
                  <div className="w-10 h-10 rounded-xl bg-accent/5 border border-accent/15 flex items-center justify-center text-accent">
                    {idx === 0 ? <Store size={18} /> : idx === 1 ? <FileText size={18} /> : <Phone size={18} />}
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>
        <div className="rule mt-16 sm:mt-20" />
      </section>

      {/* WHO IT'S FOR */}
      <section className="bg-paper-deep/35">
        <div className="mx-auto max-w-[1400px] px-5 sm:px-6 lg:px-10 py-20 lg:py-24">
          <p className="marker-numeral mb-4">{t.audience.kicker}</p>
          <h2 className={`display-2 max-w-3xl ${isAr ? "arabic-display font-normal" : ""}`}>{t.audience.title}</h2>
          <div className="mt-12 grid md:grid-cols-3 gap-6 stagger-reveal">
            {t.audience.items.map((item) => (
              <article key={item.title} className="landing-card p-6 lg:p-8">
                <Store className="text-accent mb-4" size={22} strokeWidth={1.75} />
                <h3 className={`font-display text-xl mb-3 ${isAr ? "arabic-display font-normal" : ""}`}>{item.title}</h3>
                <p className={`text-sm text-ink-soft leading-relaxed ${isAr ? "arabic-display" : ""}`}>{item.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how">
        <div className="mx-auto max-w-[1400px] px-5 sm:px-6 lg:px-10 py-20 lg:py-24">
          <p className="marker-numeral mb-4">{t.how.kicker}</p>
          <h2 className={`display-2 max-w-3xl ${isAr ? "arabic-display font-normal" : ""}`}>{t.how.title}</h2>
          <ol className="mt-14 grid lg:grid-cols-3 gap-8 lg:gap-10">
            {t.how.steps.map((step, i) => (
              <li key={step.n} className="relative">
                {i < t.how.steps.length - 1 && (
                  <span className="hidden lg:block absolute top-8 end-0 w-full h-px bg-rule translate-x-1/2 z-0" aria-hidden />
                )}
                <div className="relative z-10">
                  <span className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-ink text-paper font-mono text-sm mb-5">
                    {step.n}
                  </span>
                  <h3 className={`font-display text-2xl mb-3 ${isAr ? "arabic-display font-normal" : ""}`}>{step.title}</h3>
                  <p className={`text-ink-soft leading-relaxed ${isAr ? "arabic-display" : ""}`}>{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* MODULES */}
      <section id="product" className="bg-paper-deep/40 border-y border-rule/50">
        <div className="mx-auto max-w-[1400px] px-5 sm:px-6 lg:px-10 py-20 lg:py-28">
          <p className="marker-numeral mb-4">{t.section02.kicker}</p>
          <h2 className={`display-2 max-w-3xl ${isAr ? "arabic-display font-normal" : ""}`}>{t.section02.title}</h2>
          <p className={`mt-5 max-w-2xl text-lg text-ink-soft leading-relaxed ${isAr ? "arabic-display" : ""}`}>{t.section02.sub}</p>

          <div className="mt-14 grid md:grid-cols-2 gap-6">
            {t.modules.map((m) => {
              const Icon = moduleIcons[m.icon as keyof typeof moduleIcons];
              return (
                <article key={m.idx} className="landing-card p-7 lg:p-9 flex flex-col gap-4 min-h-[320px]">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <span className="landing-icon-wrap">
                        <Icon size={20} strokeWidth={1.75} />
                      </span>
                      <div>
                        <span className="font-mono text-[10px] tracking-widest text-ink-mute uppercase">{m.idx}</span>
                        <p className="arabic-display text-accent text-sm mt-0.5">{m.ar}</p>
                      </div>
                    </div>
                  </div>
                  <div>
                    <h3 className={`font-display text-2xl lg:text-3xl tracking-crisp ${isAr ? "arabic-display font-normal" : ""}`}>
                      {m.name}
                    </h3>
                    <p className="text-sm text-accent font-medium mt-1">{m.tagline}</p>
                  </div>
                  <p className={`text-ink-soft text-[15px] leading-relaxed flex-1 ${isAr ? "arabic-display" : ""}`}>{m.body}</p>
                  <ul className="space-y-2">
                    {m.bullets.map((b) => (
                      <li key={b} className={`flex items-start gap-2 text-sm text-ink-soft ${isAr ? "arabic-display" : ""}`}>
                        <Check size={14} className="text-accent mt-0.5 shrink-0" />
                        {b}
                      </li>
                    ))}
                  </ul>
                  <p className="pt-3 border-t border-rule font-mono text-[10px] uppercase tracking-widest text-accent-warm-deep">
                    {m.deadline}
                  </p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      {/* SOCIAL PIPELINE */}
      <section className="bg-ink text-paper">
        <div className="mx-auto max-w-[1400px] px-5 sm:px-6 lg:px-10 py-20 lg:py-28">
          <div className="grid lg:grid-cols-12 gap-12">
            <div className="lg:col-span-5">
              <p className="marker-numeral mb-4 text-paper/50">{t.socialFeature.kicker}</p>
              <h2 className={`display-2 ${isAr ? "arabic-display font-normal" : ""}`}>{t.socialFeature.title}</h2>
              <p className={`mt-5 text-paper/75 leading-relaxed ${isAr ? "arabic-display" : ""}`}>{t.socialFeature.sub}</p>
            </div>
            <ul className="lg:col-span-7 space-y-4">
              {t.socialFeature.agents.map((a, i) => (
                <li
                  key={a.role}
                  className="grid grid-cols-[auto_1fr] gap-4 p-5 rounded-2xl border border-paper/10 bg-paper/5 hover:bg-paper/10 transition-colors"
                >
                  <span className="font-mono text-xs text-paper/45 mt-1">{String(i + 1).padStart(2, "0")}</span>
                  <div>
                    <p className="font-medium text-paper">{a.role}</p>
                    <p className={`text-sm text-paper/75 mt-1 leading-relaxed ${isAr ? "arabic-display" : ""}`}>{a.does}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing">
        <div className="mx-auto max-w-[1400px] px-5 sm:px-6 lg:px-10 py-20 lg:py-28">
          <p className="marker-numeral mb-4">{t.pricing.kicker}</p>
          <h2 className={`display-2 max-w-3xl ${isAr ? "arabic-display font-normal" : ""}`}>{t.pricing.title}</h2>
          <p className={`mt-4 text-ink-soft max-w-2xl ${isAr ? "arabic-display" : ""}`}>{t.pricing.sub}</p>

          {/* Billing Cycle Switcher Toggle */}
          <div className="mt-8 flex justify-center items-center gap-3">
            <span className={`text-sm font-medium transition-colors ${billingCycle === "monthly" ? "text-accent font-semibold" : "text-ink-mute"}`}>
              {isAr ? "دفع شهري" : "Monthly"}
            </span>
            <button
              type="button"
              onClick={() => setBillingCycle(billingCycle === "monthly" ? "yearly" : "monthly")}
              className="relative w-12 h-6 rounded-full bg-rule/50 border border-rule transition-colors focus:none hover:border-ink/30"
              aria-label="Toggle billing cycle"
            >
              <span className={`absolute top-0.5 start-0.5 w-4.5 h-4.5 rounded-full bg-accent transition-transform duration-300 ${billingCycle === "yearly" ? "translate-x-6 rtl:-translate-x-6" : ""}`} />
            </button>
            <span className={`text-sm font-medium transition-colors flex items-center gap-1.5 ${billingCycle === "yearly" ? "text-accent font-semibold" : "text-ink-mute"}`}>
              <span>{isAr ? "دفع سنوي" : "Yearly"}</span>
              <span className="text-[9px] font-mono font-bold uppercase tracking-wider bg-accent/15 text-accent px-1.5 py-0.5 rounded border border-accent/25 animate-pulse-soft">
                {isAr ? "وفر ٢٠٪" : "Save 20%"}
              </span>
            </span>
          </div>

          <div className="mt-12 grid md:grid-cols-3 gap-6">
            {t.pricing.plans.map((p) => {
              const highlighted = "highlight" in p && Boolean(p.highlight);
              const pricingInfo = getPlanPriceAndUnit(p.name, billingCycle, isAr);
              return (
                <div
                  key={p.name}
                  className={`landing-card p-7 lg:p-9 flex flex-col gap-5 transition-all duration-300 ${
                    highlighted 
                      ? "ring-2 ring-accent bg-ink text-paper shadow-glass-lg scale-[1.02] md:scale-[1.03] z-10" 
                      : "hover-lift hover-glow"
                  }`}
                >
                  {highlighted && (
                    <span className="self-start text-[10px] font-mono uppercase tracking-widest bg-accent/20 text-accent-light px-2 py-1 rounded-md">
                      {isAr ? "الأكثر شيوعاً" : "Most popular"}
                    </span>
                  )}
                  <div>
                    <h3 className={`font-display text-3xl ${isAr ? "arabic-display font-normal" : ""}`}>{p.name}</h3>
                    <p className={`text-sm mt-1 ${highlighted ? "text-paper/65" : "text-ink-mute"} ${isAr ? "arabic-display" : ""}`}>
                      {p.audience}
                    </p>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-baseline gap-2 nums">
                      <span className="font-display text-5xl lg:text-6xl tracking-tightest transition-all duration-300">{pricingInfo.price}</span>
                      <span className={`text-sm ${highlighted ? "text-paper/60" : "text-ink-mute"} ${isAr ? "arabic-display" : ""}`}>
                        {pricingInfo.unit}
                      </span>
                    </div>
                    {pricingInfo.billedNote && (
                      <span className={`text-[10px] font-mono mt-1 ${highlighted ? "text-paper/50" : "text-ink-mute"} animate-fade-in`}>
                        {pricingInfo.billedNote}
                      </span>
                    )}
                  </div>
                  <ul className="space-y-3 flex-1">
                    {p.features.map((f) => (
                      <li key={f} className={`flex items-start gap-2 text-sm ${isAr ? "arabic-display" : ""}`}>
                        <Check size={16} className={`mt-0.5 shrink-0 ${highlighted ? "text-paper/80" : "text-accent"}`} />
                        <span className={highlighted ? "text-paper/85" : "text-ink-soft"}>{f}</span>
                      </li>
                    ))}
                  </ul>
                  <a
                    href={installHref}
                    {...(installExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                    className={highlighted ? "button-accent w-full justify-center" : "button-ghost w-full justify-center"}
                  >
                    {isAr ? "اختر الباقة" : "Choose plan"} <ArrowUpRight size={14} />
                  </a>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="bg-paper-deep/35 border-t border-rule/50">
        <div className="mx-auto max-w-[1400px] px-5 sm:px-6 lg:px-10 py-20 lg:py-24">
          <p className="marker-numeral mb-4">{t.faq.kicker}</p>
          <h2 className={`display-2 mb-10 ${isAr ? "arabic-display font-normal" : ""}`}>{t.faq.title}</h2>
          <div className="space-y-3 max-w-3xl">
            {t.faq.items.map((item, i) => {
              const open = openFaq === i;
              return (
                <div key={item.q} className="landing-card overflow-hidden">
                  <button
                    type="button"
                    className="w-full flex items-center justify-between gap-4 p-5 text-start touch-target"
                    onClick={() => setOpenFaq(open ? null : i)}
                    aria-expanded={open}
                  >
                    <span className={`font-medium pe-4 ${isAr ? "arabic-display" : ""}`}>{item.q}</span>
                    <ChevronDown size={18} className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
                  </button>
                  {open && (
                    <div className={`px-5 pb-5 text-sm text-ink-soft leading-relaxed border-t border-rule/50 pt-4 ${isAr ? "arabic-display" : ""}`}>
                      {item.a}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* CTA BAND */}
      <section className="bg-accent text-paper">
        <div className="mx-auto max-w-[1400px] px-5 sm:px-6 lg:px-10 py-16 lg:py-20 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-8">
          <div className="max-w-xl">
            <h2 className={`display-2 text-paper ${isAr ? "arabic-display font-normal" : ""}`}>{t.ctaBand.title}</h2>
            <p className={`mt-4 text-paper/85 text-lg leading-relaxed ${isAr ? "arabic-display" : ""}`}>{t.ctaBand.sub}</p>
          </div>
          <a
            href={installHref}
            {...(installExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            className="inline-flex items-center justify-center gap-2 bg-paper text-ink px-8 py-4 rounded-xl font-medium text-sm hover:bg-paper-elevated transition shrink-0"
          >
            {t.ctaBand.btn} <ArrowUpRight size={16} />
          </a>
        </div>
      </section>

      {/* FOOTER */}
      <footer id="about" className="bg-paper-deep/50 border-t border-rule pb-24 md:pb-16">
        <div className="mx-auto max-w-[1400px] px-5 sm:px-6 lg:px-10 py-16">
          <div className="grid lg:grid-cols-12 gap-10">
            <div className="lg:col-span-5">
              <div className="flex items-center gap-2.5">
                <Logo />
                <span className="font-display text-2xl tracking-tightest">arabclue</span>
              </div>
              <p className={`mt-4 text-ink-soft max-w-sm leading-relaxed ${isAr ? "arabic-display" : ""}`}>{t.footer.tag}</p>
              <p className={`mt-8 font-mono text-[11px] uppercase tracking-widest text-ink-mute ${isAr ? "font-arabic normal-case tracking-normal text-sm" : ""}`}>
                {t.footer.built}
              </p>
            </div>
            <div className="lg:col-span-7 grid grid-cols-2 sm:grid-cols-3 gap-8">
              {(["product", "company", "legal"] as const).map((k) => {
                const cols = t.footer.cols as any;
                const [title, items] = cols[k] as [string, string[]];
                return (
                  <div key={k}>
                    <div className={`marker-numeral mb-4 ${isAr ? "font-arabic" : ""}`}>{title}</div>
                    <ul className="space-y-2.5 text-sm">
                      {items.map((it: string) => (
                        <li key={it}>
                          <Link href={footerHref(it)} className={`text-ink-soft hover:text-ink transition ${isAr ? "arabic-display" : ""}`}>
                            {it}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="mt-16 pt-6 border-t border-rule flex flex-wrap items-center justify-between gap-4 text-xs text-ink-mute">
            <span className="font-mono">© 2026 arabclue</span>
            <span className="font-mono">arabclue.com</span>
          </div>
        </div>
      </footer>

      {/* Mobile sticky CTA */}
      <div className="fixed bottom-0 inset-x-0 z-40 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:hidden bg-paper/90 backdrop-blur-lg border-t border-rule shadow-glass-md">
        <a href={installHref} {...(installExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})} className="button-primary w-full justify-center">
          {t.hero.cta1} <ArrowUpRight size={16} />
        </a>
      </div>
    </main>
  );
}

function footerHref(label: string): string {
  const routes: Record<string, string> = {
    Terms: "/legal/terms",
    Privacy: "/legal/privacy",
    PDPL: "/legal/privacy",
    About: "/about",
    Manifesto: "/manifesto",
    Careers: "/careers",
    Press: "/press",
    Maroof: "/maroof",
    Modules: "#product",
    ZATCA: "#product",
    Social: "#product",
    Voice: "#product",
    Pricing: "#pricing",
    "الشروط": "/legal/terms",
    "الخصوصية": "/legal/privacy",
    "من نحن": "/about",
    "الرؤية": "/manifesto",
    "وظائف": "/careers",
    "الإعلام": "/press",
    "معروف": "/maroof",
    الوحدات: "#product",
    زاتكا: "#product",
    التواصل: "#product",
    الصوت: "#product",
    الأسعار: "#pricing"
  };
  return routes[label] ?? "#product";
}

function Logo() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden>
      <rect x="0.5" y="0.5" width="27" height="27" rx="3" stroke="currentColor" strokeOpacity="0.18" />
      <path d="M7 18.5L14 7L21 18.5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="14" cy="20.5" r="1.4" fill="currentColor" />
    </svg>
  );
}
