import { HomeAssistant } from './types';

import da from './translations/da.json' with { type: 'json' };
import de from './translations/de.json' with { type: 'json' };
import en from './translations/en.json' with { type: 'json' };
import fi from './translations/fi.json' with { type: 'json' };
import fr from './translations/fr.json' with { type: 'json' };
import it from './translations/it.json' with { type: 'json' };
import nl from './translations/nl.json' with { type: 'json' };
import pl from './translations/pl.json' with { type: 'json' };
import ru from './translations/ru.json' with { type: 'json' };
import sl from './translations/sl.json' with { type: 'json' };
import uk from './translations/uk.json' with { type: 'json' };

const translations = {
  da,
  de,
  en,
  fi,
  fr,
  it,
  nl,
  pl,
  ru,
  sl,
  uk,
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

/**
 * The language the card renders both its strings and its numbers in. HA exposes the active
 * language twice: as `hass.language` and, since 2023.x, as `hass.locale.language`. `locale` is
 * the authoritative pair (it also carries `number_format`), so prefer it and fall back to the
 * older field. `localize()` and `formatNumber()` both resolve through this, so a card can never
 * end up with German labels and English numbers.
 */
export function resolveLanguage(hass: HomeAssistant | undefined): string {
  return hass?.locale?.language || hass?.language || 'en';
}

export function localize(hass: HomeAssistant, key: string, placeholders: Record<string, string | number> = {}): string {
  const lang = resolveLanguage(hass);
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
