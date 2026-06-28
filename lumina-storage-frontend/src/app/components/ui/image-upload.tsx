import { useState, useRef, useEffect } from "react";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { Upload, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { brandingApi } from "@/app/api/endpoints/branding";

function buildImageUrl(relativePath: string | null | undefined): string | null {
  if (!relativePath) return null;
  if (
    relativePath.startsWith("http://") ||
    relativePath.startsWith("https://")
  ) {
    return relativePath;
  }
  const apiBase = import.meta.env.VITE_API_PREFIX || "";
  const serverBase = apiBase.replace(/\/api\/v1\/?$/, "");
  return `${serverBase}${relativePath}`;
}

interface ImageUploadProps {
  label: string;
  currentUrl?: string | null;
  onUploadSuccess: (url: string) => void;
  uploadType: "logo" | "favicon";
  acceptedFormats?: string;
  maxSizeMB?: number;
  previewSize?: "sm" | "md" | "lg";
}

export function ImageUpload({
  label,
  currentUrl,
  onUploadSuccess,
  uploadType,
  acceptedFormats = "image/png, image/jpeg, image/svg+xml, image/x-icon, image/gif, image/webp",
  maxSizeMB = 5,
  previewSize = "md",
}: ImageUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [manualUrl, setManualUrl] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const previewSizeClasses = {
    sm: "h-16 w-16",
    md: "h-24 w-24",
    lg: "h-32 w-32",
  };

  useEffect(() => {
    if (currentUrl) {
      setPreviewUrl(buildImageUrl(currentUrl));
      setManualUrl(currentUrl);
    } else {
      setPreviewUrl(null);
      setManualUrl("");
    }
  }, [currentUrl]);

  const handleFileSelect = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > maxSizeMB * 1024 * 1024) {
      toast.error(`File too large. Maximum size: ${maxSizeMB}MB`);
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      setPreviewUrl(reader.result as string);
    };
    reader.readAsDataURL(file);

    try {
      setUploading(true);
      const response =
        uploadType === "logo"
          ? await brandingApi.uploadLogo(file)
          : await brandingApi.uploadFavicon(file);

      if (response.success) {
        const uploadedUrl = response.data.url;
        setManualUrl(uploadedUrl);
        setPreviewUrl(buildImageUrl(uploadedUrl));
        onUploadSuccess(uploadedUrl);
        toast.success("Upload successful");
      }
    } catch {
      toast.error("Upload failed");
      setPreviewUrl(buildImageUrl(currentUrl));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleRemoveImage = () => {
    setPreviewUrl(null);
    setManualUrl("");
    onUploadSuccess("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleManualUrlChange = (url: string) => {
    setManualUrl(url);
    if (url) {
      setPreviewUrl(buildImageUrl(url));
      onUploadSuccess(url);
    } else {
      setPreviewUrl(null);
      onUploadSuccess("");
    }
  };

  return (
    <div className="space-y-3">
      <Label>{label}</Label>

      {previewUrl && (
        <div className="flex items-center gap-4">
          <div
            className={`${previewSizeClasses[previewSize]} flex items-center justify-center overflow-hidden rounded-lg border bg-gray-50`}
          >
            <img
              src={previewUrl}
              alt="Preview"
              className="h-full w-full object-contain"
              onError={() => {
                setPreviewUrl(null);
                toast.error("Failed to load image");
              }}
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleRemoveImage}
            disabled={uploading}
          >
            <X className="mr-1 h-4 w-4" />
            Remove
          </Button>
        </div>
      )}

      {!previewUrl && (
        <>
          <div className="flex gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept={acceptedFormats}
              onChange={handleFileSelect}
              className="hidden"
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  Upload File
                </>
              )}
            </Button>
            <span className="self-center text-xs text-gray-500">
              or enter URL
            </span>
          </div>
          <div className="space-y-2">
            <Label
              htmlFor={`url-${uploadType}`}
              className="text-xs text-gray-500"
            >
              Or enter URL directly
            </Label>
            <Input
              id={`url-${uploadType}`}
              value={manualUrl}
              onChange={(e) => handleManualUrlChange(e.target.value)}
              placeholder="https://example.com/image.png"
              disabled={uploading}
            />
          </div>
        </>
      )}

      {previewUrl && (
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept={acceptedFormats}
            onChange={handleFileSelect}
            className="hidden"
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" />
                Change file
              </>
            )}
          </Button>
        </div>
      )}

      <p className="text-xs text-gray-500">
        Supported: PNG, JPG, SVG, ICO, GIF, WebP. Max size: {maxSizeMB}MB
      </p>
    </div>
  );
}
