import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/app/components/ui/card";
import { toast } from "sonner";
import { Palette, RotateCcw, Save, Info } from "lucide-react";
import { ImageUpload } from "@/app/components/ui/image-upload";
import {
  brandingApi,
  type BrandingSettings,
  type BrandingUpdateRequest,
} from "@/app/api/endpoints/branding";

interface FormData {
  title: string;
  logo_url: string;
  favicon_url: string;
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  description: string;
  contact_email: string;
  help_url: string;
}

const defaultFormData: FormData = {
  title: "",
  logo_url: "",
  favicon_url: "",
  primary_color: "#c50010",
  secondary_color: "",
  accent_color: "",
  description: "",
  contact_email: "",
  help_url: "",
};

function settingsToFormData(settings: BrandingSettings): FormData {
  return {
    title: settings.title || "",
    logo_url: settings.logo_url || "",
    favicon_url: settings.favicon_url || "",
    primary_color: settings.primary_color || "#c50010",
    secondary_color: settings.secondary_color || "",
    accent_color: settings.accent_color || "",
    description: settings.description || "",
    contact_email: settings.contact_email || "",
    help_url: settings.help_url || "",
  };
}

export function BrandingSettingsCard() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState<FormData>(defaultFormData);

  const { data: settings, isLoading } = useQuery({
    queryKey: ["branding"],
    queryFn: async () => {
      const response = await brandingApi.get();
      return response.data;
    },
  });

  useEffect(() => {
    if (settings) setFormData(settingsToFormData(settings));
  }, [settings]);

  const updateMutation = useMutation({
    mutationFn: (data: BrandingUpdateRequest) => brandingApi.update(data),
    onSuccess: () => {
      toast.success(t("settings.branding.updated"));
      queryClient.invalidateQueries({ queryKey: ["branding"] });
      window.dispatchEvent(new CustomEvent("branding-updated"));
    },
    onError: () => {
      toast.error(t("settings.branding.updateFailed"));
    },
  });

  const resetMutation = useMutation({
    mutationFn: () => brandingApi.reset(),
    onSuccess: (response) => {
      toast.success(t("settings.branding.resetSuccess"));
      setFormData(settingsToFormData(response.data));
      queryClient.invalidateQueries({ queryKey: ["branding"] });
      window.dispatchEvent(new CustomEvent("branding-updated"));
    },
    onError: () => {
      toast.error(t("settings.branding.resetFailed"));
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateMutation.mutate({
      title: formData.title || undefined,
      logo_url: formData.logo_url || null,
      favicon_url: formData.favicon_url || null,
      primary_color: formData.primary_color || undefined,
      secondary_color: formData.secondary_color || null,
      accent_color: formData.accent_color || null,
      description: formData.description || null,
      contact_email: formData.contact_email || null,
      help_url: formData.help_url || null,
    });
  };

  const handleReset = () => {
    if (!confirm(t("settings.branding.resetConfirm")))
      return;
    resetMutation.mutate();
  };

  const isSubmitting = updateMutation.isPending || resetMutation.isPending;

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palette className="h-5 w-5" />
            {t("settings.branding.title")}
          </CardTitle>
          <CardDescription>{t("common.loading")}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Palette className="h-5 w-5" />
          {t("settings.branding.title")}
        </CardTitle>
        <CardDescription>
          {t("settings.branding.description")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="title">{t("settings.branding.systemTitle")}</Label>
            <Input
              id="title"
              value={formData.title}
              onChange={(e) =>
                setFormData({ ...formData, title: e.target.value })
              }
              disabled={isSubmitting}
              placeholder="Lumina Driver"
            />
            <div className="flex items-start gap-2 text-xs text-gray-500">
              <Info className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <p>{t("settings.branding.systemTitleHint")}</p>
            </div>
          </div>

          <ImageUpload
            label={t("settings.branding.logo")}
            currentUrl={formData.logo_url}
            onUploadSuccess={(url) =>
              setFormData({ ...formData, logo_url: url })
            }
            uploadType="logo"
            previewSize="md"
          />

          <ImageUpload
            label={t("settings.branding.favicon")}
            currentUrl={formData.favicon_url}
            onUploadSuccess={(url) =>
              setFormData({ ...formData, favicon_url: url })
            }
            uploadType="favicon"
            previewSize="sm"
          />

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {[
              {
                key: "primary_color",
                label: t("settings.branding.primaryColor"),
                placeholder: "#c50010",
              },
              {
                key: "secondary_color",
                label: t("settings.branding.secondaryColor"),
                placeholder: "#ffe0e2",
              },
              {
                key: "accent_color",
                label: t("settings.branding.accentColor"),
                placeholder: "#000000",
              },
            ].map(({ key, label, placeholder }) => (
              <div key={key} className="grid gap-2">
                <Label htmlFor={key}>{label}</Label>
                <div className="flex gap-2">
                  <Input
                    id={key}
                    type="color"
                    value={(formData as any)[key] || placeholder}
                    onChange={(e) =>
                      setFormData({ ...formData, [key]: e.target.value })
                    }
                    disabled={isSubmitting}
                    className="h-10 w-16 p-1"
                  />
                  <Input
                    value={(formData as any)[key]}
                    onChange={(e) =>
                      setFormData({ ...formData, [key]: e.target.value })
                    }
                    disabled={isSubmitting}
                    placeholder={placeholder}
                    className="flex-1"
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="description">{t("settings.branding.descriptionLabel")}</Label>
            <Input
              id="description"
              value={formData.description}
              onChange={(e) =>
                setFormData({ ...formData, description: e.target.value })
              }
              disabled={isSubmitting}
              placeholder="AI-powered document management system"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="contact_email">{t("settings.branding.contactEmail")}</Label>
            <Input
              id="contact_email"
              type="email"
              value={formData.contact_email}
              onChange={(e) =>
                setFormData({ ...formData, contact_email: e.target.value })
              }
              disabled={isSubmitting}
              placeholder="support@example.com"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="help_url">{t("settings.branding.helpUrl")}</Label>
            <Input
              id="help_url"
              value={formData.help_url}
              onChange={(e) =>
                setFormData({ ...formData, help_url: e.target.value })
              }
              disabled={isSubmitting}
              placeholder="https://docs.example.com"
            />
          </div>

          <div className="flex gap-2 pt-4">
            <Button type="submit" disabled={isSubmitting}>
              <Save className="mr-2 h-4 w-4" />
              {isSubmitting ? t("common.saving") : t("common.save")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleReset}
              disabled={isSubmitting}
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              {t("settings.branding.resetToDefaults")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
