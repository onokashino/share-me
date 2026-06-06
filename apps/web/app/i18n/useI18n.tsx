'use client';

/**
 * useI18n.tsx — i18n context provider + hook.
 *
 * The active language is resolved on the SERVER (see ./server.ts:
 * cookie → Accept-Language → 'en') and handed in as `initialLang`, so the very
 * first HTML is already in the right language — there is no RU→chosen flash on
 * load and no post-hydration language swap.
 *
 * setLang persists the choice as a cookie (so the next server render is in the
 * same language) and updates <html lang>.
 */

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from 'react';
import type { Dict } from './dict';
import { en } from './en';
import { ru } from './ru';
import { zh } from './zh';

export type Lang = 'en' | 'ru' | 'zh';

const DICTS: Record<Lang, Dict> = { en, ru, zh };

interface I18nContextValue {
  L: Dict;
  lang: Lang;
  setLang: (lang: Lang) => void;
}

const I18nContext = createContext<I18nContextValue>({
  L: en,
  lang: 'en',
  setLang: () => {},
});

export function I18nProvider({
  initialLang,
  children,
}: {
  initialLang: Lang;
  children: ReactNode;
}) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    // Persist as a (non-sensitive) cookie so the SERVER renders the next request
    // already in this language — keeps the choice flash-free across reloads.
    document.cookie = `sm_lang=${next}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.lang = next === 'zh' ? 'zh-Hant' : next;
  }, []);

  return (
    <I18nContext.Provider value={{ L: DICTS[lang], lang, setLang }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}
