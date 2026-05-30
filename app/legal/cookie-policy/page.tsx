import { StaticMarketingPage } from "@/components/marketing/static-page";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "سياسة ملفات تعريف الارتباط — عرب كلو",
  description:
    "سياسة ملفات تعريف الارتباط لمنصة عرب كلو. تعرّف على كيفية استخدامنا لملفات تعريف الارتباط والبيانات المشابهة.",
};

export default function CookiePolicyPage() {
  return (
    <StaticMarketingPage
      title="سياسة ملفات تعريف الارتباط"
      subtitle="آخر تحديث: 28 مايو 2026"
    >
      <section className="space-y-4 text-ink-soft leading-relaxed">
        <h2 className="text-lg font-semibold text-ink">١. ما هي ملفات تعريف الارتباط؟</h2>
        <p>
          ملفات تعريف الارتباط (Cookies) هي ملفات نصية صغيرة تُخزَّن على جهازك عند زيارتك لمواقع الويب.
          تُستخدم لتحسين تجربة التصفح وتذكُّر تفضيلاتك وتقديم محتوى مخصص.
        </p>

        <h2 className="text-lg font-semibold text-ink">٢. أنواع ملفات تعريف الارتباط التي نستخدمها</h2>

        <h3 className="text-base font-semibold text-ink">ملفات تعريف الارتباط الضرورية</h3>
        <p>
          ضرورية لتشغيل المنصة ولا يمكن تعطيلها. تشمل ملفات جلسة المصادقة، وملفات الحماية من
          الاحتيال، وملفات موازنة الأحمال.
        </p>

        <h3 className="text-base font-semibold text-ink">ملفات تعريف الارتباط الوظيفية</h3>
        <p>
          تسمح لنا بتذكُّر تفضيلاتك مثل اللغة والمنطقة الزمنية وإعدادات العرض. قد يؤدي تعطيلها إلى
          ضعف وظائف معينة.
        </p>

        <h3 className="text-base font-semibold text-ink">ملفات تعريف الارتباط التحليلية</h3>
        <p>
          تساعدنا في فهم كيفية استخدام المنصة وتحسينها. نستخدم أدوات تحليل ذاتية وجهات خارجية
          معتمدة مع إخفاء الهوية. لا نشارك هذه البيانات مع أطراف ثالثة لأغراض إعلانية.
        </p>

        <h3 className="text-base font-semibold text-ink">ملفات تعريف الارتباط التسويقية</h3>
        <p>
          لا نستخدم ملفات تعريف ارتباط تسويقية من أطراف ثالثة. قد نستخدم روابط تتبع داخلية لقياس
          فعالية الحملات التسويقية الخاصة بنا فقط.
        </p>

        <h2 className="text-lg font-semibold text-ink">٣. التحكم في ملفات تعريف الارتباط</h2>
        <p>
          يمكنك التحكم في ملفات تعريف الارتباط أو حذفها من خلال إعدادات المتصفح. يُرجى العلم أن
          تعطيل ملفات تعريف الارتباط الضرورية قد يؤثر على وظائف المنصة الأساسية.
        </p>
        <ul className="list-disc list-inside space-y-1">
          <li>Google Chrome: الإعدادات ← الخصوصية والأمان ← ملفات تعريف الارتباط</li>
          <li>Safari: التفضيلات ← الخصوصية</li>
          <li>Firefox: الخيارات ← الخصوصية والأمان</li>
          <li>Microsoft Edge: الإعدادات ← ملفات تعريف الارتباط وأذونات الموقع</li>
        </ul>

        <h2 className="text-lg font-semibold text-ink">٤. التغييرات على هذه السياسة</h2>
        <p>
          قد نُحدِّث هذه السياسة من وقت لآخر. سيتم نشر النسخة المحدثة على هذه الصفحة مع تاريخ آخر
          تحديث. نوصي بمراجعة هذه السياسة دورياً.
        </p>

        <h2 className="text-lg font-semibold text-ink">٥. التواصل</h2>
        <p>
          لأي استفسار حول سياسة ملفات تعريف الارتباط، يُرجى التواصل عبر البريد الإلكتروني:{" "}
          <a href="mailto:privacy@arabclue.com" className="text-accent underline hover:opacity-80">
            privacy@arabclue.com
          </a>
          {" "}أو من خلال نموذج الدعم داخل لوحة التحكم.
        </p>
      </section>
    </StaticMarketingPage>
  );
}