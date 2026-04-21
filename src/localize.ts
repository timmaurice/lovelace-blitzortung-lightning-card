import { HomeAssistant } from './types';

import de from './translations/de.json' with { type: 'json' };
import en from './translations/en.json' with { type: 'json' };
import fr from './translations/fr.json' with { type: 'json' };
import it from './translations/it.json' with { type: 'json' };
import nl from './translations/nl.json' with { type: 'json' };
import pl from './translations/pl.json' with { type: 'json' };
import ru from './translations/ru.json' with { type: 'json' };
import sl from './translations/sl.json' with { type: 'json' };
import ua from './translations/ua.json' with { type: 'json' };

const translations = {
  de,
  en,
  fr,
  it,
  nl,
  pl,
  ru,
  sl,
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
