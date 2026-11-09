import { useMemo } from 'react';
import { useTranslation } from '../common/components/LocalizationProvider';
import en from '../resources/l10n/en.json';
import { fillText } from './gameView';

/** Game texts exist in English and German; other languages fall back to English. */
const useGameTranslation = () => {
  const t = useTranslation();
  return useMemo(() => (key, values) => fillText(t(key) ?? en[key] ?? key, values), [t]);
};

export default useGameTranslation;
