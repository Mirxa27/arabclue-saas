import { StaticMarketingPage } from "@/components/marketing/static-page";
import { readCompanyRegistration } from "@/lib/company/registration";

// The CR number and Maroof link are runtime settings (/admin/config), not build-time values.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Maroof — arabclue",
  description: "arabclue commercial registration and Maroof trust information."
};

export default function MaroofPage() {
  const { crNumber, maroofUrl } = readCompanyRegistration();
  const published = Boolean(crNumber || maroofUrl);

  return (
    <StaticMarketingPage title="Maroof / Commercial registration" subtitle="معروف والسجل التجاري · Trust & transparency">
      <p className="font-arabic" dir="rtl">
        يمكن للتجار والعملاء في المملكة التحقق من موثوقية المنشآت عبر منصة معروف وسجلات السجل التجاري، وننشر بياناتنا هنا
        بشفافية لمجتمع التجار.
      </p>
      <p>
        Saudi merchants and customers can verify business legitimacy through Maroof (معروف) and commercial registration
        records. arabclue publishes its details here for transparency with our merchant community.
      </p>

      <h2 className="font-display text-2xl text-ink pt-4">
        <span className="font-arabic" dir="rtl">التحقق</span> · Verification
      </h2>

      {published ? (
        <dl className="space-y-4">
          {crNumber && (
            <div>
              <dt className="text-xs font-mono uppercase tracking-wider text-ink-mute">
                <span className="font-arabic normal-case" dir="rtl">رقم السجل التجاري</span> · Commercial registration (CR) number
              </dt>
              <dd className="mt-1 text-lg font-semibold text-ink nums" dir="ltr">
                {crNumber}
              </dd>
            </div>
          )}
          {maroofUrl && (
            <div>
              <dt className="text-xs font-mono uppercase tracking-wider text-ink-mute">
                <span className="font-arabic normal-case" dir="rtl">ملفنا في معروف</span> · Maroof profile
              </dt>
              <dd className="mt-1">
                <a
                  href={maroofUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:underline break-all"
                  dir="ltr"
                >
                  {maroofUrl}
                </a>
              </dd>
            </div>
          )}
        </dl>
      ) : (
        <p>
          <span className="font-arabic block" dir="rtl">ستُنشر بيانات السجل التجاري ومعروف هنا قريباً.</span>
          Our commercial registration and Maroof details will be listed here soon.
        </p>
      )}

      <p>
        <span className="font-arabic" dir="rtl">لطلبات التحقق راسلنا على</span> · For verification requests, email{" "}
        <a href="mailto:trust@arabclue.com" className="text-accent hover:underline">
          trust@arabclue.com
        </a>
        .
      </p>
    </StaticMarketingPage>
  );
}
