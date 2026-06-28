// @ts-nocheck
import { useTranslation } from 'react-i18next';
import { Check, ChevronRight } from 'lucide-react';
import type { WizardStep, WizardDocType } from './types';

export function StepBar({ step, docType }: { step: WizardStep; docType: WizardDocType | null }) {
  const { t } = useTranslation();
  const steps = [
    { n: 1 as WizardStep, label: t('generatorV1.stepBar.step1Label') },
    { n: 2 as WizardStep, label: t('generatorV1.stepBar.step2Label') },
    { n: 3 as WizardStep, label: t('generatorV1.stepBar.step3Label') },
  ];
  return (
    <div className="flex items-center gap-1">
      {steps.map((s, i) => (
        <div key={s.n} className="flex items-center gap-1">
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
            step === s.n ? 'bg-primary text-primary-foreground' :
            step > s.n ? 'bg-primary/15 text-primary' : 'text-muted-foreground'
          }`}>
            {step > s.n ? <Check className="w-3 h-3" /> : <span className="w-3.5 h-3.5 flex items-center justify-center">{s.n}</span>}
            <span>{s.label}</span>
            {s.n === 1 && docType && step >= 2 && (
              <span className="ml-0.5 opacity-70">· {docType}</span>
            )}
          </div>
          {i < steps.length - 1 && <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40" />}
        </div>
      ))}
    </div>
  );
}
