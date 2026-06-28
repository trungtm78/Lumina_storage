// @ts-nocheck
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import { motion } from 'motion/react';
import type { WizardDocType } from './types';
import { DOC_TYPE_CARDS } from './constants';

export function Step1TypeSelector({ onSelect }: { onSelect: (t: WizardDocType) => void }) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState<WizardDocType | null>(null);
  const [selected, setSelected] = useState<WizardDocType | null>(null);
  return (
    <div className="flex flex-col items-center justify-center h-full px-8 py-10">
      <div className="w-full max-w-3xl">
        <h2 className="text-xl font-semibold text-foreground mb-1">{t('generatorV1.step1.title')}</h2>
        <p className="text-sm text-muted-foreground mb-7">{t('generatorV1.step1.subtitle')}</p>
        <div className="grid grid-cols-3 gap-4">
          {DOC_TYPE_CARDS.map(card => {
            const Icon = card.icon;
            const isSelected = selected === card.type;
            const isHovered = hovered === card.type;
            return (
              <motion.button
                key={card.type}
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.98 }}
                onHoverStart={() => setHovered(card.type)}
                onHoverEnd={() => setHovered(null)}
                onClick={() => { setSelected(card.type); setTimeout(() => onSelect(card.type), 180); }}
                className={`text-left p-5 rounded-xl border-2 transition-all flex flex-col gap-3 cursor-pointer ${
                  isSelected
                    ? 'border-primary bg-primary/8 shadow-md ring-2 ring-primary/20'
                    : isHovered
                    ? 'border-primary/60 bg-primary/3 shadow-sm'
                    : 'border-border bg-card hover:border-primary/40'
                }`}
              >
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${card.color}`}>
                  <Icon className={`w-5 h-5 ${card.iconColor}`} />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">{t(`generatorV1.docType.${card.type}.label`)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{t(`generatorV1.docType.${card.type}.subtitle`)}</p>
                </div>
                <div className={`flex items-center gap-1 text-xs font-medium transition-opacity ${isHovered || isSelected ? 'opacity-100 text-primary' : 'opacity-0'}`}>
                  {t('generatorV1.step1.selectCta')} <ChevronRight className="w-3 h-3" />
                </div>
              </motion.button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
