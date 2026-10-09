import { POSTCODE_RE } from '@af/shared';
import { findPlace } from '@af/shared/places';

const UK_COUNTRY =
  /^(gb|gbr|uk|united kingdom|great britain|england|scotland|wales|northern ireland)$/i;
const UK_WORDS = /\b(united kingdom|great britain|england|scotland|wales|northern ireland)\b/i;
const UK_CODES = /\b(GB|GBR|UK)\b|\bGB-[A-Z]{3}\b/;
const ABROAD_IN_TEXT =
  /\b(united states|usa|u\.s\.|canada|india|ireland|france|germany|spain|portugal|italy|netherlands|belgium|poland|hungary|romania|czech|switzerland|austria|sweden|norway|denmark|finland|singapore|hong kong|china|japan|australia|new zealand|south africa|brazil|mexico|uae|united arab emirates|dubai|philippines|malaysia|israel|luxembourg|new york|new jersey|texas|california|illinois|massachusetts|ontario|bangalore|bengaluru|mumbai|pune|hyderabad|chennai|gurugram|budapest|warsaw|krakow|bucharest|madrid|paris|berlin|munich|frankfurt|amsterdam|dublin|sydney|melbourne|toronto)\b/i;

/**
 * True for a UK place, false for somewhere else, null when we can't tell (kept; the pipeline's
 * geocoder decides). 'Northern Ireland' is UK; plain 'Ireland' isn't.
 */
export function isUk(loc: { text?: string; country?: string }): boolean | null {
  const c = loc.country?.trim();
  if (c) {
    if (UK_COUNTRY.test(c)) return true;
    // A country code or name for somewhere else; anything odd (a postcode) falls through.
    if (/^[A-Z]{2,3}$/.test(c) || ABROAD_IN_TEXT.test(c)) return false;
  }
  const t = loc.text ?? '';
  if (!t) return null;
  if (UK_WORDS.test(t) || UK_CODES.test(t)) return true;
  if (ABROAD_IN_TEXT.test(t.replace(/northern ireland/gi, ''))) return false;
  return findPlace(t) || POSTCODE_RE.test(t) ? true : null;
}
