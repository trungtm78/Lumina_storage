import { useTranslation } from "react-i18next";
import { X, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Label } from "./ui/label";
import { ScrollArea } from "./ui/scroll-area";

interface FilterSidebarProps {
  availableTags: string[];
  availableCorrespondents: string[];
  availableDocumentTypes: string[];
  selectedTags: string[];
  selectedCorrespondents: string[];
  selectedDocumentTypes: string[];
  onTagsChange: (tags: string[]) => void;
  onCorrespondentsChange: (correspondents: string[]) => void;
  onDocumentTypesChange: (types: string[]) => void;
  onClose: () => void;
}

export function FilterSidebar({
  availableTags,
  availableCorrespondents,
  availableDocumentTypes,
  selectedTags,
  selectedCorrespondents,
  selectedDocumentTypes,
  onTagsChange,
  onCorrespondentsChange,
  onDocumentTypesChange,
  onClose,
}: FilterSidebarProps) {
  const { t } = useTranslation();
  const [expandedSections, setExpandedSections] = useState({
    tags: true,
    correspondents: true,
    documentTypes: true,
  });

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const handleTagToggle = (tag: string) => {
    if (selectedTags.includes(tag)) {
      onTagsChange(selectedTags.filter((t) => t !== tag));
    } else {
      onTagsChange([...selectedTags, tag]);
    }
  };

  const handleCorrespondentToggle = (correspondent: string) => {
    if (selectedCorrespondents.includes(correspondent)) {
      onCorrespondentsChange(
        selectedCorrespondents.filter((c) => c !== correspondent)
      );
    } else {
      onCorrespondentsChange([...selectedCorrespondents, correspondent]);
    }
  };

  const handleDocumentTypeToggle = (type: string) => {
    if (selectedDocumentTypes.includes(type)) {
      onDocumentTypesChange(selectedDocumentTypes.filter((t) => t !== type));
    } else {
      onDocumentTypesChange([...selectedDocumentTypes, type]);
    }
  };

  const clearAll = () => {
    onTagsChange([]);
    onCorrespondentsChange([]);
    onDocumentTypesChange([]);
  };

  const hasActiveFilters =
    selectedTags.length > 0 ||
    selectedCorrespondents.length > 0 ||
    selectedDocumentTypes.length > 0;

  return (
    <div className="flex h-full w-80 flex-col border-r border-gray-200 bg-white">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 p-4">
        <h2 className="font-semibold text-gray-900">{t("common.filters")}</h2>
        <div className="flex items-center gap-2">
          {hasActiveFilters && (
            <Button
              onClick={clearAll}
              variant="ghost"
              size="sm"
              className="text-brand-600 hover:text-brand-700 text-xs"
            >
              {t("common.clearAll")}
            </Button>
          )}
          <button
            onClick={onClose}
            className="rounded-lg p-1 transition-colors hover:bg-gray-100"
          >
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>
      </div>

      {/* Filters */}
      <ScrollArea className="flex-1">
        <div className="space-y-4 p-4">
          {/* Tags */}
          <div className="space-y-3">
            <button
              onClick={() => toggleSection("tags")}
              className="flex w-full items-center justify-between text-sm font-semibold text-gray-900"
            >
              <span>
                {t("documents.filterTags")} {selectedTags.length > 0 && `(${selectedTags.length})`}
              </span>
              {expandedSections.tags ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </button>
            {expandedSections.tags && (
              <div className="space-y-2 pl-1">
                {availableTags.map((tag) => (
                  <div key={tag} className="flex items-center space-x-2">
                    <Checkbox
                      id={`tag-${tag}`}
                      checked={selectedTags.includes(tag)}
                      onCheckedChange={() => handleTagToggle(tag)}
                    />
                    <Label
                      htmlFor={`tag-${tag}`}
                      className="cursor-pointer text-sm text-gray-700"
                    >
                      {tag}
                    </Label>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Correspondents */}
          <div className="space-y-3">
            <button
              onClick={() => toggleSection("correspondents")}
              className="flex w-full items-center justify-between text-sm font-semibold text-gray-900"
            >
              <span>
                {t("documents.filterCorrespondents")}{" "}
                {selectedCorrespondents.length > 0 &&
                  `(${selectedCorrespondents.length})`}
              </span>
              {expandedSections.correspondents ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </button>
            {expandedSections.correspondents && (
              <div className="space-y-2 pl-1">
                {availableCorrespondents.map((correspondent) => (
                  <div
                    key={correspondent}
                    className="flex items-center space-x-2"
                  >
                    <Checkbox
                      id={`correspondent-${correspondent}`}
                      checked={selectedCorrespondents.includes(correspondent)}
                      onCheckedChange={() =>
                        handleCorrespondentToggle(correspondent)
                      }
                    />
                    <Label
                      htmlFor={`correspondent-${correspondent}`}
                      className="cursor-pointer text-sm text-gray-700"
                    >
                      {correspondent}
                    </Label>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Document Types */}
          <div className="space-y-3">
            <button
              onClick={() => toggleSection("documentTypes")}
              className="flex w-full items-center justify-between text-sm font-semibold text-gray-900"
            >
              <span>
                {t("documents.filterDocumentTypes")}{" "}
                {selectedDocumentTypes.length > 0 &&
                  `(${selectedDocumentTypes.length})`}
              </span>
              {expandedSections.documentTypes ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </button>
            {expandedSections.documentTypes && (
              <div className="space-y-2 pl-1">
                {availableDocumentTypes.map((type) => (
                  <div key={type} className="flex items-center space-x-2">
                    <Checkbox
                      id={`type-${type}`}
                      checked={selectedDocumentTypes.includes(type)}
                      onCheckedChange={() => handleDocumentTypeToggle(type)}
                    />
                    <Label
                      htmlFor={`type-${type}`}
                      className="cursor-pointer text-sm text-gray-700"
                    >
                      {type}
                    </Label>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
