import { HomeAssistant } from './types';

import de from './translations/de.json' assert { type: 'json' };
import en from './translations/en.json' assert { type: 'json' };
import fr from './translations/fr.json' assert { type: 'json' };
import nl from './translations/nl.json' assert { type: 'json' };
import ru from './translations/ru.json' assert { type: 'json' };
import si from './translations/si.json' assert { type: 'json' };
import ua from './translations/ua.json' assert { type: 'json' };

const translations = {
  de,
  en,
  fr,
  nl,
  ru,
  si,
  ua,
};

interface TranslationObject {
  [key: string]: string | TranslationObject;
}

const typedTranslations: { [key: string]: TranslationObject } = translations;

function _getTranslation(language: string, keys: string[]): string | undefined {
  let translation: string | TranslationObject | undefined = typedTranslations[language];
  for (const key of keys) {
    if (typeof translation !== 'object' || translation === null) {
      return undefined;
    }
    translation = translation[key];
  }
  return typeof translation === 'string' ? translation : undefined;
}

export function localize(hass: HomeAssistant, key: string, placeholders: Record<string, string | number> = {}): string {
  const lang = hass.language || 'en';
  const translationKey = key.replace('component.blc.', '');
  const keyParts = translationKey.split('.');

  const translation = _getTranslation(lang, keyParts) ?? _getTranslation('en', keyParts);

  if (typeof translation === 'string') {
    let finalString = translation;
    for (const placeholder in placeholders) {
      finalString = finalString.replace(`{${placeholder}}`, String(placeholders[placeholder]));
    }
    return finalString;
  }

  return key;
}
