import { HomeAssistant } from './types';

import de from './translations/de.json' assert { type: 'json' };
import en from './translations/en.json' assert { type: 'json' };

const translations = {
  de,
  en,
};

export function localize(hass: HomeAssistant, key: string, placeholders: Record<string, any> = {}): string {
  const lang = hass.language || 'en';
  const langTranslations = translations[lang] || translations.en;

  // Remove the component prefix from the key
  const translationKey = key.replace('component.blc.', '');
  const keyParts = translationKey.split('.');

  let result: any = langTranslations;
  for (const part of keyParts) {
    if (result === undefined) break;
    result = result[part];
  }

  // Fallback to English if key not found in current language
  if (result === undefined && lang !== 'en') {
    result = translations.en;
    for (const part of keyParts) {
      if (result === undefined) break;
      result = result[part];
    }
  }

  if (typeof result === 'string') {
    let finalString = result;
    for (const placeholder in placeholders) {
      finalString = finalString.replace(`{${placeholder}}`, placeholders[placeholder]);
    }
    return finalString;
  }

  return key;
}
