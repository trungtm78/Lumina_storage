import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";
import {
  brandingApi,
  type BrandingSettings,
} from "@/app/api/endpoints/branding";

interface BrandingContextType {
  settings: BrandingSettings | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

const defaultSettings: BrandingSettings = {
  title: "Lumina Driver",
  logo_url: null,
  favicon_url: null,
  primary_color: "#c50010",
  secondary_color: null,
  accent_color: null,
  description: null,
  contact_email: null,
  help_url: null,
};

const BrandingContext = createContext<BrandingContextType | undefined>(
  undefined
);

export function BrandingProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<BrandingSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const applyColors = useCallback((data: BrandingSettings) => {
    if (data.primary_color) {
      document.documentElement.style.setProperty(
        "--brand-primary",
        data.primary_color
      );
    }
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await brandingApi.get();
      setSettings(response.data);
      applyColors(response.data);

      if (response.data.title) {
        document.title = response.data.title;
      }

      if (response.data.favicon_url) {
        const link = document.querySelector(
          "link[rel='icon']"
        ) as HTMLLinkElement;
        if (link) {
          const apiBase = import.meta.env.VITE_API_PREFIX || "";
          const serverBase = apiBase.replace(/\/api\/v1\/?$/, "");
          link.href = response.data.favicon_url.startsWith("http")
            ? response.data.favicon_url
            : `${serverBase}${response.data.favicon_url}`;
        }
      }
    } catch (err) {
      console.error("Failed to load branding settings:", err);
      setError("Failed to load branding settings");
      setSettings(defaultSettings);
      applyColors(defaultSettings);
    } finally {
      setLoading(false);
    }
  }, [applyColors]);

  useEffect(() => {
    loadSettings();
    const handleBrandingUpdate = () => {
      loadSettings();
    };
    window.addEventListener("branding-updated", handleBrandingUpdate);
    return () => {
      window.removeEventListener("branding-updated", handleBrandingUpdate);
    };
  }, [loadSettings]);

  return (
    <BrandingContext.Provider
      value={{ settings, loading, error, reload: loadSettings }}
    >
      {children}
    </BrandingContext.Provider>
  );
}

export function useBranding() {
  const context = useContext(BrandingContext);
  if (context === undefined) {
    throw new Error("useBranding must be used within BrandingProvider");
  }
  return context;
}

export function useAppTitle(): string {
  const { settings } = useBranding();
  return settings?.title || defaultSettings.title;
}
