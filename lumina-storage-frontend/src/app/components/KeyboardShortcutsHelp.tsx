import { useTranslation } from "react-i18next";
import { Keyboard } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { Button } from "./ui/button";

export function KeyboardShortcutsHelp() {
  const { t } = useTranslation();
  const shortcuts = [
    { keys: ["Ctrl", "F"], description: t("documents.shortcutFocusSearch") },
    { keys: ["Ctrl", "G"], description: t("documents.shortcutGridView") },
    { keys: ["Ctrl", "L"], description: t("documents.shortcutTableView") },
    { keys: ["Ctrl", "K"], description: t("documents.shortcutToggleFilters") },
    { keys: ["Esc"], description: t("documents.shortcutClosePreview") },
  ];

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Keyboard className="mr-2 h-4 w-4" />
          {t("documents.shortcuts")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("documents.keyboardShortcuts")}</DialogTitle>
          <DialogDescription>
            {t("documents.keyboardShortcutsDesc")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-4">
          {shortcuts.map((shortcut, index) => (
            <div key={index} className="flex items-center justify-between">
              <span className="text-sm text-gray-700">
                {shortcut.description}
              </span>
              <div className="flex gap-1">
                {shortcut.keys.map((key, keyIndex) => (
                  <kbd
                    key={keyIndex}
                    className="rounded border border-gray-200 bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-800"
                  >
                    {key}
                  </kbd>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
