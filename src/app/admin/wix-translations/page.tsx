import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { WixTranslationPage } from "@/components/wix-translations/wix-translation-page";

export default function AdminWixTranslationsPage() {
  return (
    <DashboardLayout>
      <WixTranslationPage />
    </DashboardLayout>
  );
}
