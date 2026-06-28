import { cn } from "@/app/components/ui/utils";

const TYPE_STYLES: Record<string, string> = {
  pdf:  "border-red-200   bg-red-50   text-red-600",
  docx: "border-blue-200  bg-blue-50  text-blue-600",
  doc:  "border-blue-200  bg-blue-50  text-blue-600",
  xlsx: "border-green-200 bg-green-50 text-green-600",
  xls:  "border-green-200 bg-green-50 text-green-600",
  pptx: "border-orange-200 bg-orange-50 text-orange-600",
  ppt:  "border-orange-200 bg-orange-50 text-orange-600",
  png:  "border-purple-200 bg-purple-50 text-purple-600",
  jpg:  "border-purple-200 bg-purple-50 text-purple-600",
  jpeg: "border-purple-200 bg-purple-50 text-purple-600",
  gif:  "border-purple-200 bg-purple-50 text-purple-600",
  webp: "border-purple-200 bg-purple-50 text-purple-600",
  mp4:  "border-pink-200  bg-pink-50  text-pink-600",
  zip:  "border-gray-200  bg-gray-50  text-gray-600",
};

interface FileTypeBadgeProps {
  extension: string;
  className?: string;
}

export function FileTypeBadge({ extension, className }: FileTypeBadgeProps) {
  const ext = extension.replace(/^\./, "").toLowerCase();
  const label = ext.toUpperCase() || "FILE";
  const style = TYPE_STYLES[ext] ?? "border-gray-200 bg-gray-50 text-gray-600";

  return (
    <span
      className={cn(
        "inline-block px-1.5 py-0.5 rounded text-[9px] font-semibold border leading-none tracking-wide",
        style,
        className
      )}
    >
      {label}
    </span>
  );
}
